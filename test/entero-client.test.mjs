import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readEnteroNextPage, readEnteroProduct, searchEntero } from "../src/entero/client.mjs";
import { encodeSearchCursor } from "../src/entero/policy.mjs";

const searchHtml = await readFile(new URL("./fixtures/entero-search.html", import.meta.url), "utf8");
const productHtml = await readFile(new URL("./fixtures/entero-product.html", import.meta.url), "utf8");

function response(html, url, status = 200) {
  return { ok: status >= 200 && status < 300, status, url, text: async () => html };
}

test("searches with GET and enforces hard price and result limits", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, method: options.method });
    return response(searchHtml, url);
  };
  const result = await searchEntero({ query: "кофемашина", maxPrice: 300000, limit: 1 }, { fetch });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].itemId, "122389");
  assert.equal(result.offers[0].currentPrice, 241498);
  assert.deepEqual(calls.map(({ method }) => method), ["GET"]);
});

test("retries a network timeout exactly once using GET", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, method: options.method });
    if (calls.length === 1) throw new DOMException("timed out", "AbortError");
    return response(searchHtml, url);
  };
  const result = await searchEntero({ query: "кофемашина", limit: 2 }, { fetch });
  assert.equal(result.offers.length, 2);
  assert.deepEqual(calls.map(({ method }) => method), ["GET", "GET"]);
});

test("rejects policy errors before fetch without retry", async () => {
  let calls = 0;
  await assert.rejects(
    readEnteroProduct("https://example.com/item/122375", { fetch: async () => { calls += 1; } }),
    (error) => error.code === "ENTERO_POLICY_ERROR",
  );
  assert.equal(calls, 0);
});

test("rejects an external final response URL", async () => {
  const fetch = async () => response(searchHtml, "https://evil.example/search.php?text=x");
  await assert.rejects(
    searchEntero({ query: "кофемашина" }, { fetch }),
    (error) => error.code === "ENTERO_POLICY_ERROR",
  );
});

test("uses product-page price as confirmed evidence", async () => {
  const fetch = async (url, options) => {
    assert.equal(options.method, "GET");
    return response(productHtml, url);
  };
  const offer = await readEnteroProduct("122375", { fetch, now: () => new Date("2026-08-11T10:15:30.000Z") });
  assert.equal(offer.currentPrice, 410875);
  assert.equal(offer.verifiedAt, "2026-08-11T10:15:30.000Z");
});

test("reads only the validated next search page", async () => {
  const cursor = encodeSearchCursor({ query: "кофемашина", categoryId: null, page: 2 });
  let requestedUrl;
  const fetch = async (url) => {
    requestedUrl = url;
    return response(searchHtml, url);
  };
  await readEnteroNextPage(cursor, { maxPrice: 500000, limit: 2 }, { fetch });
  assert.equal(new URL(requestedUrl).searchParams.get("page"), "2");
});

test("exposes structured HTTP errors without response internals", async () => {
  const fetch = async (url) => response("unavailable", url, 503);
  await assert.rejects(
    searchEntero({ query: "кофемашина" }, { fetch }),
    (error) => {
      assert.deepEqual(
        { code: error.code, message: error.message, sourceUrl: error.sourceUrl },
        { code: "ENTERO_HTTP_ERROR", message: "Entero returned HTTP 503", sourceUrl: "https://entero.ru/search.php?text=%D0%BA%D0%BE%D1%84%D0%B5%D0%BC%D0%B0%D1%88%D0%B8%D0%BD%D0%B0" },
      );
      assert.equal("headers" in error, false);
      return true;
    },
  );
});

test("does not follow redirects before validating the destination", async () => {
  let calls = 0;
  const fetch = async (url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    return response("", url, 302);
  };
  await assert.rejects(searchEntero({query:"кофемашина"},{fetch}), e=>e.code==="ENTERO_REDIRECT_DENIED");
  assert.equal(calls,1);
});
