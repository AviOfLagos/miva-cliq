import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameOrigin } from "./sameOrigin.ts";

const host = "miva-cliq.vercel.app";

test("Sec-Fetch-Site: same-origin is accepted", () => {
  assert.equal(isSameOrigin({ origin: null, secFetchSite: "same-origin", host }), true);
});

test("matching Origin host is accepted", () => {
  assert.equal(
    isSameOrigin({ origin: `https://${host}`, secFetchSite: null, host }),
    true,
  );
  assert.equal(
    isSameOrigin({ origin: "http://localhost:3000", secFetchSite: null, host: "localhost:3000" }),
    true,
  );
});

test("cross-site requests are rejected", () => {
  assert.equal(
    isSameOrigin({ origin: "https://evil.example", secFetchSite: "cross-site", host }),
    false,
  );
  assert.equal(
    isSameOrigin({ origin: `https://${host}.evil.example`, secFetchSite: null, host }),
    false,
  );
  assert.equal(isSameOrigin({ origin: "null", secFetchSite: null, host }), false);
});

test("no Origin and no Sec-Fetch-Site is rejected", () => {
  assert.equal(isSameOrigin({ origin: null, secFetchSite: null, host }), false);
  assert.equal(isSameOrigin({ origin: null, secFetchSite: "same-site", host }), false);
});
