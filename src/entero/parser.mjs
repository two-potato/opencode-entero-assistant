import { assertAllowedEnteroUrl, encodeSearchCursor, normalizeItemUrl } from "./policy.mjs";

function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;|&thinsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function textContent(value) {
  return decodeEntities(String(value).replace(/<[^>]*>/g, " "))
    .replace(/[\u00a0\u2009\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classContent(html, className) {
  const name = escapeRegex(className);
  const match = String(html).match(new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*class=["'][^"']*\\b${name}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"));
  return match ? match[2] : null;
}

function parserError(message) {
  const error = new Error(message);
  error.code = "ENTERO_PARSE_ERROR";
  return error;
}

export function parsePrice(text) {
  const normalized = textContent(text);
  const digits = normalized.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

function productSegments(html) {
  const starts = [...String(html).matchAll(/<div\b(?=[^>]*\bdata-index=["'](\d+)["'])(?=[^>]*\bclass=["'][^"']*\bproduct-wrapper\b[^"']*["'])[^>]*>/gi)];
  return starts.map((match, index) => ({
    itemId: match[1],
    html: String(html).slice(match.index, starts[index + 1]?.index ?? String(html).length),
  }));
}

export function parseSearchPage(html, sourceUrl) {
  const source = assertAllowedEnteroUrl(sourceUrl);
  const offers = productSegments(html).map(({ itemId, html: card }) => ({
    itemId,
    title: textContent(classContent(card, "product-title") ?? ""),
    currentPrice: parsePrice(classContent(card, "product-current-price") ?? ""),
    oldPrice: parsePrice(classContent(card, "product-old-price") ?? ""),
    currency: "RUB",
    availability: textContent(classContent(card, "product-status-badge") ?? "") || "Не указано",
    properties: textContent(classContent(card, "product-properties") ?? ""),
    url: normalizeItemUrl(itemId).href,
  })).filter((offer) => offer.title && offer.currentPrice !== null);

  const categories = [];
  const seenCategories = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']*\bcid=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(decodeEntities(match[1]), source);
      const id = Number(url.searchParams.get("cid"));
      const title = textContent(match[2]);
      if (Number.isInteger(id) && id > 0 && title && !seenCategories.has(id)) {
        seenCategories.add(id);
        categories.push({ id, title });
      }
    } catch {
      // Ignore malformed navigation links; they are never fetched here.
    }
  }

  const currentPage = Number(source.searchParams.get("page") ?? 1);
  const nextPages = [];
  for (const match of String(html).matchAll(/href=["']([^"']*\bpage=\d+[^"']*)["']/gi)) {
    try {
      const url = new URL(decodeEntities(match[1]), source);
      const page = Number(url.searchParams.get("page"));
      if (Number.isInteger(page) && page > currentPage) nextPages.push(page);
    } catch {
      // Ignore malformed pagination links.
    }
  }
  const nextPage = nextPages.length ? Math.min(...nextPages) : null;
  const nextCursor = nextPage === null ? null : encodeSearchCursor({
    query: source.searchParams.get("text"),
    categoryId: source.searchParams.has("cid") ? Number(source.searchParams.get("cid")) : null,
    page: nextPage,
  });

  return { offers, categories, nextCursor };
}

function extractProductTitle(html) {
  const match = String(html).match(/<h1\b(?=[^>]*\bitemprop=["']name["'])[^>]*>([\s\S]*?)<\/h1>/i);
  return textContent(match?.[1] ?? "");
}

function extractCurrentProductPrice(html) {
  const match = String(html).match(/<div\b[^>]*class=["'][^"']*\bprice_block\b[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i);
  return parsePrice(match?.[1] ?? "");
}

function extractSpecs(html) {
  const table = String(html).match(/<table\b[^>]*class=["'][^"']*\bch\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? "";
  const specs = {};
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const name = textContent(classContent(row[1], "name") ?? "");
    const rawValue = classContent(row[1], "value");
    if (!name || rawValue === null) continue;
    specs[name] = textContent(rawValue) || true;
  }
  return specs;
}

export function parseProductPage(html, sourceUrl, verifiedAt) {
  const url = normalizeItemUrl(sourceUrl);
  const title = extractProductTitle(html);
  const pageText = textContent(html);
  const code = pageText.match(/Код товара\s*:\s*(\d+)/i)?.[1] ?? null;
  const price = extractCurrentProductPrice(html);
  const availability = textContent(classContent(html, "product_attributes") ?? "") || "Не указано";
  const specs = extractSpecs(html);

  if (!title || !code || price === null) throw parserError("Required Entero product evidence is missing");
  return {
    itemId: url.pathname.split("/").at(-1),
    code,
    article: typeof specs["Артикул"] === "string" ? specs["Артикул"] : null,
    title,
    currentPrice: price,
    currency: "RUB",
    availability,
    specs,
    url: url.href,
    verifiedAt,
  };
}
