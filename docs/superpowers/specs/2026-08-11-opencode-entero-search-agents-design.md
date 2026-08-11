# OpenCode Entero Search Agents Design

Date: 2026-08-11

## Objective

Create a folder-local OpenCode configuration that turns an abstract Russian product request into a short list of accurate, current offers from Entero.

Example input:

> Нужна кофемашина до 100 тысяч рублей.

The response must contain concrete product models, current prices in rubles, availability text, direct Entero product links, and the verification time. The system is read-only: it may search and navigate public pages, but it must not add products to the cart or favorites, place orders, submit quick-order forms, or change account data.

## Scope

The first version supports one public source:

- site ID: `entero`
- allowed origin: `https://entero.ru`
- authentication: none
- language: Russian
- currency: RUB

The implementation changes only this project directory. It does not modify global OpenCode configuration, global agents, global provider authentication, or other OpenCode profiles.

Out of scope for the first version:

- additional stores;
- login and credential handling;
- carts, favorites, orders, quick orders, callbacks, and profile changes;
- background monitoring;
- caching or a persistent product database;
- automatic purchasing;
- claiming that a displayed website price is a binding public offer.

## Architecture

```text
User
  |
  v
search-orchestrator (primary)
  |-- internet-researcher (subagent)
  `-- entero-site-search (subagent)
           |
           `-- bounded Entero read-only tools
  |
  v
validation, ranking, Russian response
```

The orchestrator normalizes the request and starts the internet researcher and Entero site search in parallel. The Entero agent performs a fast first pass directly against the Entero search endpoint. Internet research supplies candidate model names, terminology, and useful comparison characteristics. Internet prices are never accepted as Entero prices.

If the first Entero pass produces enough matching offers, the orchestrator returns the validated result without waiting for an unnecessary second site pass. If the query is broad or the first pass is weak, the Entero agent performs one bounded refinement using the categories or exact model names found during research.

## Agent Roles and Models

### `search-orchestrator`

- mode: `primary`
- model: `openai/gpt-5.6-terra-fast`
- reasoning effort: `medium`
- responsibilities:
  - parse an abstract Russian request;
  - distinguish required constraints from preferences;
  - dispatch the two subagents;
  - validate source provenance and budget compliance;
  - remove duplicates and accessories that do not satisfy the requested product category;
  - rank up to five offers;
  - produce the final Russian response.
- restrictions:
  - does not browse Entero directly;
  - does not accept an internet-research price as an Entero price;
  - does not edit files or execute shell commands during a product search.

### `internet-researcher`

- mode: `subagent`
- model: `openai/gpt-5.6-luna-fast`
- reasoning effort: `low`
- responsibilities:
  - resolve informal product terminology;
  - identify candidate exact models and useful search queries;
  - identify characteristics relevant to comparison.
- restrictions:
  - read-only internet search and page fetching only;
  - no Entero-specific browser tools;
  - no file edits, shell commands, or external side effects;
  - prices are informational and are excluded from the confirmed-offer contract.

### `entero-site-search`

- mode: `subagent`
- model: `openai/gpt-5.6-terra-fast`
- reasoning effort: `low`
- responsibilities:
  - search Entero with the normalized query;
  - refine by category or exact candidate model when needed;
  - read result pages and product cards;
  - return normalized Entero offers with evidence.
- restrictions:
  - may use only the bounded Entero tools;
  - no generic browser, web search, shell, write, edit, or task tools;
  - no navigation outside the allowed origin;
  - no state-changing requests.

If a `-fast` alias is temporarily unavailable, the corresponding non-fast model in the same family is the only permitted fallback: `openai/gpt-5.6-terra` or `openai/gpt-5.6-luna`.

## Request Contract

The orchestrator produces a normalized request:

```json
{
  "raw_query": "нужна кофемашина до 100 тысяч",
  "category": "кофемашина",
  "budget": {
    "min": null,
    "max": 100000,
    "currency": "RUB"
  },
  "required": [],
  "preferred": [],
  "site_id": "entero",
  "result_limit": 5
}
```

Rules:

- Russian colloquial budget expressions such as `20 тысяч`, `20к`, and `20 кэсов` are normalized to rubles when the request contains no conflicting currency.
- A stated maximum price is a hard constraint.
- Missing characteristics remain unspecified rather than being invented.
- Ambiguity that materially changes the product category triggers one concise clarification instead of a broad search.

## Internet Research Contract

```json
{
  "candidate_models": [],
  "search_queries": [],
  "useful_specs": [],
  "sources": []
}
```

The orchestrator may use these fields to improve search and comparison, but not to establish Entero price, stock, or availability.

## Confirmed Entero Offer Contract

```json
{
  "site_id": "entero",
  "item_id": "122375",
  "model": "Nuova Simonelli Appia Life 2Gr V",
  "title": "Кофемашина Nuova Simonelli Appia Life 2Gr V черная, высокие группы, экономайзер, автомат",
  "category": "Кофемашины",
  "current_price": 410875,
  "old_price": null,
  "currency": "RUB",
  "availability": "В наличии 8 шт.",
  "product_code": "122375",
  "article": "167625 / APPIA LIFE 2GR V 220V BLACK+HIGH GROUPS+ECONOMIZER",
  "specs": {},
  "url": "https://entero.ru/item/122375",
  "matched_constraints": [],
  "failed_constraints": [],
  "unknown_fields": [],
  "verified_at": "RFC-3339 timestamp"
}
```

An offer is confirmed only when all of these are present and consistent:

- a product page URL matching `/item/<numeric-id>`;
- the exact product title;
- a current numeric price and RUB currency;
- availability text, including an explicit unknown status when absent;
- a verification timestamp.

Old and discounted prices are stored separately. The lower visually current price is not inferred from ordering alone; the parser must identify the page's current-price element. Accessories and related products are not promoted to primary results unless the normalized category requests them.

## Entero Read-Only Adapter

### Allowed operations

- `GET /`
- `GET /search.php?text=<encoded-query>`
- `GET /search.php?text=<encoded-query>&cid=<numeric-category-id>`
- `GET /search.php?text=<encoded-query>&page=<positive-integer>`
- `GET /item/<numeric-id>`

The adapter exposes bounded operations rather than a generic click tool:

- `entero_search`
- `entero_read_product`
- `entero_next_page`

`entero_search` accepts a query, optional category ID, page number, budget, and result limit. Budget filtering happens locally after parsing. `entero_read_product` accepts only a normalized Entero item URL or numeric item ID. `entero_next_page` accepts only a search cursor issued by `entero_search`.

### Forbidden operations

- all non-GET methods;
- `/cart/` and cart controls;
- quick-order forms;
- favorites;
- account, cabinet, profile, address, callback, comparison, and checkout actions;
- `javascript:` URLs;
- external origins and redirects;
- arbitrary selectors, clicks, form filling, or JavaScript evaluation.

The adapter validates the URL before a request and the final URL after redirects. A violation returns a structured policy error and does not attempt the request.

## Entero Parsing Behavior

Observed public routes and fields on 2026-08-11:

- search route: `/search.php?text=<query>`;
- optional category refinement: `cid=<numeric-id>`;
- pagination: `page=<positive-integer>`;
- product route: `/item/<numeric-id>`;
- result fields: title, item URL, current price, optional old price, availability, brief specifications;
- product fields: title, product code, current price, availability, warranty, specification table, article, description.

The search page can contain large result sets and unrelated categories. The adapter therefore:

1. prefers a matching category suggested by Entero;
2. parses only the configured number of pages;
3. applies the hard budget locally;
4. verifies shortlisted offers against product pages;
5. rejects products whose title or category does not match the requested product type.

## Ranking and Final Response

The orchestrator ranks confirmed offers by:

1. satisfaction of all hard constraints;
2. exact category and product-type match;
3. satisfaction of preferred characteristics;
4. closeness to the requested budget without exceeding it;
5. completeness of product evidence.

The final Russian response contains up to five offers. Each offer includes:

- exact model and full title;
- current price;
- availability text;
- key characteristics relevant to the request;
- direct Entero link;
- verification time;
- explicit unknowns or caveats.

If no confirmed offer satisfies the hard constraints, the response says so and may separately show the nearest alternatives only when clearly labeled as outside the budget or otherwise non-compliant.

## Error Handling

- Network timeout: retry one time with a short bounded timeout, then return a source-unavailable result.
- HTTP error or redirect outside Entero: stop and report the source error.
- Layout change or missing selector: exclude the affected fact or offer; never guess.
- Missing price: do not confirm the offer.
- Missing availability: retain the offer only with `availability` explicitly marked unknown.
- Excessively broad search: refine once by category or exact candidate model; do not crawl unbounded pages.
- Empty result: try one normalized query variant, then report no confirmed matches.
- Conflicting list and product-page price: the product-page price wins and the conflict is recorded.
- Duplicate product IDs: keep one product-page-verified offer.
- Policy violation: block the operation, record a redacted diagnostic, and return no side effect.

## Testing and Verification

### Static and configuration checks

- validate JSONC and agent frontmatter;
- verify exact model IDs against the local OpenCode catalog;
- inspect resolved project configuration without exposing authentication data;
- confirm global configuration files are unchanged.

### Unit tests

- normalize Russian budget expressions;
- validate request and offer contracts;
- parse search results with current price, old price, stock count, and brief specs;
- parse product title, product code, article, price, availability, and specification rows;
- filter by hard maximum budget;
- reject accessories and wrong categories;
- deduplicate item IDs;
- prefer product-page price on conflicts.

### Policy tests

- reject non-GET requests;
- reject `/cart/`, quick-order, favorites, account, profile, checkout, and external URLs;
- reject redirects outside `entero.ru`;
- prove that the Entero agent has no generic browser, shell, edit, or write tools.

### Live read-only smoke test

Run one public search, read one result page, and verify one product card. The smoke test must not click or submit cart, favorite, quick-order, callback, or account controls. It reports the exact pages read and the extracted evidence.

## Adding Future Sites

Each future site adds:

- one subagent with its own model and permissions;
- one bounded adapter with a domain allowlist and explicit safe routes;
- one source-specific parser and test fixtures;
- one source entry in the local registry.

The orchestrator and normalized contracts remain unchanged. Source specialization stays in the site agent and adapter instead of accumulating in the primary agent prompt.

## Acceptance Criteria

- An abstract Russian request is converted to structured constraints.
- Internet research and Entero search can start in parallel.
- Returned prices come only from verified Entero product pages.
- Every confirmed offer has an exact model/title, current RUB price, direct product URL, and verification time.
- Hard budget constraints are enforced.
- The runtime cannot invoke cart, favorites, quick order, checkout, profile changes, non-GET requests, or external navigation through the Entero adapter.
- No credentials are required or stored.
- All project settings remain local to this folder.
- Static, unit, policy, and live read-only smoke checks pass.
