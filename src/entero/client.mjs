import { parseProductPage, parseSearchPage } from "./parser.mjs";
import {
  assertAllowedEnteroUrl,
  buildSearchUrl,
  decodeSearchCursor,
  normalizeItemUrl,
} from "./policy.mjs";

const TIMEOUT_MS = 8000;
const USER_AGENT = "OpenCode-Entero-ReadOnly/1.0 (+public-product-search)";

function structuredError(code, message, sourceUrl) {
  const error = new Error(message);
  error.code = code;
  error.sourceUrl = sourceUrl;
  return error;
}

function normalizeLimit(value = 5) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw structuredError("ENTERO_INPUT_ERROR", "limit must be an integer from 1 to 10", null);
  }
  return limit;
}

function normalizeMaxPrice(value) {
  if (value === undefined || value === null) return null;
  const maxPrice = Number(value);
  if (!Number.isInteger(maxPrice) || maxPrice <= 0) {
    throw structuredError("ENTERO_INPUT_ERROR", "maxPrice must be a positive integer", null);
  }
  return maxPrice;
}

async function fetchAllowedHtml(input, deps = {}) {
  const requested = assertAllowedEnteroUrl(input);
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(requested.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      });
      if (response.status >= 300 && response.status < 400) {
        throw structuredError("ENTERO_REDIRECT_DENIED", "Entero redirects are not followed", requested.href);
      }
      const finalUrl = assertAllowedEnteroUrl(response.url);
      if (!response.ok) {
        throw structuredError("ENTERO_HTTP_ERROR", `Entero returned HTTP ${response.status}`, finalUrl.href);
      }
      return { html: await response.text(), sourceUrl: finalUrl.href };
    } catch (error) {
      if (typeof error?.code === "string" && error.code.startsWith("ENTERO_")) throw error;
      if (attempt === 0) continue;
      const timedOut = error?.name === "AbortError" || controller.signal.aborted;
      throw structuredError(
        timedOut ? "ENTERO_TIMEOUT" : "ENTERO_NETWORK_ERROR",
        timedOut ? "Entero request timed out" : "Entero request failed",
        requested.href,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  throw structuredError("ENTERO_NETWORK_ERROR", "Entero request failed", requested.href);
}

async function searchByState({ query, categoryId = null, page = 1, maxPrice, limit }, deps) {
  const requestedUrl = buildSearchUrl({ query, categoryId, page });
  const { html, sourceUrl } = await fetchAllowedHtml(requestedUrl, deps);
  const parsed = parseSearchPage(html, sourceUrl);
  const ceiling = normalizeMaxPrice(maxPrice);
  const resultLimit = normalizeLimit(limit);
  const rawOffers = parsed.offers.slice(0, 20);
  const offers = rawOffers
    .filter((offer) => ceiling === null || offer.currentPrice <= ceiling)
    .slice(0, resultLimit);
  return {
    query,
    sourceUrl,
    offers,
    categories: parsed.categories,
    nextCursor: parsed.nextCursor,
  };
}

export async function searchEntero(args, deps = {}) {
  return searchByState({
    query: args.query,
    categoryId: args.categoryId ?? null,
    page: args.page ?? 1,
    maxPrice: args.maxPrice,
    limit: args.limit ?? 5,
  }, deps);
}

export async function readEnteroNextPage(cursor, args = {}, deps = {}) {
  const state = decodeSearchCursor(cursor);
  return searchByState({
    ...state,
    maxPrice: args.maxPrice,
    limit: args.limit ?? 5,
  }, deps);
}

export async function readEnteroProduct(item, deps = {}) {
  const requestedUrl = normalizeItemUrl(item);
  const { html, sourceUrl } = await fetchAllowedHtml(requestedUrl, deps);
  const now = deps.now ?? (() => new Date());
  return parseProductPage(html, sourceUrl, now().toISOString());
}
