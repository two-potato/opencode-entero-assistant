import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { decodeSearchCursor } from "../src/entero/policy.mjs";
import { parsePrice, parseProductPage, parseSearchPage } from "../src/entero/parser.mjs";

const searchHtml = await readFile(new URL("./fixtures/entero-search.html", import.meta.url), "utf8");
const productHtml = await readFile(new URL("./fixtures/entero-product.html", import.meta.url), "utf8");
const searchUrl = "https://entero.ru/search.php?text=кофемашина";

test("parses prices with common HTML spacing", () => {
  assert.equal(parsePrice("241&nbsp;498 ₽"), 241498);
  assert.equal(parsePrice("251&thinsp;560 ₽"), 251560);
  assert.equal(parsePrice("нет цены"), null);
});

test("extracts Entero search cards, categories, and the next cursor", () => {
  const result = parseSearchPage(searchHtml, searchUrl);
  assert.equal(result.offers.length, 2);
  assert.deepEqual(result.offers[0], {
    itemId: "122375",
    title: "Кофемашина профессиональная Nuova Simonelli Appia II Compact 2Gr",
    currentPrice: 410875,
    oldPrice: null,
    currency: "RUB",
    availability: "В наличии",
    properties: "2 группы · автоматическая",
    url: "https://entero.ru/item/122375",
  });
  assert.equal(result.offers[1].itemId, "122389");
  assert.equal(result.offers[1].currentPrice, 241498);
  assert.equal(result.offers[1].oldPrice, 251560);
  assert.equal(result.offers[1].availability, "Под заказ");
  assert.deepEqual(result.categories, [{ id: 78, title: "Кофемашины" }]);
  assert.deepEqual(decodeSearchCursor(result.nextCursor), { query: "кофемашина", categoryId: null, page: 2 });
});

test("extracts confirmed product-page evidence", () => {
  const verifiedAt = "2026-08-11T10:15:30.000Z";
  assert.deepEqual(parseProductPage(productHtml, "https://entero.ru/item/122375", verifiedAt), {
    itemId: "122375",
    code: "122375",
    article: "APPIA-II-COMPACT-2GR",
    title: "Кофемашина профессиональная Nuova Simonelli Appia II Compact 2Gr",
    currentPrice: 410875,
    currency: "RUB",
    availability: "В наличии",
    specs: { "Артикул": "APPIA-II-COMPACT-2GR", "Количество групп": "2", "Автоматическая мойка": true },
    url: "https://entero.ru/item/122375",
    verifiedAt,
  });
});
