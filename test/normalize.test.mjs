import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBudgetExpression } from "../src/request/normalize.mjs";

const cases = [
  ["телефон за 20 тысяч", { min: null, max: 20000, currency: "RUB" }],
  ["кофемашина до 100к", { min: null, max: 100000, currency: "RUB" }],
  ["нужен миксер за 20 кэсов", { min: null, max: 20000, currency: "RUB" }],
  ["от 30 000 до 50 000 рублей", { min: 30000, max: 50000, currency: "RUB" }],
  ["нужна кофемолка", { min: null, max: null, currency: "RUB" }],
];

for (const [input, expected] of cases) {
  test(`normalizes budget in: ${input}`, () => {
    assert.deepEqual(normalizeBudgetExpression(input), expected);
  });
}
