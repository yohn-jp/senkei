// Reusable, deterministic descriptive statistics. No significance claims from a single run.
export function summarizeSamples(values) {
  if (!Array.isArray(values) || !values.length ||
    values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Timing samples must be finite, nonnegative and nonempty');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = fraction => sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
  return {median_ms: pick(.5), p95_ms: pick(.95), min_ms: sorted[0],
    max_ms: sorted[sorted.length - 1], samples: sorted.length};
}
export function pairedSpeedups(reference, candidate) {
  if (!reference.length || reference.length !== candidate.length) {
    throw new Error('Paired timings must have the same nonzero length');
  }
  const ratios = reference.map((value, i) =>
    value / Math.max(candidate[i], Number.EPSILON));
  const estimate = summarizeSamples(ratios).median_ms;
  const deviations = ratios.map(value => Math.abs(value - estimate));
  const mad = summarizeSamples(deviations).median_ms;
  // Heuristic only. Rerun on the target device to validate a small advantage.
  const trend = estimate > 1.03 && estimate - 2 * mad > 1
    ? 'improvement-trend' : estimate < .97 && estimate + 2 * mad < 1
      ? 'regression-trend' : 'inconclusive';
  return {median_ratio: estimate, median_absolute_deviation: mad, trend};
}
export function rankVariants(rows, manifest, baselineId = '000') {
  const cases = [...new Set(rows.map(row => row.id))];
  const baseline = new Map(rows.filter(row => row.variant === baselineId && row.verified)
    .map(row => [row.id, row]));
  const ranked = [];
  for (const variant of manifest.variants) {
    const mine = rows.filter(row => row.variant === variant.id);
    if (!cases.length || mine.length !== cases.length || cases.some(id => !baseline.has(id) ||
      !mine.some(row => row.id === id && row.verified))) continue;
    const ratios = cases.map(id => {
      const row = mine.find(entry => entry.id === id);
      const base = baseline.get(id);
      return base.stats.median_ms / Math.max(row.stats.median_ms, Number.EPSILON);
    });
    const aggregate = Math.exp(ratios.reduce((sum, ratio) => sum + Math.log(ratio), 0) / ratios.length);
    ranked.push({id: variant.id, features: variant.features,
      bytes: variant.bytes, aggregate_ratio: aggregate,
      worst_ratio: Math.min(...ratios), improved_cases: ratios.filter(ratio => ratio > 1.02).length,
      regressed_cases: ratios.filter(ratio => ratio < .98).length,
      cases: ratios.length});
  }
  return ranked.sort((a, b) => b.aggregate_ratio - a.aggregate_ratio || a.id.localeCompare(b.id));
}

/** Full 2^3 factorial marginal effects, averaging all other feature contexts.
 * Ratio > 1 means enabling the feature tends to reduce the same dispatch time.
 * Descriptive only, and available only after all eight masks are verified.
 */
export function factorialEffects(rows) {
  const cases = [...new Set(rows.map(row => row.id))];
  if (!cases.length) return [];
  const lookup = new Map(rows.filter(row => row.verified).map(row => [row.id + '/' + row.variant, row]));
  if (cases.some(id => Array.from({length: 8}, (_, i) =>
    id + '/' + i.toString(2).padStart(3, '0')).some(key => !lookup.has(key)))) return [];
  return [
    ['T', 4, 'lab-opt-termination'],
    ['C', 2, 'lab-opt-cohort'],
    ['S', 1, 'lab-opt-shields'],
  ].map(([id, bit, feature]) => {
    const ratios = [];
    for (const caseId of cases) {
      for (let mask = 0; mask < 8; mask++) {
        if (mask & bit) continue;
        const off = lookup.get(caseId + '/' + mask.toString(2).padStart(3, '0'));
        const on = lookup.get(caseId + '/' + (mask | bit).toString(2).padStart(3, '0'));
        ratios.push(Math.max(off.stats.median_ms, Number.EPSILON) /
          Math.max(on.stats.median_ms, Number.EPSILON));
      }
    }
    return {id, feature, comparisons: ratios.length,
      geometric_mean_ratio: Math.exp(ratios.reduce((sum, ratio) =>
        sum + Math.log(ratio), 0) / ratios.length),
      worst_ratio: Math.min(...ratios), best_ratio: Math.max(...ratios),
      regressions: ratios.filter(ratio => ratio < .98).length};
  });
}
