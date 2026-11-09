import { parseMinutesDocx, parseMinutesMarkdown } from "./minutes.ts";
import { parseTrello } from "./trello.ts";
import { ParseError, type ParseResult, type SourceType } from "./types.ts";
import { parseWhatsApp, type WhatsAppOptions } from "./whatsapp.ts";

export { parseMinutesDocx, parseMinutesMarkdown, parseTrello, parseWhatsApp };
export { ParseError, EventSchema } from "./types.ts";
export type { ParsedEvent, ParseResult, ParseErrorCode, ReadSummary, SourceType } from "./types.ts";

/** Which parser an upload needs, from its file name. Null if the type is not supported. */
export function sourceTypeFor(filename: string): SourceType | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "txt") return "whatsapp";
  if (ext === "json") return "trello";
  if (ext === "md" || ext === "markdown" || ext === "docx") return "minutes";
  return null;
}

/** Parse an uploaded file by its extension: .txt chat, .json Trello, .md or .docx minutes. */
export async function parseUpload(
  filename: string,
  bytes: Uint8Array,
  options: { whatsapp?: WhatsAppOptions } = {},
): Promise<ParseResult> {
  const type = sourceTypeFor(filename);
  if (!type) {
    throw new ParseError("unsupported-file", "Unsupported file type. Upload a WhatsApp .txt export, a Trello .json export, or minutes as .md or .docx.");
  }
  const decode = () => new TextDecoder("utf-8").decode(bytes);
  if (type === "whatsapp") return parseWhatsApp(decode(), options.whatsapp);
  if (type === "trello") return parseTrello(decode());
  return filename.toLowerCase().endsWith(".docx") ? parseMinutesDocx(bytes) : parseMinutesMarkdown(decode());
}
