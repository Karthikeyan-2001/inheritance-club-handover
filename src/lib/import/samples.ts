// Synthetic sample files, served from public/samples/. The photography club is the fuller one:
// four files at four levels. Shared by the Add files page (download links) and the import form
// (the one-click "Use the 4 sample files").

import type { AccessLevel } from "../access.ts";

export type SampleFile = { file: string; label: string; level: AccessLevel };
export type SampleSet = { dir: string; title: string; files: readonly SampleFile[] };

export const SAMPLE_SETS: readonly SampleSet[] = [
  {
    dir: "photo",
    title: "Photography club, one term (recommended)",
    files: [
      { file: "whatsapp-committee.txt", label: "Committee chat (WhatsApp, iPhone export)", level: "committee" },
      { file: "whatsapp-accounts.txt", label: "Accounts chat (WhatsApp)", level: "finance" },
      { file: "WhatsApp Chat with Prof. Iyer.txt", label: "Arun's one-to-one chat with the advisor", level: "private" },
      { file: "minutes.docx", label: "Meeting minutes (Word)", level: "committee" },
    ],
  },
  {
    dir: "mini",
    title: "IoT club, a few weeks (small)",
    files: [
      { file: "whatsapp-committee.txt", label: "Committee chat (WhatsApp)", level: "committee" },
      { file: "trello-board.json", label: "Trello board", level: "committee" },
      { file: "minutes.md", label: "Minutes", level: "finance" },
    ],
  },
];

export const sampleUrl = (dir: string, file: string) => `/samples/${dir}/${encodeURIComponent(file)}`;
