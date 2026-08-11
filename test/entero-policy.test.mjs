import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAllowedEnteroUrl,
  buildSearchUrl,
  decodeSearchCursor,
  encodeSearchCursor,
  normalizeItemUrl,
} from "../src/entero/policy.mjs";

test("builds only the documented Entero search route", () => {
  assert.equal(buildSearchUrl({ query: "кофемашина" }).href, "https://entero.ru/search.php?text=%D0%BA%D0%BE%D1%84%D0%B5%D0%BC%D0%B0%D1%88%D0%B8%D0%BD%D0%B0");
  assert.equal(buildSearchUrl({ query: "кофемашина", categoryId: 78 }).search, "?text=%D0%BA%D0%BE%D1%84%D0%B5%D0%BC%D0%B0%D1%88%D0%B8%D0%BD%D0%B0&cid=78");
  assert.equal(buildSearchUrl({ query: "кофемашина", page: 2 }).search, "?text=%D0%BA%D0%BE%D1%84%D0%B5%D0%BC%D0%B0%D1%88%D0%B8%D0%BD%D0%B0&page=2");
});

test("normalizes only numeric Entero item identifiers", () => {
  assert.equal(normalizeItemUrl(122375).href, "https://entero.ru/item/122375");
  assert.equal(normalizeItemUrl("https://entero.ru/item/122375").href, "https://entero.ru/item/122375");
  assert.throws(() => normalizeItemUrl("abc"), /item/i);
});

test("accepts the closed read-only allowlist", () => {
  const allowed = [
    "https://entero.ru/search.php?text=кофемашина",
    "https://entero.ru/search.php?text=кофемашина&cid=78",
    "https://entero.ru/search.php?text=кофемашина&page=2",
    "https://entero.ru/item/122375",
  ];
  for (const input of allowed) assert.equal(assertAllowedEnteroUrl(input).href, new URL(input).href);
});

test("rejects every route outside the closed allowlist", () => {
  const rejected = [
    "http://entero.ru/search.php?text=x",
    "https://example.com/search.php?text=x",
    "https://entero.ru/cart/",
    "https://entero.ru/ajax/cart/set_amount/",
    "https://entero.ru/cabinet/",
    "https://entero.ru/profile/",
    "https://entero.ru/checkout/",
    "javascript:alert(1)",
    "https://entero.ru/search.php?text=x&cid=abc",
    "https://entero.ru/search.php?text=x&page=0",
    "https://entero.ru/search.php?text=x&sort=price",
    "https://entero.ru/item/not-a-number",
  ];
  for (const input of rejected) assert.throws(() => assertAllowedEnteroUrl(input), /not allowed|invalid/i, input);
});

test("cursor round-trips validated search state", () => {
  const cursor = encodeSearchCursor({ query: "кофемашина", categoryId: 78, page: 2 });
  assert.deepEqual(decodeSearchCursor(cursor), { query: "кофемашина", categoryId: 78, page: 2 });
  assert.throws(() => decodeSearchCursor(Buffer.from('{"query":"x","page":0}').toString("base64url")), /invalid/i);
});
