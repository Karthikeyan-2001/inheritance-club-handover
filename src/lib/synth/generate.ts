// Turns a world into the export files a club would upload: WhatsApp chats (group or one-to-one),
// an optional Trello board JSON, and minutes (.md or .docx). Pure and deterministic: the same
// world gives the same bytes. No model is called. Planted beats are written exactly as in the
// world; only filler is templated.

import { createHash } from "node:crypto";
import { renderDocx, type DocxParagraph } from "./docx.ts";
import { makeRng, seedFor, type Rng } from "./rng.ts";
import type { Card, Chat, Trello, World } from "./world.ts";

type Clock = { y: number; mo: number; d: number; h: number; mi: number };
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function parseStamp(s: string): Clock {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/) as RegExpMatchArray;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}
const stampKey = (c: Clock) => `${c.y}${pad(c.mo)}${pad(c.d)}${pad(c.h)}${pad(c.mi)}`;

function days(from: string, to: string): { y: number; mo: number; d: number }[] {
  const out = [];
  const end = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  for (let t = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)); t <= end; t += 86400000) {
    const d = new Date(t);
    out.push({ y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() });
  }
  return out;
}

/** IST wall clock to a UTC ISO string (Trello stores UTC). */
const istToUtcIso = (c: Clock) => new Date(Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi) - 330 * 60000).toISOString();

const hex24 = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 24);

// ---------------------------------------------------------------- WhatsApp

type Line = { clock: Clock; sec: number; author: string | null; text: string; lead?: string };

function typo(text: string, rng: Rng): string {
  const words = text.split(" ");
  const idx = words.map((w, i) => (/^[a-z]{5,}$/i.test(w) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return text;
  const i = rng.pick(idx);
  const w = words[i];
  const j = rng.int(1, w.length - 3);
  words[i] = w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2);
  return words.join(" ");
}

function fillerText(world: World, chat: Chat, rng: Rng): string {
  const f = world.filler;
  const tpl = rng.pick(f.templates[chat.template]);
  const who = world.people.find((p) => p.name === rng.pick(chat.members));
  return tpl
    .replace(/\{who\}/g, who ? rng.pick(who.nicknames.length ? who.nicknames : [who.name]) : "all")
    .replace(/\{thing\}/g, () => rng.pick(f.things))
    .replace(/\{place\}/g, () => rng.pick(f.places))
    .replace(/\{time\}/g, () => rng.pick(f.times))
    .replace(/\{tamil\}/g, () => rng.pick(f.tamil));
}

function minuteOfDay(rng: Rng): number {
  // Mostly afternoons and evenings, some late nights.
  const r = rng.next();
  if (r < 0.15) return rng.int(8 * 60, 12 * 60 + 59);
  if (r < 0.45) return rng.int(13 * 60, 17 * 60 + 59);
  if (r < 0.92) return rng.int(18 * 60, 22 * 60 + 59);
  return rng.int(23 * 60, 23 * 60 + 40);
}

function chatLines(world: World, chat: Chat): Line[] {
  const rng = makeRng(seedFor(world.seed, chat.file));
  const lines: Line[] = [];
  const start = stampKey(parseStamp(chat.startsAt));
  const from = chat.activeFrom ?? world.period.from;
  for (const day of days(from, world.period.to)) {
    const month = `${day.y}-${pad(day.mo)}`;
    const rate = chat.perDay[month] ?? chat.perDay.default;
    // Poisson-ish: the rate's integer part, plus one more with the fractional probability.
    const n = Math.floor(rate) + (rng.next() < rate - Math.floor(rate) ? 1 : 0);
    const spread = n > 0 ? rng.int(0, Math.ceil(n / 2)) : 0;
    for (let i = 0; i < n + spread * (rng.next() < 0.5 ? 1 : 0); i++) {
      const m = minuteOfDay(rng);
      const clock: Clock = { ...day, h: Math.floor(m / 60), mi: m % 60 };
      if (stampKey(clock) <= start) continue;
      const author = rng.pick(chat.members);
      const r = rng.next();
      let text: string;
      if (r < world.filler.mediaRate) text = "<Media omitted>";
      else if (r < world.filler.mediaRate + world.filler.deletedRate) text = "This message was deleted";
      else {
        text = fillerText(world, chat, rng);
        if (rng.next() < world.filler.typoRate) text = typo(text, rng);
      }
      lines.push({ clock, sec: rng.int(0, 59), author, text });
    }
  }
  for (const b of chat.beats) lines.push({ clock: parseStamp(b.at), sec: 30, author: b.by, text: b.say });
  for (const s of chat.system) lines.push({ clock: parseStamp(s.at), sec: 0, author: null, text: s.text, lead: s.by });
  // Stable order: time, then beats after filler at the same minute (they were pushed later).
  return lines.map((l, i) => ({ l, i })).sort((a, b) => stampKey(a.l.clock).localeCompare(stampKey(b.l.clock)) || a.i - b.i).map((x) => x.l);
}

function clock12(c: Clock, withSeconds: boolean, sec: number): string {
  const h12 = c.h % 12 === 0 ? 12 : c.h % 12;
  return `${pad(c.d)}/${pad(c.mo)}/${c.y}, ${h12}:${pad(c.mi)}${withSeconds ? ":" + pad(sec) : ""} ${c.h < 12 ? "am" : "pm"}`;
}

const LRM = "‎";

export function renderChat(world: World, chat: Chat): string {
  const out: string[] = [];
  const start = parseStamp(chat.startsAt);
  const ios = chat.format === "iphone";
  const stamp = (c: Clock, sec: number) => (ios ? `[${clock12(c, true, sec)}]` : clock12(c, false, sec));
  const say = (c: Clock, sec: number, author: string | null, text: string, lead?: string) => {
    if (ios) out.push(`${stamp(c, sec)} ${author ?? lead ?? chat.group}: ${author === null ? LRM : ""}${text}`);
    else out.push(`${stamp(c, sec)} - ${author === null ? text : `${author}: ${text}`}`);
  };
  say(start, 12, null, "Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.", chat.group);
  if (chat.kind === "group") {
    say(start, 12, null, `${chat.creator} created group “${chat.group}”`, chat.creator);
    const others = chat.members.filter((m) => m !== chat.creator);
    say(start, 13, null, ios ? `${chat.creator} added ${others.join(", ")}` : `${chat.creator} added you`, chat.creator);
  }
  for (const l of chatLines(world, chat)) say(l.clock, l.sec, l.author, l.text, l.lead ?? chat.creator);
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------- Trello

export function renderTrello(world: World, t: Trello): string {
  const boardId = hex24(`board:${t.name}`);
  const person = (name: string) => {
    const id = hex24(`member:${name}`);
    return { id, fullName: name, username: `${name.toLowerCase()}_synthetic`, initials: name[0] };
  };
  const members = world.people.filter((p) => t.cards.some((c) => c.by === p.name || c.moves.some((m) => m.by === p.name) || c.comments.some((x) => x.by === p.name))).map((p) => person(p.name));
  const listId = new Map(t.lists.map((l) => [l, hex24(`list:${l}`)]));
  const labels = t.labels.map((n, i) => ({ id: hex24(`label:${n}`), idBoard: boardId, name: n, color: ["red", "green", "blue", "purple"][i % 4] }));
  const labelId = new Map(labels.map((l) => [l.name, l.id]));

  const actions: { date: string; action: object }[] = [];
  const cards = t.cards.map((c: Card, i: number) => {
    const cardId = hex24(`card:${c.id}`);
    const finalList = c.moves.length ? c.moves[c.moves.length - 1].to : c.list;
    const dueIso = c.due ? `${c.due}T12:00:00.000Z` : null;
    const last = [c.createdAt, ...c.moves.map((m) => m.at), ...c.comments.map((x) => x.at)].sort().at(-1) as string;
    const cardRef = { id: cardId, name: c.name, idShort: i + 1 };
    const act = (type: string, at: string, by: string, data: object) =>
      actions.push({
        date: istToUtcIso(parseStamp(at)),
        action: {
          id: hex24(`action:${c.id}:${type}:${at}:${actions.length}`),
          idMemberCreator: hex24(`member:${by}`),
          type,
          date: istToUtcIso(parseStamp(at)),
          data: { board: { id: boardId, name: t.name }, card: cardRef, ...data },
          memberCreator: person(by),
        },
      });
    act("createCard", c.createdAt, c.by, { list: { id: listId.get(c.list), name: c.list } });
    let from = c.list;
    for (const m of c.moves) {
      act("updateCard", m.at, m.by, { listBefore: { id: listId.get(from), name: from }, listAfter: { id: listId.get(m.to), name: m.to } });
      from = m.to;
    }
    for (const x of c.comments) act("commentCard", x.at, x.by, { text: x.text });
    return {
      id: cardId,
      idShort: i + 1,
      name: c.name,
      desc: c.desc,
      idList: listId.get(finalList),
      idBoard: boardId,
      idMembers: [],
      idLabels: c.labels.map((l) => labelId.get(l)),
      idChecklists: [],
      pos: 16384 * (i + 1),
      due: dueIso,
      dueComplete: false,
      closed: false,
      dateLastActivity: istToUtcIso(parseStamp(last)),
      labels: c.labels.map((l) => ({ id: labelId.get(l), name: l })),
    };
  });
  actions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first, as Trello exports
  const lastAction = actions[0]?.date ?? istToUtcIso(parseStamp(`${world.period.to} 12:00`));
  const board = {
    id: boardId,
    name: t.name,
    desc: "Synthetic board. No real people or organisations.",
    closed: false,
    dateLastActivity: lastAction,
    members,
    labels,
    lists: t.lists.map((l, i) => ({ id: listId.get(l), name: l, closed: false, idBoard: boardId, pos: 16384 * (i + 1) })),
    cards,
    checklists: [],
    actions: actions.map((a) => a.action),
  };
  return JSON.stringify(board, null, 2) + "\n";
}

// ---------------------------------------------------------------- Minutes

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function meetingTitle(world: World, date: string): string {
  if (world.minutes.dates === "iso") return `${date}: Committee meeting`;
  return `${+date.slice(8, 10)} ${MONTHS[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}: Committee meeting`;
}

const meetings = (world: World) => [...world.minutes.meetings].sort((a, b) => a.date.localeCompare(b.date));

export function renderMinutes(world: World): string {
  const m = world.minutes;
  const out = [`# ${m.title} (SYNTHETIC)`, ""];
  for (const meet of meetings(world)) {
    out.push(`## ${meetingTitle(world, meet.date)}`, "", `**Present:** ${meet.present.join(", ")}`, `**Absent:** ${meet.absent.length ? meet.absent.join(", ") : "none"}`, "");
    for (const s of meet.sections) {
      out.push(`### ${s.heading}`, "");
      if (s.text) out.push(s.text, "");
      if (s.bullets) out.push(...s.bullets.map((b) => `- ${b}`), "");
    }
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

/** The same minutes as a Word document: Heading 1 title, Heading 2 per meeting, Heading 3 per section. */
export function renderMinutesDocx(world: World): Uint8Array {
  const m = world.minutes;
  const ps: DocxParagraph[] = [{ style: "Heading1", text: `${m.title} (SYNTHETIC)` }];
  for (const meet of meetings(world)) {
    ps.push({ style: "Heading2", text: meetingTitle(world, meet.date) });
    ps.push({ boldLead: "Present:", text: ` ${meet.present.join(", ")}` });
    ps.push({ boldLead: "Absent:", text: ` ${meet.absent.length ? meet.absent.join(", ") : "none"}` });
    for (const s of meet.sections) {
      ps.push({ style: "Heading3", text: s.heading });
      if (s.text) ps.push({ text: s.text });
      for (const b of s.bullets ?? []) ps.push({ text: b });
    }
  }
  return renderDocx(ps);
}

// ---------------------------------------------------------------- All

/** A generated file: text, or bytes for a Word document. */
export type FileContent = string | Uint8Array;

/** Every file of the scenario, by file name. Same world, same bytes. */
export function generateScenario(world: World): Record<string, FileContent> {
  const files: Record<string, FileContent> = {};
  for (const chat of world.chats) files[chat.file] = renderChat(world, chat);
  if (world.trello) files[world.trello.file] = renderTrello(world, world.trello);
  files[world.minutes.file] = world.minutes.file.endsWith(".docx") ? renderMinutesDocx(world) : renderMinutes(world);
  return files;
}

/** A file's content as bytes (what an upload sends). */
export const fileBytes = (c: FileContent): Uint8Array => (typeof c === "string" ? new TextEncoder().encode(c) : c);

/** Type, access level and uploader per generated file, for import and for the truth check. */
export function fileLevels(world: World) {
  type Meta = { type: "whatsapp" | "trello" | "minutes"; accessLevel: World["minutes"]["accessLevel"]; uploader: World["minutes"]["uploader"] };
  const out: Record<string, Meta> = {};
  for (const c of world.chats) out[c.file] = { type: "whatsapp", accessLevel: c.accessLevel, uploader: c.uploader };
  if (world.trello) out[world.trello.file] = { type: "trello", accessLevel: world.trello.accessLevel, uploader: world.trello.uploader };
  out[world.minutes.file] = { type: "minutes", accessLevel: world.minutes.accessLevel, uploader: world.minutes.uploader };
  return out;
}
