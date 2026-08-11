const ORIGIN = "https://entero.ru";

function policyError(message) {
  const error = new Error(message);
  error.code = "ENTERO_POLICY_ERROR";
  return error;
}

function positiveInteger(value, name, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw policyError(`Invalid ${name}`);
  return number;
}

export function buildSearchUrl({ query, categoryId = null, page = 1 }) {
  const text = String(query ?? "").trim();
  if (!text) throw policyError("Invalid search text");

  const url = new URL("/search.php", ORIGIN);
  url.searchParams.set("text", text);
  const category = positiveInteger(categoryId, "category id", { optional: true });
  if (category !== null) url.searchParams.set("cid", String(category));
  const pageNumber = positiveInteger(page, "page");
  if (pageNumber !== 1) url.searchParams.set("page", String(pageNumber));
  return assertAllowedEnteroUrl(url);
}

export function normalizeItemUrl(item) {
  if (typeof item === "number" || /^\d+$/.test(String(item))) {
    const id = positiveInteger(item, "item id");
    return assertAllowedEnteroUrl(new URL(`/item/${id}`, ORIGIN));
  }
  try {
    return assertAllowedEnteroUrl(new URL(String(item)));
  } catch {
    throw policyError("Invalid Entero item URL");
  }
}

export function assertAllowedEnteroUrl(input) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(String(input));
  } catch {
    throw policyError("Invalid URL");
  }

  if (url.origin !== ORIGIN || url.username || url.password || url.hash) {
    throw policyError("URL is not allowed");
  }

  if (/^\/item\/\d+$/.test(url.pathname) && !url.search) return url;
  if (url.pathname !== "/search.php") throw policyError("URL is not allowed");

  const keys = [...url.searchParams.keys()];
  if (!keys.length || keys.some((key) => !["text", "cid", "page"].includes(key))) {
    throw policyError("URL is not allowed");
  }
  for (const key of new Set(keys)) {
    if (url.searchParams.getAll(key).length !== 1) throw policyError("URL is not allowed");
  }
  if (!url.searchParams.get("text")?.trim()) throw policyError("Invalid search text");
  if (url.searchParams.has("cid")) positiveInteger(url.searchParams.get("cid"), "category id");
  if (url.searchParams.has("page")) positiveInteger(url.searchParams.get("page"), "page");
  return url;
}

export function encodeSearchCursor({ query, categoryId = null, page }) {
  const validated = buildSearchUrl({ query, categoryId, page });
  const state = {
    query: validated.searchParams.get("text"),
    categoryId: validated.searchParams.has("cid") ? Number(validated.searchParams.get("cid")) : null,
    page: validated.searchParams.has("page") ? Number(validated.searchParams.get("page")) : 1,
  };
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

export function decodeSearchCursor(cursor) {
  try {
    const state = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (!state || typeof state !== "object") throw new Error("invalid");
    const validated = buildSearchUrl({
      query: state.query,
      categoryId: state.categoryId ?? null,
      page: state.page,
    });
    return {
      query: validated.searchParams.get("text"),
      categoryId: validated.searchParams.has("cid") ? Number(validated.searchParams.get("cid")) : null,
      page: validated.searchParams.has("page") ? Number(validated.searchParams.get("page")) : 1,
    };
  } catch {
    throw policyError("Invalid search cursor");
  }
}
