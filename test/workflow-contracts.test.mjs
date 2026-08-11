import assert from "node:assert/strict";
import test from "node:test";

const workflow = await import("../src/workflow/contracts.mjs").catch(() => ({}));
const { rankEnteroResults, validateResearchResult } = workflow;

function validResearch() {
  return {
    primary_model: {
      model: "  Nuova Simonelli Appia II Compact  ",
      search_query: " Nuova Simonelli Appia II Compact ",
      why: [" Подходит для небольшой кофейни "],
    },
    analogs: [
      {
        model: "Nuova Simonelli Oscar II",
        search_query: "Nuova Simonelli Oscar II",
        why: ["Компактнее", "Меньшая производительность"],
      },
      {
        model: "Lelit Giulietta X",
        search_query: "Lelit Giulietta X",
        why: ["Две группы", "Выше требования к месту"],
      },
      {
        model: "La Spaziale S2 EK",
        search_query: "La Spaziale S2 EK",
        why: ["Профессиональная группа", "Ручное дозирование"],
      },
    ],
    selection_criteria: [
      { name: "Производительность", reason: "Определяет работу в часы пик" },
    ],
    sources: [
      {
        title: "Manufacturer catalogue",
        url: "https://example.com/catalogue",
        supports: "Характеристики моделей",
      },
    ],
    research_caveats: [],
  };
}

function assertResearchError(fn, messagePattern) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, "WORKFLOW_RESEARCH_INVALID");
    assert.match(error.message, messagePattern);
    return true;
  });
}

test("accepts and normalizes a sourced primary model with three unique analogs", () => {
  assert.equal(typeof validateResearchResult, "function", "research validator must exist");
  const result = validateResearchResult(validResearch());

  assert.equal(result.primary_model.model, "Nuova Simonelli Appia II Compact");
  assert.equal(result.primary_model.why[0], "Подходит для небольшой кофейни");
  assert.equal(result.analogs.length, 3);
  assert.notEqual(result, validResearch());
});

test("rejects duplicate candidate models case-insensitively", () => {
  const input = validResearch();
  input.analogs[1].model = "nuova simonelli appia ii compact";
  assertResearchError(() => validateResearchResult(input), /duplicate model/i);
});

test("rejects research without supporting sources", () => {
  const input = validResearch();
  input.sources = [];
  assertResearchError(() => validateResearchResult(input), /source/i);
});

test("rejects a non-HTTP research source URL", () => {
  const input = validResearch();
  input.sources[0].url = "javascript:alert(1)";
  assertResearchError(() => validateResearchResult(input), /source URL/i);
});

test("rejects fewer than three analogs without a documented shortage", () => {
  const input = validResearch();
  input.analogs = input.analogs.slice(0, 2);
  assertResearchError(() => validateResearchResult(input), /at least 3 analogs/i);
});

test("accepts fewer than three analogs when the research documents the shortage", () => {
  const input = validResearch();
  input.analogs = input.analogs.slice(0, 2);
  input.research_caveats = ["Для этого бюджета удалось обосновать только два аналога"];

  const result = validateResearchResult(input);
  assert.equal(result.analogs.length, 2);
  assert.deepEqual(result.research_caveats, ["Для этого бюджета удалось обосновать только два аналога"]);
});

function request(max = 500000) {
  return {
    raw_request: "Нужна кофемашина",
    product_type: "кофемашина",
    intended_use: "небольшая кофейня",
    budget: { min: null, max, currency: "RUB" },
    hard_constraints: [],
    preferences: [],
    excluded: [],
    site_id: "entero",
    analog_count: { min: 3, max: 5 },
  };
}

function foundCandidate({
  requestedModel,
  role = "analog",
  itemId,
  price,
  available = true,
  matched = [],
  failed = [],
  url = `https://entero.ru/item/${itemId}`,
  verifiedAt = "2026-08-11T10:15:30.000Z",
}) {
  return {
    requested_model: requestedModel,
    role,
    status: "found",
    title: `${requestedModel} Entero card`,
    item_id: String(itemId),
    price_rub: price,
    availability: available ? "В наличии" : "Нет в наличии",
    available,
    url,
    verified_at: verifiedAt,
    matched_constraints: matched,
    failed_constraints: failed,
    caveats: [],
  };
}

function notFoundCandidate(requestedModel, role = "analog") {
  return {
    requested_model: requestedModel,
    role,
    status: "not_found",
    reason: "Модель не найдена на Entero",
  };
}

test("keeps a verified research primary and ranks available analogs first", () => {
  assert.equal(typeof rankEnteroResults, "function", "Entero ranker must exist");
  const research = validResearch();
  const result = rankEnteroResults({
    request: request(),
    research,
    candidates: [
      foundCandidate({ requestedModel: research.primary_model.model.trim(), role: "primary", itemId: 100, price: 200000 }),
      foundCandidate({ requestedModel: research.analogs[0].model, itemId: 101, price: 90000, available: false }),
      foundCandidate({ requestedModel: research.analogs[1].model, itemId: 102, price: 180000 }),
      foundCandidate({ requestedModel: research.analogs[2].model, itemId: 103, price: 190000 }),
    ],
  });

  assert.equal(result.primary.requested_model, "Nuova Simonelli Appia II Compact");
  assert.deepEqual(result.analogs.map(({ item_id }) => item_id), ["102", "103", "101"]);
  assert.equal(result.shortfall, null);
});

test("promotes the best available analog when the researched primary is absent", () => {
  const research = validResearch();
  const result = rankEnteroResults({
    request: request(),
    research,
    candidates: [
      notFoundCandidate(research.primary_model.model.trim(), "primary"),
      foundCandidate({ requestedModel: research.analogs[0].model, itemId: 201, price: 120000, matched: ["compact"] }),
      foundCandidate({ requestedModel: research.analogs[1].model, itemId: 202, price: 100000 }),
      foundCandidate({ requestedModel: research.analogs[2].model, itemId: 203, price: 110000 }),
    ],
  });

  assert.equal(result.primary.item_id, "201");
  assert.equal(result.primary.original_role, "analog");
  assert.match(result.primary.promotion_reason, /primary.*not found/i);
  assert.equal(result.not_found[0].requested_model, "Nuova Simonelli Appia II Compact");
  assert.deepEqual(result.shortfall, { required: 3, actual: 2, missing: 1 });
});

test("promotes an available analog above an unavailable researched primary", () => {
  const research = validResearch();
  const result = rankEnteroResults({
    request: request(),
    research,
    candidates: [
      foundCandidate({ requestedModel: research.primary_model.model.trim(), role: "primary", itemId: 300, price: 100000, available: false }),
      foundCandidate({ requestedModel: research.analogs[0].model, itemId: 301, price: 130000 }),
      foundCandidate({ requestedModel: research.analogs[1].model, itemId: 302, price: 140000 }),
      foundCandidate({ requestedModel: research.analogs[2].model, itemId: 303, price: 150000 }),
    ],
  });

  assert.equal(result.primary.item_id, "301");
  assert.equal(result.analogs.at(-1).item_id, "300");
});

test("rejects over-budget, failed-constraint, and unverified candidates", () => {
  const research = validResearch();
  const result = rankEnteroResults({
    request: request(100000),
    research,
    candidates: [
      foundCandidate({ requestedModel: research.primary_model.model.trim(), role: "primary", itemId: 400, price: 99000 }),
      foundCandidate({ requestedModel: research.analogs[0].model, itemId: 401, price: 120000 }),
      foundCandidate({ requestedModel: research.analogs[1].model, itemId: 402, price: 90000, failed: ["wrong voltage"] }),
      foundCandidate({ requestedModel: research.analogs[2].model, itemId: 403, price: 80000, url: "https://example.com/item/403" }),
    ],
  });

  assert.equal(result.primary.item_id, "400");
  assert.deepEqual(result.rejected.map(({ reason }) => reason), [
    "over_budget",
    "failed_constraints",
    "invalid_evidence",
  ]);
  assert.deepEqual(result.shortfall, { required: 3, actual: 0, missing: 3 });
});

test("preserves explicit not-found outcomes", () => {
  const research = validResearch();
  const result = rankEnteroResults({
    request: request(),
    research,
    candidates: [
      notFoundCandidate(research.primary_model.model.trim(), "primary"),
      notFoundCandidate(research.analogs[0].model),
      notFoundCandidate(research.analogs[1].model),
      notFoundCandidate(research.analogs[2].model),
    ],
  });

  assert.equal(result.primary, null);
  assert.equal(result.not_found.length, 4);
  assert.deepEqual(result.shortfall, { required: 3, actual: 0, missing: 3 });
});

test("caps returned analogs at five", () => {
  const research = validResearch();
  research.analogs.push(
    { model: "Rancilio Classe 5", search_query: "Rancilio Classe 5", why: ["Надёжная"] },
    { model: "Casadio Undici", search_query: "Casadio Undici", why: ["Компактная"] },
  );
  const candidates = [
    foundCandidate({ requestedModel: research.primary_model.model.trim(), role: "primary", itemId: 500, price: 200000 }),
    ...research.analogs.map((analog, index) => foundCandidate({
      requestedModel: analog.model,
      itemId: 501 + index,
      price: 210000 + index * 1000,
    })),
  ];

  const result = rankEnteroResults({ request: request(), research, candidates });
  assert.equal(result.analogs.length, 5);
});
