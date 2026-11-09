// The four synthetic demo accounts. Shown on the login page by design (synthetic data).
// Emails use example.com, which is reserved and never delivers mail.
// No path aliases here: scripts/seed.ts imports this file directly under Node.

export type DemoUserKey = "arun" | "meena" | "kavya" | "divya";
export type DemoRole = "outgoing_lead" | "advisor" | "incoming_lead" | "treasurer";

export type DemoUser = {
  key: DemoUserKey;
  name: string;
  role: DemoRole;
  email: string;
  summary: string;
};

export const DEMO_USERS: readonly DemoUser[] = [
  {
    key: "arun",
    name: "Arun",
    role: "outgoing_lead",
    email: "arun.demo@example.com",
    summary: "Outgoing club lead. Uploads the exports and reviews the ledger.",
  },
  {
    key: "meena",
    name: "Dr. Meena",
    role: "advisor",
    email: "meena.demo@example.com",
    summary: "Faculty advisor. Sees everything and approves the handover version.",
  },
  {
    key: "kavya",
    name: "Kavya",
    role: "incoming_lead",
    email: "kavya.demo@example.com",
    summary: "Incoming lead. Receives the approved handover and responds to each item.",
  },
  {
    key: "divya",
    name: "Divya",
    role: "treasurer",
    email: "divya.demo@example.com",
    summary: "Treasurer. Sees finance items but not private messages.",
  },
] as const;

export function demoUser(key: DemoUserKey): DemoUser {
  const u = DEMO_USERS.find((d) => d.key === key);
  if (!u) throw new Error(`Unknown demo user: ${key}`);
  return u;
}

export function isDemoUserKey(value: unknown): value is DemoUserKey {
  return typeof value === "string" && DEMO_USERS.some((d) => d.key === value);
}
