import { createHash } from "node:crypto";

/** SHA-256 of a file's bytes (or a string), as lowercase hex. Used for `sources.sha256`. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
