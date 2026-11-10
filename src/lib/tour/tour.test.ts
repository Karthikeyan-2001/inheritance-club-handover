import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_USERS } from "../demo/demo-users.ts";
import { stepForPath } from "../steps.ts";
import {
  TOURS,
  TOUR_TRACKS,
  currentStop,
  isOnStop,
  parseTourCookie,
  serializeTour,
  stopHref,
  tourLength,
  tourState,
} from "./tour.ts";

const all = TOUR_TRACKS.flatMap((track) => TOURS[track].map((stop, index) => ({ track, index, stop })));

describe("tour stops", () => {
  it("each track has unique stop ids", () => {
    for (const track of TOUR_TRACKS) {
      const ids = TOURS[track].map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("starts as Arun, on the page a new copy lands on", () => {
    expect(TOURS.built[0]).toMatchObject({ as: "arun", path: "/" });
    expect(TOURS.files[0]).toMatchObject({ as: "arun", path: "/import" });
  });

  it.each(all.map((a) => [`${a.track} ${a.index} ${a.stop.id}`, a.stop] as const))("%s: its page is its workflow step", (_, stop) => {
    const tab = stop.tab ?? null;
    expect(stepForPath(stop.path, tab)).toBe(stop.step);
  });

  it("is seen only as one of the four demo accounts", () => {
    const keys = new Set(DEMO_USERS.map((u) => u.key));
    for (const { stop } of all) expect(keys.has(stop.as)).toBe(true);
  });

  it("visits the five steps in order on each track", () => {
    const order = ["Connect", "Reconstruct", "Verify", "Review", "Handover"];
    for (const track of TOUR_TRACKS) {
      const seen = TOURS[track].map((s) => s.step).filter((s) => s !== null);
      const firsts = seen.filter((s, i) => seen.indexOf(s) === i);
      expect(firsts).toEqual(order);
      const ranks = seen.map((s) => order.indexOf(s));
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
  });

  it("only data-dependent pages are resolved, and they have a prefix", () => {
    for (const { stop } of all) if (stop.resolve) expect(stop.prefix).toBe(true);
  });
});

describe("isOnStop", () => {
  it("matches each stop's own address", () => {
    for (const { stop } of all) {
      if (stop.prefix) continue;
      const url = new URL(stopHref(stop), "http://x");
      expect(isOnStop(stop, url.pathname, url.searchParams.get("tab"))).toBe(true);
    }
  });

  it("treats a missing tab as the page's default tab", () => {
    const commitments = TOURS.built.find((s) => s.id === "commitments")!;
    const recurring = TOURS.built.find((s) => s.id === "recurring")!;
    const drafts = TOURS.built.find((s) => s.id === "review-drafts")!;
    const build = TOURS.built.find((s) => s.id === "build")!;
    expect(isOnStop(commitments, "/ledger", null)).toBe(true);
    expect(isOnStop(build, "/ledger", "commitments")).toBe(true);
    expect(isOnStop(recurring, "/ledger", null)).toBe(false);
    expect(isOnStop(drafts, "/review", null)).toBe(true);
    expect(isOnStop(drafts, "/review", "history")).toBe(false);
  });

  it("matches any evidence page under the prefix, and not the ledger", () => {
    const ev = TOURS.built.find((s) => s.id === "evidence")!;
    expect(isOnStop(ev, "/ledger/evidence/3f1c", null)).toBe(true);
    expect(isOnStop(ev, "/ledger", null)).toBe(false);
  });

  it("does not match another page", () => {
    expect(isOnStop(TOURS.built[0], "/import", null)).toBe(false);
  });
});

describe("tour state", () => {
  it("round-trips through the cookie", () => {
    for (const { track, index } of all) {
      const s = tourState(track, index)!;
      expect(parseTourCookie(serializeTour(s))).toEqual({ track, index });
      expect(currentStop(s)).toBe(TOURS[track][index]);
    }
  });

  it.each([
    [undefined],
    [""],
    ["built"],
    ["built:"],
    ["built:-1"],
    ["built:1.5"],
    ["built:1e1"],
    ["built:999"],
    ["nope:0"],
    ["built:0:extra"],
  ])("refuses %j", (value) => {
    expect(parseTourCookie(value)).toBeNull();
  });

  it("refuses an index past the end, rather than clamping", () => {
    expect(tourState("files", tourLength("files"))).toBeNull();
    expect(tourState("files", String(tourLength("files") - 1))).toEqual({ track: "files", index: tourLength("files") - 1 });
  });
});

/** Every file under `dir` ending in .tsx. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("highlight targets", () => {
  it("name test ids that the pages still render", () => {
    const src = tsxFiles(join(import.meta.dirname, "..", "..")).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const { stop } of all) {
      if (!stop.highlight) continue;
      for (const m of stop.highlight.matchAll(/data-testid="([^"]+)"/g)) {
        const id = m[1];
        const rendered = src.includes(`data-testid="${id}"`) || src.includes(`testId="${id}"`) || src.includes(`count-\${c.table}`);
        expect(rendered, `${stop.id}: ${id}`).toBe(true);
      }
      for (const m of stop.highlight.matchAll(/aria-labelledby="([^"]+)"/g)) {
        expect(src.includes(`id="${m[1]}"`), `${stop.id}: #${m[1]}`).toBe(true);
      }
    }
  });
});
