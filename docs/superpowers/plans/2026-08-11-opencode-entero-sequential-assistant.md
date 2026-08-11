# OpenCode Entero Sequential Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing OpenCode Entero prototype into a strict research-first workflow that returns a verified primary Entero recommendation and three to five real analogs when available.

**Architecture:** Keep the primary agent, internet researcher, Entero agent, and bounded Entero adapter. Add deterministic workflow contracts for research validation and Entero filtering/ranking, expose them as local OpenCode tools, then update agent instructions to call the validators between the sequential stages.

**Tech Stack:** OpenCode 1.18.16, Node.js 22 ESM, built-in Node test runner, JavaScript OpenCode tool wrappers, `@opencode-ai/plugin` 1.18.16.

## Global Constraints

- Modify only `/home/twopotato/dev/wibe/opencode/unknown`.
- Run the workflow in OpenCode CLI.
- Enforce the order: normalize, internet research, validate research, Entero verification, validate/rank offers, answer.
- Internet sources select and explain models but never confirm Entero price, stock, availability, or URL.
- Confirm offers only from Entero `/item/<numeric-id>` pages with numeric RUB price and RFC-3339 verification time.
- Return one primary and three to five compliant analogs when they exist; report shortages and `not_found` candidates.
- Permit unavailable Entero products with a warning and rank them below available products.
- Keep Entero HTTPS GET-only and block all mutation, arbitrary browsing, shell, and file edits during searches.
- This directory is not a Git repository; use test checkpoints instead of commits and do not initialize Git.

---

### Task 1: Research Result Contract

**Files:**
- Create: `src/workflow/contracts.mjs`
- Create: `test/workflow-contracts.test.mjs`

**Interfaces:**
- Produces: `validateResearchResult(value): ResearchResult`.
- `ResearchResult` has `primary_model`, `analogs`, `selection_criteria`, `sources`, and `research_caveats`.

- [ ] Write tests with literal valid and invalid research objects. The tests must prove that the validator accepts one primary plus three unique analogs, normalizes whitespace, rejects duplicate models case-insensitively, rejects missing sources, rejects non-HTTP(S) source URLs, rejects fewer than three analogs without a caveat, and accepts a documented shortage.
- [ ] Run `node --test test/workflow-contracts.test.mjs` and verify RED because `src/workflow/contracts.mjs` does not exist.
- [ ] Implement `validateResearchResult` with structured errors `{ code: "WORKFLOW_RESEARCH_INVALID", message }`, model/search-query/why validation, unique primary/analog models, 3–5 analog limit, criteria/source validation, and defensive copies.
- [ ] Run `node --test test/workflow-contracts.test.mjs` and verify GREEN.

---

### Task 2: Entero Evidence Filtering and Ranking

**Files:**
- Modify: `src/workflow/contracts.mjs`
- Modify: `test/workflow-contracts.test.mjs`

**Interfaces:**
- Produces: `rankEnteroResults({ request, research, candidates }): RankedResult`.
- `RankedResult` has `primary`, `analogs`, `not_found`, `rejected`, and `shortfall`.

- [ ] Add tests showing that ranking: keeps a compliant researched primary; promotes the best analog when the primary is missing; rejects over-budget products and products with failed constraints; rejects unverified or non-Entero URLs; ranks available before unavailable; preserves `not_found`; caps analogs at five; and reports `shortfall` below three analogs.
- [ ] Run the focused test and verify RED because `rankEnteroResults` is missing.
- [ ] Implement the minimal deterministic filter and stable comparator. Require found candidates to have `requested_model`, `role`, `item_id`, `title`, positive integer `price_rub`, availability text, boolean `available`, numeric Entero item URL, and valid RFC-3339 `verified_at`. Match candidates only to researched model names. Enforce budget min/max and empty `failed_constraints`.
- [ ] Run the focused test and full `npm test`; verify GREEN.

---

### Task 3: OpenCode Tools and Sequential Agents

**Files:**
- Create: `.opencode/tools/procurement.js`
- Modify: `.opencode/agents/search-orchestrator.md`
- Modify: `.opencode/agents/internet-researcher.md`
- Modify: `.opencode/agents/entero-site-search.md`
- Modify: `.opencode/skills/normalize-product-request/SKILL.md`
- Modify: `.opencode/skills/validate-product-offers/SKILL.md`
- Modify: `test/opencode-config.test.mjs`

**Interfaces:**
- Exposes OpenCode tools `procurement_validate_research` and `procurement_rank_offers`.
- The first accepts JSON text and returns validated JSON or a redacted structured error.
- The second accepts normalized request, validated research, and Entero candidate arrays as JSON text and returns ranked JSON or a redacted structured error.

- [ ] Add configuration tests that allow the orchestrator exactly its existing task/skill/question permissions plus the two deterministic procurement tools, keep the internet agent web-read-only, and keep the Entero agent restricted to three bounded Entero tools. Add a TypeScript source contract test that the wrappers call the two exported workflow functions and redact errors.
- [ ] Run `node --test test/opencode-config.test.mjs` and verify RED because the procurement tools and permissions do not exist.
- [ ] Create `.opencode/tools/procurement.ts` using `tool.schema.string()` JSON arguments and pretty JSON results without stack traces, headers, credentials, or environment data.
- [ ] Update `normalize-product-request` to emit `site_id: "entero"` and `analog_count: { min: 3, max: 5 }`.
- [ ] Update `internet-researcher` to return the exact research contract, one primary, 3–5 distinct analogs when defensible, reasons, normalized search queries, criteria, sources, and shortage caveats.
- [ ] Update `search-orchestrator` to call and await only the researcher first, validate with `procurement_validate_research`, then and only then send the full normalized request plus validated research to `entero-site-search`, then call `procurement_rank_offers` before answering.
- [ ] Update `entero-site-search` to search the primary and every analog separately, permit one normalized retry per missing model, verify every found product page, and return explicit `found`/`not_found` candidate outcomes.
- [ ] Update `validate-product-offers` to document primary promotion, availability ordering, explicit missing candidates, and analog shortage output.
- [ ] Run `node --test test/opencode-config.test.mjs`, `npm test`, and TypeScript tool loading through the installed OpenCode CLI; verify GREEN.
- [ ] Pressure-test the agent workflow with the live CLI when provider access is available. The observable success condition is that the task trace completes internet research before the first Entero task, and the final answer contains only ranked tool output for commercial fields.

---

### Task 4: CLI Documentation and Final Verification

**Files:**
- Create: `README.md`
- Create: `opencode-entero`
- Create: `test/opencode-wrapper.test.mjs`

**Interfaces:**
- Documents local launch, sample request, sequential flow, response contract, tests, and safety.

- [ ] Create and test `opencode-entero`, a project wrapper that always adds OpenCode `--pure` so global plugins cannot alter the local agent graph.
- [ ] Create `README.md` with `cd /home/twopotato/dev/wibe/opencode/unknown`, `./opencode-entero .`, the approved coffee-machine example, the research-then-Entero flow, primary plus 3–5 analog behavior, product-page price provenance, missing/unavailable behavior, `npm test`, and read-only restrictions.
- [ ] Run `npm test` and all syntax checks.
- [ ] Run `opencode --version` and `opencode agent list`; if the sandbox blocks the global log path, request approval rather than altering global configuration.
- [ ] Run the live read-only command when provider access is available: `./opencode-entero run --agent search-orchestrator "Нужна кофемашина для небольшой кофейни до 100 тысяч рублей."`.
- [ ] Report passing test counts, CLI validation, live acceptance status or exact blocker, changed files, and the absence of a Git commit because the directory is not a repository.
