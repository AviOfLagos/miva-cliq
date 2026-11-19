import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sealIdentity,
  unsealIdentity,
  resolveStudent,
  IDENTITY_MAX_AGE_SECONDS,
  type ResolveDeps,
} from "./identity.ts";
import { seal, unseal, unsealDetailed, SESSION_MAX_AGE_SECONDS } from "./session.ts";
import { deriveKey, openJson } from "./seal.ts";
import { sessionIdHash, type RevocationLookup } from "./revocation.ts";
import type { MoodleSession } from "./moodle/auth.ts";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret";

const DAY = 24 * 60 * 60 * 1000;

const moodle: MoodleSession = {
  cookies: { MoodleSession: "MOODLE-COOKIE-VALUE-xyz", CASTGC: "TGT-CAS-TICKET-abc" },
  sesskey: "SESSKEY-1234567",
  userId: 4242,
  name: "Ada Lovelace",
};

function flipByte(blob: string, at: number): string {
  const raw = Buffer.from(blob, "base64url");
  raw[at] ^= 0x01;
  return raw.toString("base64url");
}

/* ---- identity seal / unseal --------------------------------------- */

test("identity round-trips", () => {
  const now = Date.now();
  const { blob, identity } = sealIdentity("hash-abc", now);
  assert.deepEqual(unsealIdentity(blob, now + 1000), identity);
  assert.equal(identity.a, "hash-abc");
  assert.ok(identity.sid.length >= 20);
});

test("identity is valid for 30 days and not a millisecond longer", () => {
  const now = Date.now();
  const { blob } = sealIdentity("hash-abc", now);
  assert.equal(IDENTITY_MAX_AGE_SECONDS, 30 * 24 * 60 * 60);
  assert.ok(unsealIdentity(blob, now + 29 * DAY));
  assert.ok(unsealIdentity(blob, now + IDENTITY_MAX_AGE_SECONDS * 1000));
  assert.equal(unsealIdentity(blob, now + IDENTITY_MAX_AGE_SECONDS * 1000 + 1), null);
});

test("a future-dated identity is rejected", () => {
  const now = Date.now();
  const { blob } = sealIdentity("hash-abc", now + 60_000);
  assert.equal(unsealIdentity(blob, now), null);
});

test("tampered, truncated and garbage identities are rejected", () => {
  const { blob } = sealIdentity("hash-abc");
  assert.equal(unsealIdentity(flipByte(blob, 5)), null); // iv
  assert.equal(unsealIdentity(flipByte(blob, 20)), null); // tag
  assert.equal(unsealIdentity(flipByte(blob, 40)), null); // ciphertext
  assert.equal(unsealIdentity(blob.slice(0, 30)), null);
  assert.equal(unsealIdentity("not-a-blob"), null);
  assert.equal(unsealIdentity(""), null);
  assert.equal(unsealIdentity(undefined), null);
});

test("the two cookies cannot be swapped for each other", () => {
  const id = sealIdentity("hash-abc").blob;
  const sess = seal(moodle);
  assert.equal(unseal(id), null);
  assert.equal(unsealIdentity(sess), null);
});

test("the identity blob holds no Moodle material", () => {
  const { blob } = sealIdentity("hash-abc");
  const payload = openJson(blob, deriveKey("identity-v1")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ["a", "iat", "sid"]);
  const text = JSON.stringify(payload);
  for (const secret of [
    moodle.sesskey,
    moodle.name,
    ...Object.keys(moodle.cookies),
    ...Object.values(moodle.cookies),
  ]) {
    assert.ok(!text.includes(secret), `identity blob leaked ${secret}`);
  }
  // And the ciphertext is small: an author hash, an id and a timestamp.
  assert.ok(Buffer.from(blob, "base64url").length < 140);
});

/* ---- Moodle session --------------------------------------------- */

test("Moodle session keeps its two-hour lifetime and gains an id", () => {
  const now = Date.now();
  const blob = seal(moodle, now);
  assert.equal(SESSION_MAX_AGE_SECONDS, 2 * 60 * 60);
  const opened = unsealDetailed(blob, now);
  assert.ok(opened?.sid);
  assert.deepEqual(opened?.session, moodle);
  assert.equal(unseal(blob, now + SESSION_MAX_AGE_SECONDS * 1000 + 1), null);
  assert.equal(unseal(flipByte(blob, 40), now), null);
});

/* ---- fallback order --------------------------------------------- */

const hashSession = (s: MoodleSession) => `user:${s.userId}`;
const none: ResolveDeps = { lookup: null, hashSession };

function revokedSet(...sids: string[]): RevocationLookup {
  const hashes = new Set(sids.map(sessionIdHash));
  return async (h) => hashes.has(h);
}

test("identity cookie wins over the Moodle session", async () => {
  const id = sealIdentity("from-identity").blob;
  const got = await resolveStudent({ identity: id, session: seal(moodle) }, none);
  assert.deepEqual(got, { authorHash: "from-identity", via: "identity" });
});

test("falls back to the Moodle session when there is no identity cookie", async () => {
  const got = await resolveStudent({ session: seal(moodle) }, none);
  assert.deepEqual(got, { authorHash: "user:4242", via: "session" });
});

test("falls back to the Moodle session when the identity is expired or tampered", async () => {
  const now = Date.now();
  const old = sealIdentity("old", now - 31 * DAY).blob;
  const sess = seal(moodle, now);
  assert.equal((await resolveStudent({ identity: old, session: sess }, { ...none, now }))?.via, "session");
  const bad = flipByte(sealIdentity("x").blob, 40);
  assert.equal((await resolveStudent({ identity: bad, session: sess }, none))?.via, "session");
});

test("identity alone is enough after the Moodle session expires", async () => {
  const now = Date.now();
  const id = sealIdentity("still-me", now - 3 * DAY).blob;
  const stale = seal(moodle, now - 3 * 60 * 60 * 1000);
  const got = await resolveStudent({ identity: id, session: stale }, { ...none, now });
  assert.deepEqual(got, { authorHash: "still-me", via: "identity" });
});

test("nobody when neither cookie is valid", async () => {
  assert.equal(await resolveStudent({}, none), null);
  assert.equal(await resolveStudent({ identity: "junk", session: "junk" }, none), null);
});

test("a revoked identity falls through; both revoked means nobody", async () => {
  const { blob: id, identity } = sealIdentity("me");
  const sess = seal(moodle);
  const sessSid = unsealDetailed(sess)!.sid!;

  const onlyId = { lookup: revokedSet(identity.sid), hashSession };
  assert.equal((await resolveStudent({ identity: id, session: sess }, onlyId))?.via, "session");
  assert.equal(await resolveStudent({ identity: id }, onlyId), null);

  const both = { lookup: revokedSet(identity.sid, sessSid), hashSession };
  assert.equal(await resolveStudent({ identity: id, session: sess }, both), null);
});

test("an unreachable revocation store fails open", async () => {
  const down: ResolveDeps = {
    lookup: async () => {
      throw new Error('relation "revoked_sessions" does not exist');
    },
    hashSession,
  };
  const got = await resolveStudent({ identity: sealIdentity("me").blob }, down);
  assert.deepEqual(got, { authorHash: "me", via: "identity" });
});

test("a session that cannot be hashed (no salt) resolves to nobody, not a throw", async () => {
  const throwing: ResolveDeps = {
    lookup: null,
    hashSession: () => {
      throw new Error("GISTS_SALT (or SESSION_SECRET) must be set");
    },
  };
  assert.equal(await resolveStudent({ session: seal(moodle) }, throwing), null);
});
