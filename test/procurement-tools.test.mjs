import assert from "node:assert/strict";
import test from "node:test";

const tools = await import("../.opencode/tools/procurement.js").catch(() => ({}));
const { rank_offers: rankOffers, validate_research: validateResearch } = tools;

const research = {
  primary_model: { model: "Model Primary", search_query: "Model Primary", why: ["Fit"] },
  analogs: [
    { model: "Model A", search_query: "Model A", why: ["Similar"] },
    { model: "Model B", search_query: "Model B", why: ["Similar"] },
    { model: "Model C", search_query: "Model C", why: ["Similar"] },
  ],
  selection_criteria: [{ name: "Capacity", reason: "Workload" }],
  sources: [{ title: "Catalogue", url: "https://example.com/catalogue", supports: "Specs" }],
  research_caveats: [],
};

test("procurement_validate_research executes the real workflow validator", async () => {
  assert.equal(typeof validateResearch?.execute, "function", "validate_research tool must exist");
  const output = JSON.parse(await validateResearch.execute({
    research_json: JSON.stringify(research),
  }, {}));
  assert.equal(output.primary_model.model, "Model Primary");
  assert.equal(output.analogs.length, 3);
});

test("procurement_validate_research redacts malformed JSON errors", async () => {
  const output = JSON.parse(await validateResearch.execute({ research_json: "{" }, {}));
  assert.deepEqual(output, {
    error: {
      code: "WORKFLOW_INPUT_INVALID",
      message: "research_json must contain valid JSON",
    },
  });
  assert.equal("stack" in output.error, false);
});

test("procurement_rank_offers executes filtering and ranking", async () => {
  assert.equal(typeof rankOffers?.execute, "function", "rank_offers tool must exist");
  const request = { budget: { min: null, max: 100000, currency: "RUB" } };
  const candidates = [{
    requested_model: "Model Primary",
    role: "primary",
    status: "found",
    title: "Model Primary Entero",
    item_id: "123",
    price_rub: 99990,
    availability: "В наличии",
    available: true,
    url: "https://entero.ru/item/123",
    verified_at: "2026-08-11T10:15:30.000Z",
    matched_constraints: [],
    failed_constraints: [],
    caveats: [],
  }];
  const output = JSON.parse(await rankOffers.execute({
    request_json: JSON.stringify(request),
    research_json: JSON.stringify(research),
    candidates_json: JSON.stringify(candidates),
  }, {}));
  assert.equal(output.primary.item_id, "123");
  assert.deepEqual(output.shortfall, { required: 3, actual: 0, missing: 3 });
});
