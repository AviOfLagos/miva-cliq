// Run with: npm test (or node --import ./test/register.mjs --test lib/moodle/readCapped.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readCapped } from "./readCapped.ts";

test("a body under the cap is read whole", async () => {
  const out = await readCapped(new Response("hello"), 10);
  assert.equal(out?.toString("utf8"), "hello");
});

test("a declared content-length over the cap is refused before any body is read", async () => {
  let pulled = 0;
  const body = new ReadableStream({
    pull(c) {
      pulled++;
      c.enqueue(new Uint8Array(10));
    },
  });
  const r = new Response(body, { headers: { "content-length": "1000000" } });
  assert.equal(await readCapped(r, 1000), null);
  assert.ok(pulled <= 1, "at most the stream's initial pull, not the whole file");
});

test("reading stops as soon as the body passes the cap", async () => {
  let chunks = 0;
  const body = new ReadableStream({
    pull(c) {
      chunks++;
      if (chunks > 1000) return c.close();
      c.enqueue(new Uint8Array(100));
    },
  });
  assert.equal(await readCapped(new Response(body), 450), null);
  assert.ok(chunks < 10, `stopped after ${chunks} chunks`);
});

test("an aborted read gives null rather than throwing", async () => {
  const body = new ReadableStream({
    pull(c) {
      c.error(new Error("aborted"));
    },
  });
  assert.equal(await readCapped(new Response(body), 1000), null);
});
