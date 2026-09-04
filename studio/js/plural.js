// Copy that counts. "1 asset(s)" is the sort of thing a customer notices and a
// reviewer does not, so counting belongs in one place rather than in every
// template string.

/** The noun alone, matched to the count. */
export function nounFor(value, singular, plural = `${singular}s`) {
  return Math.abs(Number(value) || 0) === 1 ? singular : plural;
}

/** A counted phrase: `count(1, 'asset')` → "1 asset", `count(4, 'asset')` → "4 assets". */
export function count(value, singular, plural = `${singular}s`) {
  const total = Number(value) || 0;
  return `${total.toLocaleString()} ${nounFor(total, singular, plural)}`;
}
