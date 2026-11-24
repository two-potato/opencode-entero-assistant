# Procurement assistant: evaluation protocol

Status: proposed benchmark, NOT RUN. No measured time savings, accuracy or live model performance are claimed.

## Dataset

A concrete [50-case synthetic dataset](benchmark-cases.csv) is available for domain review. Validate it with `node src/specification/intake.mjs docs/benchmark-cases.csv`. Freeze the reviewed revision before running the benchmark. These cases are not customer data or verified supplier results.

Freeze 50 anonymized, human-reviewed requirements before running the assistant. Use 10 cases each for refrigeration, thermal equipment, bakery, dishwashing and small equipment. Include budget boundaries, dimensions, voltage, capacity, ambiguous requests, out-of-stock products and missing specifications. Use public product pages and synthetic customer requirements only; no client or employer data.

Examples for fixture design (not verified catalog results):

| ID | Request | Mandatory checks |
| --- | --- | --- |
| R01 | Refrigerated cabinet for a small kitchen | Required temperature range, usable volume, dimensions |
| R02 | Undercounter freezer | Freezer temperature, width, power supply |
| T01 | Combi oven for a cafe | Tray capacity and format, power supply, connection requirements |
| T02 | Induction cooktop under a fixed budget | Budget, voltage, power and intended use |
| B01 | Deck oven for bread | Baking chamber dimensions, heat source, steam requirement |
| B02 | Convection oven for pastries | Tray format, capacity, electrical supply |
| D01 | Glasswasher for a bar | Basket format, throughput, water connection |
| D02 | Hood dishwasher for a canteen | Basket size, water and electrical requirements |
| S01 | Coffee machine for a small cafe | Budget, group count, plumbing requirements |
| S02 | Commercial slicer | Blade diameter, duty cycle, safety features |

## Method

1. Specify each request and its mandatory constraints before testing. Include expected abstention when no verified match exists.
2. Have a domain reviewer perform the manual search first. Record active minutes and accepted models. Keep reviewer results out of the agent input.
3. Run the assistant in read-only mode with the same request, once per case, using fixed model and configuration; record version, Git revision, timestamp, wall time, tokens and known cost.
4. Check all recommended offers against supplier product pages at observation time. Verify exact model identity, price, availability, required parameters and URL. Unknown information must be labeled unknown.
5. A reviewer checks outputs against the frozen requirements. Record failed and unavailable cases instead of excluding them. Do not place orders.
6. Compare paired active human time (including review/correction) and report total wall time separately. Preserve anonymized raw measurements and exact scoring definitions.

## Metrics

| Metric | Definition | Target, not a result |
| --- | --- | --- |
| Mandatory constraint compliance | Verified compliant offers / all recommended offers | 100% |
| Attribute accuracy | Correct verified claims / all checkable claims | >=95% |
| Source coverage | Offers with verified product page / all recommended offers | 100% |
| Unsupported claims | Claimed facts with no supporting evidence | 0 |
| Completion | Cases with acceptable output or correct abstention / all cases | Report |
| Latency | Median and p95 wall time including failures | Median <=5 min |
| Human time | Paired manual minutes minus assisted active review minutes | Measure |
| Cost | Actual provider charge per case; unknown remains null | Measure |

Report denominators, skipped/unavailable cases and uncertainty. If no offers are returned, offer-level rates are undefined, not 100%. A failed run cannot be counted as correct abstention.

## Results record

Use [results template](evaluation-results.csv). Keep one row per case, including failed cases. Provide evidence references in a sanitized companion report. Never publish secrets or private customer data.

## Roadmap

- [x] Portable onboarding and automated fixture tests.
- [x] Validated CSV/XLSX intake with row-level errors.
- [ ] PDF extraction with explicit human confirmation for ambiguous fields.
- [x] Offline comparable offer tables with source URLs, recorded timestamps and rejection/missing rows.
- [x] Offline CSV/XLSX comparison export (not live verification).
- [x] Printable PDF review draft (browser Save as PDF).
- [ ] Final commercial proposal format and explicit human approval before external sending.
- [ ] Execute the frozen 50-case benchmark and publish actual results with reproducible revision and environment.

## Automated aggregation (offline)

Run `node src/evaluation/score.mjs docs/benchmark-cases.csv docs/evaluation-results.csv`. The committed template contains no observations, so the status is NOT_RUN. Review rows must use `accepted`, `abstained`, `rejected`, `failed`, or `unavailable`, unique case IDs, one model and full 40-character Git revision, UTC timestamp and an evidence reference. Count columns are nonnegative integers, the abstention flag is `true`/`false`, unknown time/token/cost values are blank. A reviewer supplies all counts and status. The completion denominator includes missing cases; ratios with zero denominator are null, and currencies are never combined. Median and nearest-rank p95 use recorded wall times only; paired time uses only rows with both values. Record failures and missing observations; the report is not independent validation of claims or live benchmark execution.
