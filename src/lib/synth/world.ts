// The shape of a scenario's world.yaml (data/scenarios/<name>/, SYNTHETIC). Validated with Zod so
// a typo in the world fails loudly instead of producing a quietly different year.

import { parse } from "yaml";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access.ts";

const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "expected 'YYYY-MM-DD HH:mm' (IST)");
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Access = z.enum(ACCESS_LEVELS);
/** The demo account that uploads a file (matters for private files: only its uploader and the advisor read them). */
const Uploader = z.enum(["arun", "meena", "kavya", "divya"]);

const Beat = z.object({ at: Stamp, by: z.string(), say: z.string().min(1) });
const SystemLine = z.object({ at: Stamp, text: z.string(), by: z.string().optional() });

const Chat = z.object({
  file: z.string(),
  format: z.enum(["android", "iphone"]),
  /** A group chat, or a one-to-one chat (no "created group" lines; `group` is the other person). */
  kind: z.enum(["group", "direct"]).default("group"),
  group: z.string(),
  accessLevel: Access,
  uploader: Uploader.default("arun"),
  creator: z.string(),
  template: z.string(),
  startsAt: Stamp,
  /** Filler stops before this day (inclusive start). Unset: from `period.from`. */
  activeFrom: Day.optional(),
  members: z.array(z.string()).min(2),
  /** Average filler messages per day: `default`, overridden by "YYYY-MM" keys. */
  perDay: z.object({ default: z.number().min(0) }).catchall(z.number().min(0)),
  system: z.array(SystemLine).default([]),
  beats: z.array(Beat).default([]),
});

const Move = z.object({ at: Stamp, by: z.string(), to: z.string() });
const Card = z.object({
  id: z.string(),
  name: z.string(),
  desc: z.string().default(""),
  labels: z.array(z.string()).default([]),
  list: z.string(),
  by: z.string(),
  createdAt: Stamp,
  due: Day.nullable(),
  moves: z.array(Move).default([]),
  comments: z.array(z.object({ at: Stamp, by: z.string(), text: z.string() })).default([]),
});

const Meeting = z.object({
  date: Day,
  present: z.array(z.string()),
  absent: z.array(z.string()),
  sections: z.array(z.object({ heading: z.string(), text: z.string().optional(), bullets: z.array(z.string()).optional() })),
});

export const WorldSchema = z.object({
  synthetic: z.literal(true),
  seed: z.number().int(),
  club: z.string(),
  period: z.object({ from: Day, to: Day }),
  people: z.array(z.object({ name: z.string(), role: z.string(), nicknames: z.array(z.string()).default([]) })),
  filler: z.object({
    typoRate: z.number().min(0).max(1),
    mediaRate: z.number().min(0).max(1),
    deletedRate: z.number().min(0).max(1),
    things: z.array(z.string()).min(1),
    places: z.array(z.string()).min(1),
    times: z.array(z.string()).min(1),
    tamil: z.array(z.string()).min(1),
    templates: z.record(z.string(), z.array(z.string()).min(1)),
  }),
  chats: z.array(Chat).min(1),
  trello: z
    .object({
      file: z.string(),
      name: z.string(),
      accessLevel: Access,
      uploader: Uploader.default("arun"),
      lists: z.array(z.string()),
      labels: z.array(z.string()),
      cards: z.array(Card),
    })
    .optional(),
  minutes: z.object({
    /** `.md` or `.docx`; a Word file uses Heading styles for the dates, as the parser expects. */
    file: z.string().regex(/\.(md|docx)$/),
    title: z.string(),
    accessLevel: Access,
    uploader: Uploader.default("arun"),
    /** How dates are written in headings: ISO (2026-01-10) or words (10 January 2026). */
    dates: z.enum(["iso", "words"]).default("iso"),
    meetings: z.array(Meeting),
  }),
});
export type World = z.infer<typeof WorldSchema>;
export type Chat = z.infer<typeof Chat>;
export type Card = z.infer<typeof Card>;
export type Trello = NonNullable<World["trello"]>;

/** Parse and check a world file; also checks that every named person and list exists. */
export function loadWorld(yamlText: string): World {
  const world = WorldSchema.parse(parse(yamlText));
  const people = new Set(world.people.map((p) => p.name));
  const lists = new Set(world.trello?.lists ?? []);
  const problems: string[] = [];
  const person = (n: string, where: string) => {
    if (!people.has(n)) problems.push(`${where}: unknown person "${n}"`);
  };
  for (const c of world.chats) {
    person(c.creator, c.file);
    c.members.forEach((m) => person(m, c.file));
    c.beats.forEach((b) => {
      person(b.by, `${c.file} beat ${b.at}`);
      if (!c.members.includes(b.by)) problems.push(`${c.file} beat ${b.at}: ${b.by} is not a member of the chat`);
    });
    if (!(c.template in world.filler.templates)) problems.push(`${c.file}: no filler templates called "${c.template}"`);
  }
  for (const card of world.trello?.cards ?? []) {
    person(card.by, `card ${card.id}`);
    if (!lists.has(card.list)) problems.push(`card ${card.id}: unknown list "${card.list}"`);
    card.moves.forEach((m) => !lists.has(m.to) && problems.push(`card ${card.id}: unknown list "${m.to}"`));
  }
  if (world.trello && new Set(world.trello.cards.map((c) => c.id)).size !== world.trello.cards.length) problems.push("duplicate card ids");
  for (const c of world.chats) if (c.kind === "direct" && c.members.length !== 2) problems.push(`${c.file}: a direct chat has exactly two members`);
  const names = [...world.chats.map((c) => c.file), ...(world.trello ? [world.trello.file] : []), world.minutes.file];
  if (new Set(names).size !== names.length) problems.push("two files share a name");
  for (const m of world.minutes.meetings) [...m.present, ...m.absent].forEach((n) => person(n, `minutes ${m.date}`));
  if (problems.length) throw new Error(`world.yaml has problems:\n- ${problems.join("\n- ")}`);
  return world;
}
