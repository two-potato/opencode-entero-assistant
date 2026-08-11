const AMOUNT_PATTERN = "(\\d[\\d\\s]*(?:[.,]\\d+)?)\\s*(тысяч(?:а|и|у)?|тыс\\.?|кэсов|к|руб(?:лей|ля|ль)?|₽)?";

function parseAmount(numberText, unit = "") {
  const normalized = numberText.replace(/\s+/g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  const multiplier = /^(?:тысяч|тыс|кэсов|к)/i.test(unit) ? 1000 : 1;
  return Math.round(value * multiplier);
}

export function normalizeBudgetExpression(text) {
  const normalized = String(text).toLowerCase().replace(/[\u00a0\u2009\u202f]/g, " ");
  const range = normalized.match(new RegExp(`(?:^|\\s)от\\s+${AMOUNT_PATTERN}\\s+до\\s+${AMOUNT_PATTERN}`, "i"));

  if (range) {
    return {
      min: parseAmount(range[1], range[2]),
      max: parseAmount(range[3], range[4]),
      currency: "RUB",
    };
  }

  const ceiling = normalized.match(new RegExp(`(?:^|\\s)(?:до|за)\\s+${AMOUNT_PATTERN}`, "i"));
  return {
    min: null,
    max: ceiling ? parseAmount(ceiling[1], ceiling[2]) : null,
    currency: "RUB",
  };
}
