import { describe, expect, it } from "vitest";
import { cronAuthorised } from "./cron";

describe("cronAuthorised", () => {
  const secret = "s3cretvalue-0123456789";

  it("accepts Vercel's bearer header", () => {
    expect(cronAuthorised(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("refuses a missing, wrong or unprefixed header", () => {
    expect(cronAuthorised(null, secret)).toBe(false);
    expect(cronAuthorised("Bearer nope", secret)).toBe(false);
    expect(cronAuthorised(secret, secret)).toBe(false);
    expect(cronAuthorised(`Bearer ${secret} `, secret)).toBe(false);
  });

  it("refuses everything when the secret is unset or too short", () => {
    expect(cronAuthorised("Bearer ", undefined)).toBe(false);
    expect(cronAuthorised("Bearer ", "")).toBe(false);
    expect(cronAuthorised("Bearer short", "short")).toBe(false);
  });
});
