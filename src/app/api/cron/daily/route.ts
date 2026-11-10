import { connection } from "next/server";
import { cronAuthorised } from "@/lib/cron";
import { purgeSandboxes } from "@/lib/demo/sandbox";
import { sandboxConfig, serviceClient } from "@/lib/demo/sandbox-server";

// The daily job (vercel.json). It keeps the free Supabase project awake (projects pause after
// a week without activity) and deletes expired demo clubs. Vercel sends CRON_SECRET as a
// bearer token; anything else is refused before touching the database.
export const maxDuration = 60;

/** Copies removed per run: about five calls each, well inside the time limit. Missed copies wait a day. */
const PURGE_LIMIT = 25;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  await connection();
  if (!cronAuthorised(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return json({ error: "unauthorised" }, 401);
  }
  const cfg = sandboxConfig();
  if (!cfg) return json({ error: "Supabase is not configured on the server" }, 503);
  const admin = serviceClient(cfg);

  // A real query, so the project counts as active.
  const ping = await admin.from("demo_sandboxes").select("id", { count: "exact", head: true });
  if (ping.error) return json({ db: "error" }, 502);

  try {
    const result = await purgeSandboxes(admin, new Date(), PURGE_LIMIT);
    return json({ db: "ok", copies: ping.count ?? 0, ...result });
  } catch (err) {
    console.error("cron purge:", err instanceof Error ? err.message : err);
    return json({ db: "ok", purgeError: true }, 500);
  }
}
