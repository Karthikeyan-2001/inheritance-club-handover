import { describe, expect, it, vi } from "vitest";
import { EVENTS, OBLIGATIONS } from "./fixture";
import { fixtureIds, freshIds, memoSignIn, type Db } from "./load-club";

describe("fixtureIds", () => {
  it("keeps the fixture's ids for the shared club", () => {
    expect(fixtureIds(EVENTS[0].id)).toBe(EVENTS[0].id);
  });
});

describe("freshIds", () => {
  it("gives every fixture row a new id, the same one each time", () => {
    const ids = freshIds();
    const a = ids(OBLIGATIONS[0].id);
    expect(a).not.toBe(OBLIGATIONS[0].id);
    expect(ids(OBLIGATIONS[0].id)).toBe(a);
    expect(ids(OBLIGATIONS[1].id)).not.toBe(a);
  });

  it("gives two copies different ids", () => {
    const one = freshIds();
    const two = freshIds();
    expect(one(EVENTS[0].id)).not.toBe(two(EVENTS[0].id));
  });

  it("covers every fixture row with a distinct id", () => {
    const ids = freshIds();
    const all = [...EVENTS, ...OBLIGATIONS].map((r) => ids(r.id));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("memoSignIn", () => {
  it("signs each person in once", async () => {
    const client = {} as Db;
    const signIn = vi.fn(async () => client);
    const as = memoSignIn(signIn);
    await as("arun");
    await as("arun");
    await as("meena");
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(await as("arun")).toBe(client);
  });
});
