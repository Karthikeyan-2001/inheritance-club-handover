import { z } from "zod";
import { instantToIstIso } from "../time.ts";
import { ParseError, finish, type ParsedEvent, type ParseResult } from "./types.ts";

const Member = z.object({ id: z.string(), fullName: z.string().optional() });
const List = z.object({ id: z.string(), name: z.string() });
const Card = z.object({
  id: z.string(),
  name: z.string(),
  desc: z.string().optional().default(""),
  idList: z.string().optional(),
  due: z.string().nullable().optional(),
  dueComplete: z.boolean().optional().default(false),
  closed: z.boolean().optional().default(false),
  dateLastActivity: z.string().optional(),
});
const CheckItem = z.object({ name: z.string(), state: z.string() });
const Checklist = z.object({ id: z.string(), idCard: z.string(), name: z.string(), checkItems: z.array(CheckItem).default([]) });
const ActionCard = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  due: z.string().nullable().optional(),
  dueComplete: z.boolean().optional(),
  closed: z.boolean().optional(),
});
const Action = z.object({
  id: z.string(),
  type: z.string(),
  date: z.string(),
  idMemberCreator: z.string().optional(),
  memberCreator: z.object({ fullName: z.string().optional() }).optional(),
  data: z
    .looseObject({
      card: ActionCard.optional(),
      text: z.string().optional(),
      idMember: z.string().optional(),
      listBefore: z.object({ name: z.string() }).optional(),
      listAfter: z.object({ name: z.string() }).optional(),
      old: z.looseObject({}).optional(),
    })
    .default({}),
});
const Board = z.object({
  name: z.string().optional(),
  dateLastActivity: z.string().optional(),
  members: z.array(Member).default([]),
  lists: z.array(List).default([]),
  cards: z.array(Card),
  checklists: z.array(Checklist).default([]),
  actions: z.array(Action).default([]),
});

const DONE_LIST = /^(done|completed?|finished|shipped)$/i;

function toIst(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : instantToIstIso(d);
}

/**
 * Parse a Trello board JSON export (Menu → More → Print and export → Export as JSON).
 * Cards, comments, member additions, list moves, completion and due-date changes become
 * events. A move into a list called "Done" is flagged in `meta.movedToDone`, which the
 * contradiction check uses later. Times are converted from Trello's UTC to IST.
 */
export function parseTrello(jsonText: string): ParseResult {
  if (!jsonText.trim()) throw new ParseError("empty", "The Trello file is empty.");

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText.replace(/^﻿/, ""));
  } catch {
    throw new ParseError("invalid-json", "This file is not valid JSON. Export the board as JSON from Trello and upload that file.");
  }
  const parsed = Board.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join(".") || "(root)";
    throw new ParseError(
      "not-trello-board",
      `This JSON does not look like a Trello board export (a "cards" list is required; problem at ${where}).`,
    );
  }
  const board = parsed.data;

  const memberName = new Map(board.members.map((m) => [m.id, m.fullName ?? null]));
  const listName = new Map(board.lists.map((l) => [l.id, l.name]));
  const cardById = new Map(board.cards.map((c) => [c.id, c]));
  const events: ParsedEvent[] = [];
  const dropped: Record<string, number> = { unknown_action: 0, bad_date: 0 };
  const warnings: string[] = [];

  const authorOf = (a: z.infer<typeof Action>): string | null =>
    a.memberCreator?.fullName ?? (a.idMemberCreator ? (memberName.get(a.idMemberCreator) ?? null) : null) ?? null;

  const created = new Map<string, z.infer<typeof Action>>();
  for (const a of board.actions) {
    const id = a.data.card?.id;
    if (a.type === "createCard" && id && !created.has(id)) created.set(id, a);
  }

  // One event per card: its name, description and due date, stamped when it was created.
  for (const card of board.cards) {
    const createAction = created.get(card.id);
    const ts = toIst(createAction?.date) ?? toIst(card.dateLastActivity);
    const due = toIst(card.due);
    const lines = [`Card: ${card.name}`];
    if (card.desc.trim()) lines.push(card.desc.trim());
    if (due) lines.push(`Due: ${due.slice(0, 10)}`);
    events.push({
      sourceType: "trello",
      author: createAction ? authorOf(createAction) : null,
      ts,
      text: lines.join("\n"),
      threadId: `trello:card:${card.id}`,
      meta: {
        trello: "card",
        cardId: card.id,
        cardName: card.name,
        list: card.idList ? (listName.get(card.idList) ?? null) : null,
        dueComplete: card.dueComplete,
        closed: card.closed,
        ...(createAction ? {} : { tsSource: "dateLastActivity" }),
      },
    });
  }

  for (const a of board.actions) {
    if (a.type === "createCard") continue; // covered by the card event
    const cardId = a.data.card?.id;
    const card = cardId ? cardById.get(cardId) : undefined;
    const name = a.data.card?.name ?? card?.name ?? "(unknown card)";
    const ts = toIst(a.date);
    if (!ts) {
      dropped.bad_date++;
      continue;
    }
    const base = { sourceType: "trello" as const, author: authorOf(a), ts, threadId: cardId ? `trello:card:${cardId}` : null };
    const meta = { trello: a.type, ...(cardId ? { cardId } : {}), cardName: name };

    if (a.type === "commentCard" && a.data.text?.trim()) {
      events.push({ ...base, text: a.data.text.trim(), meta });
    } else if (a.type === "addMemberToCard") {
      const who = (a.data.idMember && memberName.get(a.data.idMember)) || "a member";
      events.push({ ...base, text: `Added ${who} to card "${name}"`, meta });
    } else if (a.type === "updateCard" && a.data.listBefore && a.data.listAfter) {
      const from = a.data.listBefore.name;
      const to = a.data.listAfter.name;
      events.push({
        ...base,
        text: `Moved card "${name}" from "${from}" to "${to}"`,
        meta: { ...meta, from, to, movedToDone: DONE_LIST.test(to) },
      });
    } else if (a.type === "updateCard" && a.data.old && "dueComplete" in a.data.old && a.data.card?.dueComplete !== undefined) {
      const done = a.data.card.dueComplete;
      events.push({ ...base, text: `Marked card "${name}" as ${done ? "complete" : "incomplete"}`, meta: { ...meta, dueComplete: done } });
    } else if (a.type === "updateCard" && a.data.old && "due" in a.data.old) {
      const due = toIst(a.data.card?.due);
      events.push({ ...base, text: due ? `Changed due date of card "${name}" to ${due.slice(0, 10)}` : `Removed due date of card "${name}"`, meta });
    } else if (a.type === "updateCard" && a.data.old && "closed" in a.data.old && a.data.card?.closed !== undefined) {
      events.push({ ...base, text: `${a.data.card.closed ? "Archived" : "Restored"} card "${name}"`, meta });
    } else {
      dropped.unknown_action++;
    }
  }

  // Checklists only exist as they were at export time; they are labelled that way.
  for (const cl of board.checklists) {
    if (cl.checkItems.length === 0) continue;
    const card = cardById.get(cl.idCard);
    const items = cl.checkItems.map((i) => `- [${i.state === "complete" ? "x" : " "}] ${i.name}`);
    events.push({
      sourceType: "trello",
      author: null,
      ts: toIst(board.dateLastActivity),
      text: `Checklist "${cl.name}" on card "${card?.name ?? "(unknown card)"}" (state at export):\n${items.join("\n")}`,
      threadId: `trello:card:${cl.idCard}`,
      meta: { trello: "checklist", cardId: cl.idCard, tsSource: "export" },
    });
  }

  if (board.actions.length === 0) {
    warnings.push("This export has no action history, so there are no comments or list moves, only the cards as they were at export.");
  }
  return finish("trello", "action", board.cards.length + board.actions.length, events, dropped, warnings);
}
