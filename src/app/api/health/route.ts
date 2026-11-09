import { connection } from "next/server";
import { buildHealth } from "@/lib/health";

export async function GET() {
  // Render per request (cacheComponents would otherwise prerender this).
  await connection();
  return Response.json(buildHealth(process.env, new Date()), {
    headers: { "cache-control": "no-store" },
  });
}
