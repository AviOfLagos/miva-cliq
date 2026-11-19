import { test } from "node:test";
import assert from "node:assert/strict";
import {
  passesRevocation,
  revocationVerdict,
  sessionIdHash,
  withTimeout,
  type RevocationLookup,
} from "./revocation.ts";

const listed = (...sids: string[]): RevocationLookup => {
  const set = new Set(sids.map(sessionIdHash));
  return async (h) => set.has(h);
};

test("a listed id is rejected, an unlisted one accepted", async () => {
  const lookup = listed("sid-revoked");
  assert.equal(await revocationVerdict("sid-revoked", lookup), "revoked");
  assert.equal(await passesRevocation("sid-revoked", lookup), false);
  assert.equal(await revocationVerdict("sid-fine", lookup), "accept");
  assert.equal(await passesRevocation("sid-fine", lookup), true);
});

test("the lookup sees a hash, never the raw id", async () => {
  const seen: string[] = [];
  await revocationVerdict("raw-session-id", async (h) => {
    seen.push(h);
    return false;
  });
  assert.equal(seen.length, 1);
  assert.notEqual(seen[0], "raw-session-id");
  assert.ok(!seen[0].includes("raw-session-id"));
  assert.equal(seen[0], sessionIdHash("raw-session-id"));
});

test("blobs without an id are accepted (they expire on their own)", async () => {
  assert.equal(await revocationVerdict(null, listed("x")), "no-id");
  assert.equal(await revocationVerdict(undefined, listed("x")), "no-id");
  assert.equal(await passesRevocation("", listed("")), true);
});

test("no database configured: accepted", async () => {
  assert.equal(await revocationVerdict("sid", null), "no-store");
  assert.equal(await passesRevocation("sid", null), true);
});

test("fail open: a throwing lookup (DB down, table missing) accepts", async () => {
  const down: RevocationLookup = async () => {
    throw new Error('relation "revoked_sessions" does not exist');
  };
  assert.equal(await revocationVerdict("sid", down), "fail-open");
  assert.equal(await passesRevocation("sid", down), true);
});

test("fail open: a hung lookup times out and accepts", async () => {
  const hung: RevocationLookup = (h) => withTimeout(new Promise<boolean>(() => {}), 20);
  assert.equal(await revocationVerdict("sid", hung), "fail-open");
});

test("withTimeout passes a fast result through", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
});
