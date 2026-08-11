# OpenCode Entero Search Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a folder-local, read-only OpenCode agent system that converts abstract Russian product requests into verified Entero offers with exact models, current RUB prices, availability, links, and timestamps.

**Architecture:** A primary `search-orchestrator` delegates in parallel to an internet researcher and a source-specific Entero subagent. The Entero subagent can call only three bounded custom tools backed by a pure JavaScript policy, parser, and HTTP client; all mutations and off-domain requests are rejected before network access.

**Tech Stack:** OpenCode 1.18.16 project JSONC and Markdown agents, TypeScript custom-tool wrappers, Node.js 22 ESM, built-in `fetch`, Node test runner, no third-party runtime dependencies.

## Global Constraints

- Modify only `/home/twopotato/dev/wibe/opencode/unknown`; never change `~/.config/opencode`, `~/.local/share/opencode`, or another profile.
- Use `openai/gpt-5.6-terra-fast` for the orchestrator and Entero subagent, and `openai/gpt-5.6-luna-fast` for internet research.
- Permit only public Entero reads; no credentials are required or stored.
- Entero runtime network operations are GET-only and restricted to `https://entero.ru/search.php` and `https://entero.ru/item/<numeric-id>`.
- Block cart, favorites, quick order, callbacks, account/profile changes, checkout, external redirects, arbitrary browser operations, shell access, and file edits during search sessions.
- Internet research cannot establish Entero price, availability, or stock.
- A confirmed offer must include an exact title, numeric current RUB price, direct `/item/<id>` URL, and RFC-3339 verification timestamp.
- Hard maximum budgets are never exceeded in confirmed results.
- The existing `.git` directory is not a valid repository. Do not initialize, delete, or repair Git. Replace commit steps with explicit test checkpoints.

## File Map

- `package.json`: dependency-free Node test commands.
- `.gitignore`: ignores runtime and browser artifacts without altering any external state.
- `src/request/normalize.mjs`: deterministic Russian budget normalization used by tests and tools.
- `src/entero/policy.mjs`: URL construction, allowlist validation, cursor encoding, and redirect policy.
- `src/entero/parser.mjs`: pure Entero search and product HTML parsers.
- `src/entero/client.mjs`: bounded GET client, one retry, local filtering, product verification, and structured errors.
- `.opencode/tools/entero.ts`: OpenCode tool schemas and JSON-returning wrappers.
- `.opencode/opencode.jsonc`: folder-local defaults, agent selection, and secure global permission baseline.
- `.opencode/agents/search-orchestrator.md`: primary routing and final validation prompt.
- `.opencode/agents/internet-researcher.md`: read-only general research prompt.
- `.opencode/agents/entero-site-search.md`: source-specific prompt with only `entero_*` tools.
- `.opencode/skills/normalize-product-request/SKILL.md`: request normalization rules.
- `.opencode/skills/validate-product-offers/SKILL.md`: provenance, budget, and ranking rules.
- `test/fixtures/entero-search.html`: minimal representative result cards, including a discount.
- `test/fixtures/entero-product.html`: minimal representative product page.
- `test/normalize.test.mjs`: colloquial Russian budget tests.
- `test/entero-policy.test.mjs`: safe-route and mutation-blocking tests.
- `test/entero-parser.test.mjs`: search/product extraction tests.
- `test/entero-client.test.mjs`: retries, redirects, filtering, and product-page precedence.
- `test/opencode-config.test.mjs`: local config, models, agent modes, and permission isolation.
- `README.md`: launch, usage, output, verification, and safety notes.

---

### Task 1: Project Test Harness and Request Normalization

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/request/normalize.mjs`
- Create: `test/normalize.test.mjs`

**Interfaces:**
- Consumes: raw Russian product request as `string`.
- Produces: `normalizeBudgetExpression(text: string): { min: number|null, max: number|null, currency: "RUB" }`.

- [ ] **Step 1: Add the dependency-free test harness**

Create `package.json` with:

```json
{
  "name": "opencode-entero-search",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "test:unit": "node --test test/*.test.mjs"
  }
}
```

Create `.gitignore` with `node_modules/`, `.playwright-cli/`, `.opencode/runtime/`, and `*.log`.

- [ ] **Step 2: Write the failing normalization tests**

Test these exact cases:

```js
assert.deepEqual(normalizeBudgetExpression("телефон за 20 тысяч"), { min: null, max: 20000, currency: "RUB" })
assert.deepEqual(normalizeBudgetExpression("кофемашина до 100к"), { min: null, max: 100000, currency: "RUB" })
assert.deepEqual(normalizeBudgetExpression("нужен миксер за 20 кэсов"), { min: null, max: 20000, currency: "RUB" })
assert.deepEqual(normalizeBudgetExpression("от 30 000 до 50 000 рублей"), { min: 30000, max: 50000, currency: "RUB" })
assert.deepEqual(normalizeBudgetExpression("нужна кофемолка"), { min: null, max: null, currency: "RUB" })
```

- [ ] **Step 3: Run the tests and verify RED**

Run: `npm test -- test/normalize.test.mjs`

Expected: FAIL because `src/request/normalize.mjs` does not exist.

- [ ] **Step 4: Implement deterministic normalization**

Implement helpers that normalize non-breaking spaces, parse `тысяч`, `тыс`, `к`, and `кэсов`, distinguish `до`/`за` as a maximum, and parse an explicit `от ... до ...` range. Return integers only; never infer a non-RUB currency.

- [ ] **Step 5: Run the tests and record the checkpoint**

Run: `npm test -- test/normalize.test.mjs`

Expected: 5 tests PASS. Record the output; skip Git commit because this directory is not a repository.

---

### Task 2: Entero URL Policy and Search Cursors

**Files:**
- Create: `src/entero/policy.mjs`
- Create: `test/entero-policy.test.mjs`

**Interfaces:**
- Produces:
  - `buildSearchUrl({ query, categoryId, page }): URL`
  - `normalizeItemUrl(item: string|number): URL`
  - `assertAllowedEnteroUrl(input: string|URL): URL`
  - `encodeSearchCursor(state): string`
  - `decodeSearchCursor(cursor): { query: string, categoryId: number|null, page: number }`

- [ ] **Step 1: Write failing allowlist tests**

Cover exact valid URLs:

```text
https://entero.ru/search.php?text=кофемашина
https://entero.ru/search.php?text=кофемашина&cid=78
https://entero.ru/search.php?text=кофемашина&page=2
https://entero.ru/item/122375
```

Cover exact rejections: HTTP instead of HTTPS, another origin, `/cart/`, `/ajax/cart/set_amount/`, `/cabinet/`, `/profile/`, `/checkout/`, `javascript:`, nonnumeric `cid`, nonpositive `page`, unknown query keys, and an item URL with a nonnumeric ID.

- [ ] **Step 2: Run the policy tests and verify RED**

Run: `npm test -- test/entero-policy.test.mjs`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the closed allowlist**

Use `new URL()` and require `url.origin === "https://entero.ru"`. Permit only `/search.php` with `text` plus optional numeric `cid` and positive `page`, or `/item/<digits>`. Sort generated query parameters as `text`, `cid`, `page`. Encode cursors as base64url JSON and validate decoded state through `buildSearchUrl` before returning it.

- [ ] **Step 4: Run the policy tests and record the checkpoint**

Run: `npm test -- test/entero-policy.test.mjs`

Expected: all policy and cursor tests PASS.

---

### Task 3: Pure Entero HTML Parsers

**Files:**
- Create: `src/entero/parser.mjs`
- Create: `test/fixtures/entero-search.html`
- Create: `test/fixtures/entero-product.html`
- Create: `test/entero-parser.test.mjs`

**Interfaces:**
- Produces:
  - `parsePrice(text: string): number|null`
  - `parseSearchPage(html: string, sourceUrl: string): { offers: SearchOffer[], categories: Category[], nextCursor: string|null }`
  - `parseProductPage(html: string, sourceUrl: string, verifiedAt: string): ConfirmedOffer`

- [ ] **Step 1: Create minimal fixtures from verified Entero structures**

The search fixture must include two `.product-wrapper` blocks using `data-index`, `.product-status-badge`, `.product-title`, `.product-properties`, `.product-current-price`, and optional `.product-old-price`; it must also include category links with numeric `cid` and a page-2 link. The product fixture must include `h1[itemprop=name]`, `Код товара`, `.price_block .price span`, `.product_attributes`, and `table.ch` rows with `.name` and `.value` cells, including `Артикул`.

- [ ] **Step 2: Write failing parser tests**

Assert that search parsing returns item IDs `122375` and `122389`, current prices `410875` and `241498`, old price `251560` for the discounted item, availability text, properties, absolute item URLs, category ID `78`, and a valid next cursor. Assert that product parsing returns title, code, article, current price, availability, specs, direct URL, RUB, and the provided timestamp.

- [ ] **Step 3: Run the parser tests and verify RED**

Run: `npm test -- test/entero-parser.test.mjs`

Expected: FAIL because the parser module does not exist.

- [ ] **Step 4: Implement focused extraction**

Split result cards on `<div data-index="<digits>" class="product-wrapper">`; within each card extract only the verified Entero class names. Decode `&nbsp;`, `&thinsp;`, numeric spacing characters, `&amp;`, `&quot;`, and common Russian price spacing. Strip tags before normalizing text. For product specs, parse each `table.ch tr`; use the `.value` cell text when present and boolean `true` for icon-only feature rows.

- [ ] **Step 5: Run the parser tests and record the checkpoint**

Run: `npm test -- test/entero-parser.test.mjs`

Expected: all parser tests PASS.

---

### Task 4: Bounded Read-Only Client and OpenCode Tools

**Files:**
- Create: `src/entero/client.mjs`
- Create: `.opencode/tools/entero.ts`
- Create: `test/entero-client.test.mjs`

**Interfaces:**
- Produces:
  - `searchEntero(args, deps?): Promise<SearchResult>`
  - `readEnteroProduct(item, deps?): Promise<ConfirmedOffer>`
  - `readEnteroNextPage(cursor, args, deps?): Promise<SearchResult>`
  - OpenCode tools `entero_search`, `entero_read_product`, `entero_next_page`.

- [ ] **Step 1: Write failing client tests with injected fetch**

Test successful search, hard `maxPrice` filtering, result limit, one retry after a timeout, no retry after a policy error, rejection of an external final response URL, product-page price precedence, and structured `{ code, message, sourceUrl }` errors. The fake fetch records `{ url, method }`; assert every call uses `method: "GET"`.

- [ ] **Step 2: Run the client tests and verify RED**

Run: `npm test -- test/entero-client.test.mjs`

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement the bounded client**

Use an 8-second `AbortController` timeout, a fixed Entero-safe `User-Agent`, `redirect: "follow"`, and exactly one retry for timeout/network failures. Validate both the requested URL and `response.url`. Reject non-2xx status codes. Parse JSON-free HTML through Task 3 interfaces. Return at most 20 raw search offers and at most the caller's requested limit after budget filtering.

- [ ] **Step 4: Implement the OpenCode tool wrappers**

In `.opencode/tools/entero.ts`, import `tool` from `@opencode-ai/plugin` and export three named tools. Define strict Zod-compatible arguments:

```ts
query: tool.schema.string().min(2).max(200)
category_id: tool.schema.number().int().positive().optional()
page: tool.schema.number().int().min(1).max(5).default(1)
max_price: tool.schema.number().int().positive().optional()
limit: tool.schema.number().int().min(1).max(10).default(5)
```

`entero_read_product` accepts only `item: string`; `entero_next_page` accepts a cursor plus optional `max_price` and `limit`. Each `execute` returns pretty-printed JSON and converts thrown errors to a JSON error object without stack traces, cookies, headers, or environment data.

- [ ] **Step 5: Run client tests and syntax checks**

Run:

```bash
npm test -- test/entero-client.test.mjs
node --check src/entero/client.mjs
node --check src/entero/parser.mjs
node --check src/entero/policy.mjs
```

Expected: all tests PASS and syntax checks exit 0.

---

### Task 5: Folder-Local OpenCode Agents, Skills, and Permission Isolation

**Files:**
- Create: `.opencode/opencode.jsonc`
- Create: `.opencode/agents/search-orchestrator.md`
- Create: `.opencode/agents/internet-researcher.md`
- Create: `.opencode/agents/entero-site-search.md`
- Create: `.opencode/skills/normalize-product-request/SKILL.md`
- Create: `.opencode/skills/validate-product-offers/SKILL.md`
- Create: `test/opencode-config.test.mjs`

**Interfaces:**
- Consumes: the custom tool names and JSON contracts from Tasks 1-4.
- Produces: default primary agent `search-orchestrator` and two callable subagents.

- [ ] **Step 1: Write failing configuration tests**

Parse `.opencode/opencode.jsonc` as strict JSON. Parse agent YAML frontmatter with focused line/block assertions. Verify:

- `default_agent` is `search-orchestrator`;
- `model` and `small_model` use the approved OpenAI IDs;
- `share` is `disabled` and `subagent_depth` is `1`;
- the primary agent can call only `internet-researcher` and `entero-site-search`;
- the internet agent allows only `websearch` and `webfetch` side-effecting tools;
- the Entero agent allows only `entero_search`, `entero_read_product`, and `entero_next_page`;
- all three agents deny edit, bash, external-directory access, and unrelated MCP/custom tools;
- skill folder names match frontmatter names.

- [ ] **Step 2: Run the configuration tests and verify RED**

Run: `npm test -- test/opencode-config.test.mjs`

Expected: FAIL because local OpenCode files do not exist.

- [ ] **Step 3: Create the project-local config**

Set:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "openai/gpt-5.6-terra-fast",
  "small_model": "openai/gpt-5.6-luna-fast",
  "default_agent": "search-orchestrator",
  "share": "disabled",
  "subagent_depth": 1,
  "permission": {
    "edit": "deny",
    "bash": "deny",
    "external_directory": "deny"
  }
}
```

Keep the file strict JSON despite the `.jsonc` suffix so it can be validated without adding a parser dependency.

- [ ] **Step 4: Create the three agent prompts**

The orchestrator prompt must require Russian output, normalize before delegation, launch the two approved subagents in parallel, use Entero product-page evidence for price, enforce budget, return at most five offers, and ask one clarification only when category ambiguity changes the search materially.

The internet researcher prompt must return only `candidate_models`, `search_queries`, `useful_specs`, and `sources`; it must label its price/stock data untrusted and avoid Entero tools.

The Entero prompt must use only the three `entero_*` tools, perform one initial search and at most one refined pass, verify shortlisted `/item/<id>` pages, and return the Confirmed Entero Offer contract. Its frontmatter must deny `*` first and allow only the three tool names afterward.

- [ ] **Step 5: Create the two skills**

`normalize-product-request` documents the exact request JSON contract, Russian budget expressions, hard/preferred constraints, and clarification threshold. `validate-product-offers` documents confirmed-offer requirements, product-page precedence, deduplication, wrong-category/accessory rejection, ranking order, and final Russian response fields.

- [ ] **Step 6: Run configuration tests and inspect resolved OpenCode state**

Run:

```bash
npm test -- test/opencode-config.test.mjs
opencode debug config
opencode debug agent search-orchestrator
opencode debug agent entero-site-search
opencode debug skill
```

Expected: tests PASS; resolved default/model/agents/tools match local files; no secret values appear. OpenCode may need permission to write its external diagnostic log, but no global config file may change.

---

### Task 6: Documentation and End-to-End Read-Only Verification

**Files:**
- Create: `README.md`
- Modify only if verification finds a defect: files created in Tasks 1-5.

**Interfaces:**
- Produces: user launch and validation instructions.

- [ ] **Step 1: Write operational documentation**

Document:

```text
cd /home/twopotato/dev/wibe/opencode/unknown
opencode
```

Include a sample prompt, the three-agent flow, model mapping, output fields, the public Entero scope, the no-cart/no-favorites policy, test commands, and the fact that Git is not initialized.

- [ ] **Step 2: Run the complete local suite**

Run: `npm test`

Expected: all normalization, policy, parser, client, and config tests PASS.

- [ ] **Step 3: Run a live adapter smoke test without OpenCode model calls**

Run a Node one-liner that imports `searchEntero`, searches `кофемашина` with `maxPrice: 100000` and `limit: 3`, then reads the first returned item. Verify every returned URL starts with `https://entero.ru/item/`, every current price is at most 100000, and `verifiedAt` is present. Do not invoke any cart, favorite, quick-order, callback, account, or external route.

- [ ] **Step 4: Run a local OpenCode smoke prompt**

Run:

```bash
opencode run --agent search-orchestrator "Нужна кофемашина до 100 тысяч рублей. Найди до трех вариантов на Entero."
```

Expected: Russian response with up to three Entero item links, prices not exceeding 100000 RUB, availability, and verification time. If OAuth/model execution is unavailable, report that external-model validation is blocked while retaining successful config and adapter checks.

- [ ] **Step 5: Verify global settings were not modified**

Compare timestamps and hashes captured before implementation for `~/.config/opencode/opencode.json` and `~/.config/opencode/oh-my-openagent.json`. Expected: unchanged.

- [ ] **Step 6: Final checkpoint**

Run `npm test` again and summarize exact pass counts, live-read evidence, any blocked external-model step, and the Git limitation. Do not claim completion if policy tests or the read-only smoke test fail.
