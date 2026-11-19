import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "./safeNext.ts";

const origin = "https://miva-cliq.vercel.app";

test("a normal same-site path keeps its query", () => {
  assert.equal(safeNextPath("/study?course=1", origin), "/study?course=1");
  assert.equal(safeNextPath("/study-pack", origin), "/study-pack");
});

test("off-site and script targets are refused", () => {
  for (const bad of [
    "/\t/evil.com", // what ?next=/%09/evil.com decodes to
    "/%09/evil.com", // still encoded: stays a same-site path, which is fine
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "http://miva-cliq.vercel.app/study", // other scheme, other origin
  ]) {
    const got = safeNextPath(bad, origin);
    if (got !== null) {
      // Anything let through must resolve to our own origin.
      assert.equal(new URL(got, origin).origin, origin, `escaped via ${JSON.stringify(bad)}`);
      assert.ok(got.startsWith("/") && !got.startsWith("//"), `unsafe path for ${JSON.stringify(bad)}: ${got}`);
    }
  }
  assert.equal(safeNextPath("/\t/evil.com", origin), null);
  assert.equal(safeNextPath("//evil.com", origin), null);
  assert.equal(safeNextPath("/\\evil.com", origin), null);
  assert.equal(safeNextPath("https://evil.com", origin), null);
  assert.equal(safeNextPath("javascript:alert(1)", origin), null);
});

test("empty input means stay put", () => {
  assert.equal(safeNextPath(null, origin), null);
  assert.equal(safeNextPath("", origin), null);
});

test("a same-origin value that normalises to a protocol-relative path is flattened", () => {
  assert.equal(safeNextPath("/.//evil.com", "https://miva-cliq.vercel.app"), "/evil.com");
  assert.equal(safeNextPath("/x/..//evil.com/a?b=1", "https://miva-cliq.vercel.app"), "/evil.com/a?b=1");
});
