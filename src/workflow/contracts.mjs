function workflowError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function researchError(message) {
  return workflowError("WORKFLOW_RESEARCH_INVALID", message);
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw researchError(`${name} must be an object`);
  }
  return value;
}

function text(value, name) {
  if (typeof value !== "string") throw researchError(`${name} must be a string`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw researchError(`${name} must not be empty`);
  return normalized;
}

function textList(value, name, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw researchError(`${name} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  return value.map((item, index) => text(item, `${name}[${index}]`));
}

function modelCandidate(value, name) {
  const candidate = object(value, name);
  return {
    model: text(candidate.model, `${name}.model`),
    search_query: text(candidate.search_query, `${name}.search_query`),
    why: textList(candidate.why, `${name}.why`),
  };
}

function selectionCriterion(value, index) {
  const criterion = object(value, `selection_criteria[${index}]`);
  return {
    name: text(criterion.name, `selection_criteria[${index}].name`),
    reason: text(criterion.reason, `selection_criteria[${index}].reason`),
  };
}

function researchSource(value, index) {
  const source = object(value, `sources[${index}]`);
  const urlText = text(source.url, `sources[${index}].url`);
  let url;
  try {
    url = new URL(urlText);
  } catch {
    throw researchError(`Invalid source URL at sources[${index}]`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw researchError(`Invalid source URL at sources[${index}]`);
  }
  return {
    title: text(source.title, `sources[${index}].title`),
    url: url.href,
    supports: text(source.supports, `sources[${index}].supports`),
  };
}

export function validateResearchResult(value) {
  const input = object(value, "research result");
  const primaryModel = modelCandidate(input.primary_model, "primary_model");

  if (!Array.isArray(input.analogs)) throw researchError("analogs must be an array");
  if (input.analogs.length > 5) throw researchError("Research must contain at most 5 analogs");
  const analogs = input.analogs.map((candidate, index) => modelCandidate(candidate, `analogs[${index}]`));
  const researchCaveats = textList(input.research_caveats ?? [], "research_caveats", { allowEmpty: true });
  if (analogs.length < 3 && researchCaveats.length === 0) {
    throw researchError("Research must contain at least 3 analogs or document the shortage");
  }

  const normalizedModels = [primaryModel, ...analogs].map(({ model }) => model.toLocaleLowerCase("ru-RU"));
  if (new Set(normalizedModels).size !== normalizedModels.length) {
    throw researchError("Research contains a duplicate model");
  }

  if (!Array.isArray(input.selection_criteria) || input.selection_criteria.length === 0) {
    throw researchError("Research must contain at least one selection criterion");
  }
  const selectionCriteria = input.selection_criteria.map(selectionCriterion);

  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw researchError("Research must contain at least one source");
  }
  const sources = input.sources.map(researchSource);

  return {
    primary_model: primaryModel,
    analogs,
    selection_criteria: selectionCriteria,
    sources,
    research_caveats: researchCaveats,
  };
}

function rankError(message) {
  return workflowError("WORKFLOW_RANK_INVALID", message);
}

function rankObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw rankError(`${name} must be an object`);
  }
  return value;
}

function rankText(value, name) {
  if (typeof value !== "string") throw rankError(`${name} must be a string`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw rankError(`${name} must not be empty`);
  return normalized;
}

function rankTextList(value, name) {
  if (!Array.isArray(value)) throw rankError(`${name} must be an array`);
  return value.map((item, index) => rankText(item, `${name}[${index}]`));
}

function modelKey(value) {
  return String(value).replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU");
}

function normalizeBudget(value) {
  const budget = rankObject(value, "request.budget");
  const normalizeBound = (bound, name) => {
    if (bound === null || bound === undefined) return null;
    if (!Number.isInteger(bound) || bound <= 0) throw rankError(`${name} must be a positive integer or null`);
    return bound;
  };
  return {
    min: normalizeBound(budget.min, "request.budget.min"),
    max: normalizeBound(budget.max, "request.budget.max"),
    currency: rankText(budget.currency, "request.budget.currency"),
  };
}

function isValidTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function normalizeFoundCandidate(candidate, expected, index) {
  const itemId = rankText(candidate.item_id, `candidates[${index}].item_id`);
  if (!/^\d+$/.test(itemId) || Number(itemId) <= 0) throw rankError("item_id must be numeric");
  const urlText = rankText(candidate.url, `candidates[${index}].url`);
  let url;
  try {
    url = new URL(urlText);
  } catch {
    throw rankError("candidate URL is invalid");
  }
  if (url.origin !== "https://entero.ru" || url.pathname !== `/item/${itemId}` || url.search || url.hash) {
    throw rankError("candidate URL is not a verified Entero item URL");
  }
  if (!Number.isInteger(candidate.price_rub) || candidate.price_rub <= 0) {
    throw rankError("price_rub must be a positive integer");
  }
  if (typeof candidate.available !== "boolean") throw rankError("available must be boolean");
  if (!isValidTimestamp(candidate.verified_at)) throw rankError("verified_at must be RFC-3339");

  return {
    requested_model: expected.model,
    role: expected.role,
    status: "found",
    title: rankText(candidate.title, `candidates[${index}].title`),
    item_id: itemId,
    price_rub: candidate.price_rub,
    availability: rankText(candidate.availability, `candidates[${index}].availability`),
    available: candidate.available,
    url: url.href,
    verified_at: candidate.verified_at,
    matched_constraints: rankTextList(candidate.matched_constraints ?? [], `candidates[${index}].matched_constraints`),
    failed_constraints: rankTextList(candidate.failed_constraints ?? [], `candidates[${index}].failed_constraints`),
    caveats: rankTextList(candidate.caveats ?? [], `candidates[${index}].caveats`),
    research_index: expected.researchIndex,
  };
}

function rankedCandidate(candidate) {
  const { research_index: _, ...evidence } = candidate;
  return evidence;
}

export function rankEnteroResults(value) {
  const input = rankObject(value, "ranking input");
  const request = rankObject(input.request, "request");
  const budget = normalizeBudget(request.budget);
  const research = validateResearchResult(input.research);
  if (!Array.isArray(input.candidates)) throw rankError("candidates must be an array");

  const expectedModels = new Map();
  expectedModels.set(modelKey(research.primary_model.model), {
    model: research.primary_model.model,
    role: "primary",
    researchIndex: 0,
  });
  research.analogs.forEach((analog, index) => {
    expectedModels.set(modelKey(analog.model), {
      model: analog.model,
      role: "analog",
      researchIndex: index + 1,
    });
  });

  const found = [];
  const notFound = [];
  const rejected = [];
  const seenItemIds = new Set();

  input.candidates.forEach((rawCandidate, index) => {
    let candidate;
    try {
      candidate = rankObject(rawCandidate, `candidates[${index}]`);
      const requestedModel = rankText(candidate.requested_model, `candidates[${index}].requested_model`);
      const expected = expectedModels.get(modelKey(requestedModel));
      if (!expected || candidate.role !== expected.role) throw rankError("candidate does not match researched model and role");

      if (candidate.status === "not_found") {
        notFound.push({
          requested_model: expected.model,
          role: expected.role,
          status: "not_found",
          reason: rankText(candidate.reason, `candidates[${index}].reason`),
        });
        return;
      }
      if (candidate.status !== "found") throw rankError("candidate status must be found or not_found");

      const normalized = normalizeFoundCandidate(candidate, expected, index);
      if (seenItemIds.has(normalized.item_id)) {
        rejected.push({ requested_model: expected.model, reason: "duplicate_item" });
        return;
      }
      seenItemIds.add(normalized.item_id);
      if (budget.max !== null && normalized.price_rub > budget.max) {
        rejected.push({ requested_model: expected.model, reason: "over_budget" });
        return;
      }
      if (budget.min !== null && normalized.price_rub < budget.min) {
        rejected.push({ requested_model: expected.model, reason: "below_budget" });
        return;
      }
      if (normalized.failed_constraints.length > 0) {
        rejected.push({ requested_model: expected.model, reason: "failed_constraints" });
        return;
      }
      found.push(normalized);
    } catch (error) {
      const requestedModel = typeof candidate?.requested_model === "string"
        ? candidate.requested_model.replace(/\s+/g, " ").trim()
        : null;
      rejected.push({ requested_model: requestedModel, reason: "invalid_evidence" });
    }
  });

  found.sort((left, right) => {
    if (left.available !== right.available) return left.available ? -1 : 1;
    if (left.matched_constraints.length !== right.matched_constraints.length) {
      return right.matched_constraints.length - left.matched_constraints.length;
    }
    if (left.role !== right.role) return left.role === "primary" ? -1 : 1;
    if (left.price_rub !== right.price_rub) return left.price_rub - right.price_rub;
    return left.research_index - right.research_index;
  });

  const winner = found[0] ?? null;
  let primary = winner ? { ...rankedCandidate(winner), original_role: winner.role, role: "primary" } : null;
  if (primary && winner.role !== "primary") {
    const researchedPrimaryMissing = notFound.some(({ role }) => role === "primary");
    primary.promotion_reason = researchedPrimaryMissing
      ? "Researched primary model was not found on Entero"
      : "Higher-ranked compliant analog replaced the researched primary";
  }

  const analogs = found.slice(1, 6).map((candidate) => ({
    ...rankedCandidate(candidate),
    original_role: candidate.role,
    role: "analog",
  }));
  const shortfall = analogs.length >= 3 ? null : {
    required: 3,
    actual: analogs.length,
    missing: 3 - analogs.length,
  };

  return {
    primary,
    analogs,
    not_found: notFound,
    rejected,
    shortfall,
  };
}
