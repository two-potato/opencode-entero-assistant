# OpenCode Entero Sequential Procurement Assistant Design

Date: 2026-08-11
Status: approved in conversation, awaiting written-spec review

## Objective

Build a folder-local AI procurement assistant operated through OpenCode CLI. The
assistant accepts an abstract Russian product request, researches suitable exact
models on the public internet, and then checks those models on Entero. Its final
answer contains only Entero product offers and clearly explains the primary
choice and the available analogs.

Example request:

> Нужна кофемашина для небольшой кофейни до 100 тысяч рублей.

The first version is advisory and read-only. It must not add products to a cart
or favorites, submit orders or forms, sign in, or change account data.

## Product Decisions

- The initial interface is OpenCode CLI.
- The primary use case is selection from an abstract need, not lookup of an
  already known product code.
- General internet research is used to identify suitable models and selection
  criteria.
- The final commercial result includes only products verified on Entero.
- If a researched model is absent from Entero, the assistant says so instead of
  substituting another store.
- The answer explains why each model fits and presents one primary choice plus
  three to five analogs when that many valid Entero offers exist.
- Every analog must satisfy all hard constraints, including the maximum budget.
- Products that are listed on Entero but unavailable may be shown with a clear
  warning and must rank below available products.
- If fewer than three valid analogs exist, the assistant returns the real set
  and explains the shortfall. It never invents offers.

## Scope

### In scope

- Russian natural-language requests;
- category, purpose, budget, required features, preferences, and exclusions;
- public internet research for exact models and relevant characteristics;
- public Entero search and product-page verification;
- primary recommendation plus up to five analogs;
- current RUB price, availability text, direct Entero URL, explanation, and
  verification timestamp;
- folder-local OpenCode agents, skills, permissions, tools, and tests.

### Out of scope for the first version

- Telegram, web UI, and other user interfaces;
- stores other than Entero in the final result;
- login, credentials, cart, favorites, comparison state, callback forms,
  checkout, ordering, or profile changes;
- purchasing or reservation;
- background monitoring and notifications;
- persistent product database or cache;
- treating a displayed website price as a binding public offer.

## Architecture

The approved architecture is a strict sequential multi-agent pipeline:

```text
User in OpenCode CLI
        |
        v
search-orchestrator
  1. normalize and validate request
        |
        v
internet-researcher
  2. choose primary model and analog candidates
        |
        v
search-orchestrator
  3. validate research contract and delegate full context
        |
        v
entero-site-search
  4. search and verify each candidate on Entero
        |
        v
search-orchestrator
  5. enforce constraints, rank, and explain results
        |
        v
Russian CLI response
```

Unlike the earlier prototype, internet research and Entero search do not start
in parallel. The Entero agent is invoked only after the internet researcher has
returned a valid primary model, analog candidates, selection criteria, and
sources.

## Components

### `search-orchestrator`

The primary OpenCode agent owns the conversation and workflow state. It:

- normalizes the request;
- asks at most one concise question when ambiguity materially changes the
  category, currency, or a hard constraint;
- calls `internet-researcher` first and waits for its complete result;
- validates the research result before calling `entero-site-search`;
- passes the complete request and research result because subagents do not
  inherit the parent conversation;
- validates Entero provenance, constraints, and evidence;
- chooses the final primary result and ranks analogs;
- answers in Russian.

It has no direct web, shell, file-editing, or Entero browsing capability during
a product request.

### `internet-researcher`

This read-only subagent translates an abstract need into a defensible shortlist.
It:

- uses public web search and public pages;
- identifies one primary model and three to five distinct analog candidates when
  defensible candidates exist;
- records why each model fits and how each analog differs;
- supplies exact manufacturer/model strings and normalized Entero search terms;
- identifies comparison characteristics and cites research sources.

Internet price, stock, delivery, and Entero availability are not trusted
commercial evidence and are excluded from confirmed offers.

### `entero-site-search`

This source-specific subagent receives both the normalized request and the
validated research result. It:

- searches each candidate by exact manufacturer/model;
- may retry one unsuccessful candidate with one normalized name variant;
- rejects wrong categories, accessories, duplicates, and hard-constraint
  violations;
- reads the product page for every candidate that can enter the final answer;
- reports researched candidates that were not found;
- returns only structured Entero evidence.

It may use only bounded read-only Entero tools. It cannot use a generic browser,
arbitrary URLs, shell, file writes, or state-changing operations.

### Entero adapter

The adapter is the trust boundary between the agent and Entero. It permits only
HTTPS `GET` requests to approved public search and numeric product routes on
`entero.ru`. It validates the requested URL and the final URL after redirects.

Permitted capabilities:

- search by a bounded text query and optional category/page;
- read `/item/<numeric-id>`;
- follow only adapter-issued search cursors.

All cart, favorite, account, profile, callback, quick-order, checkout, external
origin, non-GET, arbitrary click, and JavaScript operations are blocked.

## Data Contracts

### Normalized request

```json
{
  "raw_query": "Нужна кофемашина для небольшой кофейни до 100 тысяч рублей",
  "category": "кофемашина",
  "purpose": "для небольшой кофейни",
  "budget": {
    "min": null,
    "max": 100000,
    "currency": "RUB"
  },
  "required": [],
  "preferred": [],
  "excluded": [],
  "site_id": "entero",
  "analog_count": {
    "min": 3,
    "max": 5
  }
}
```

Budget expressions containing `до` or `за` are hard maximums. Missing facts
remain unspecified and are never invented.

### Internet research result

```json
{
  "primary_model": {
    "model": "Manufacturer Exact Model",
    "search_query": "Manufacturer Exact Model",
    "why": ["reason tied to the normalized request"]
  },
  "analogs": [
    {
      "model": "Manufacturer Analog Model",
      "search_query": "Manufacturer Analog Model",
      "why": ["similarity", "meaningful difference"]
    }
  ],
  "selection_criteria": [
    {"name": "criterion", "reason": "why it matters for this request"}
  ],
  "sources": [
    {"title": "source title", "url": "https://...", "supports": "claim"}
  ],
  "research_caveats": []
}
```

The orchestrator rejects or repairs a result with no exact primary model, no
reasoning, duplicate candidates, no supporting sources, or fewer than three
analogs without an explicit research caveat before proceeding.

### Verified Entero candidate

```json
{
  "requested_model": "Manufacturer Exact Model",
  "status": "found",
  "role": "primary",
  "item_id": "123",
  "title": "Exact Entero product title",
  "model": "Manufacturer Exact Model",
  "price_rub": 99990,
  "availability": "В наличии",
  "available": true,
  "url": "https://entero.ru/item/123",
  "verified_at": "RFC-3339 timestamp",
  "matched_constraints": [],
  "failed_constraints": [],
  "caveats": []
}
```

An absent candidate uses `status: "not_found"`, retains `requested_model` and
`role`, and includes a short reason. It does not contain invented product data.

## Search and Validation Flow

1. Normalize the user's Russian request.
2. Ask one clarification only when continuing would materially risk searching
   the wrong category, currency, or hard constraint.
3. Call the internet researcher and wait for its structured result.
4. Validate exact model names, explanations, candidate uniqueness, source
   presence, and the analog count.
5. Send the complete normalized request and research result to the Entero agent.
6. Search the primary candidate and each analog candidate separately.
7. For a failed exact lookup, allow one normalized query variant for that
   candidate. Do not broaden into unrelated models.
8. Verify every shortlisted result against its numeric Entero product page.
9. Treat the product-page price as authoritative for this response. Record a
   conflict with the search-card price as a caveat.
10. Reapply the budget and every hard constraint after product verification.
11. Rank available compliant offers above unavailable compliant offers.
12. Produce the Russian response and separately list researched models that were
    absent or rejected.

## Ranking

Confirmed offers are ranked by:

1. satisfaction of all hard constraints;
2. exact product/category match;
3. availability;
4. fit for the stated purpose and preferred characteristics;
5. closeness to the budget without exceeding it;
6. evidence completeness.

The researcher's primary candidate remains the preferred primary result only if
it is confirmed on Entero and passes all hard constraints. Otherwise the highest
ranked confirmed analog becomes the final primary recommendation, and the answer
explains the substitution.

## Final CLI Response

The response contains:

- a concise interpretation of the request;
- the primary recommendation and why it fits;
- three to five confirmed analogs when available, including meaningful
  differences from the primary recommendation;
- for each offer: exact title/model, current RUB price, availability, matched
  requirements, caveats, direct Entero URL, and verification time;
- a short recommendation summary;
- a list of researched candidates not found or rejected on Entero;
- an explicit shortfall notice when fewer than three compliant analogs exist.

Unavailable products may appear, are clearly labeled, and rank below available
products. External-store offers and external prices never appear as confirmed
commercial alternatives.

## Error Handling

- **Critical request ambiguity:** ask one concise question and stop.
- **Internet research unavailable:** stop with a clear diagnostic; do not guess
  models or silently bypass the approved first stage.
- **Invalid research contract:** request one bounded repair from the researcher;
  if still invalid, return a structured failure.
- **Candidate absent on Entero:** return `not_found` for that candidate and
  continue checking the remaining candidates.
- **Entero unavailable:** report source unavailability and do not substitute
  external commercial data.
- **Timeout or transient network error:** retry once with a bounded timeout.
- **External redirect or forbidden route:** block immediately and report a
  policy error.
- **Missing price:** exclude the product from confirmed offers.
- **Missing availability:** retain the otherwise valid offer with `status not
  specified` and a caveat.
- **Search/product price conflict:** use the product-page price and record the
  conflict.
- **Layout change or incomplete evidence:** omit the affected fact or product;
  never infer it.
- **Fewer than three compliant analogs:** return the real set and explain the
  shortfall.

## Testing Strategy

### Unit and contract tests

- Russian budget normalization, including colloquial expressions;
- normalized request schema;
- research result schema, exact candidate uniqueness, and analog limits;
- Entero result schema, found/not-found outcomes, and timestamps;
- budget, category, accessory, duplication, and availability ranking rules;
- current-price versus old-price parsing and product-page precedence.

### Policy and adapter tests

- allow only HTTPS GET requests to approved Entero routes;
- reject cart, favorites, quick order, callbacks, account/profile, checkout,
  arbitrary paths, external origins, and external redirects;
- ensure every final offer was read from `/item/<numeric-id>`;
- ensure missing price cannot produce a confirmed offer.

### Agent configuration and orchestration tests

- the orchestrator can call only the two approved subagents and validation
  skills;
- the internet researcher has only public web search/fetch capability;
- the Entero agent has only bounded `entero_*` tools;
- the Entero task cannot be dispatched before a valid research result exists;
- the full normalized request and research result are included in delegation;
- external internet price/stock fields cannot enter the final offer contract;
- the final structure distinguishes the primary recommendation, analogs, and
  not-found candidates.

### Live read-only acceptance test

Run the OpenCode CLI request:

> Нужна кофемашина для небольшой кофейни до 100 тысяч рублей.

Verify that the assistant researches models first, checks them on Entero, gives
an explained primary choice and up to five real analogs, enforces the budget,
reports absent models, includes direct product links and timestamps, and performs
no mutation.

## Acceptance Criteria

- OpenCode CLI is the only required user interface.
- An abstract Russian request becomes an explicit structured requirement set.
- Internet research completes before Entero search begins.
- The research stage supplies a justified primary model and analog candidates.
- The final answer contains only product offers verified on Entero product pages.
- Every confirmed offer includes exact identity, current RUB price, availability
  text, direct URL, and verification time.
- Every displayed primary or analog offer passes all hard constraints.
- The answer explains why the primary choice and each analog fit.
- Unavailable products are clearly labeled and rank below available products.
- Missing and rejected candidates are reported honestly.
- Fewer than three real analogs produces a shortfall notice, not fabricated data.
- No agent can perform a cart, favorite, order, profile, callback, checkout,
  arbitrary browser, external navigation, shell, or file-editing action during a
  product search.
- All configuration and implementation changes remain local to this folder.

## Required Changes to the Existing Prototype

The current prototype already has folder-local agents, a bounded Entero adapter,
parsers, normalization, and passing baseline tests. Implementation must still:

- replace parallel research/search delegation with a strict sequential gate;
- replace the researcher's generic candidate array with explicit primary and
  analog roles, explanations, search terms, and criteria;
- pass the validated research result into the Entero task;
- search and report the outcome of each researched candidate;
- distinguish final primary recommendation, analogs, unavailable offers, and
  not-found candidates;
- add orchestration and contract tests for the approved behavior;
- update CLI documentation and the live read-only acceptance scenario.

## Repository Constraint

This project directory is not currently a valid Git repository. The design is
saved locally, but the normal design-spec commit checkpoint cannot be performed
unless the user later initializes or supplies a repository.
