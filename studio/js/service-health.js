export function validateHealthAttempt(attempt, expectedEnvironment, maxLatencyMs) {
  const findings = [];
  if (attempt.status !== 200) findings.push('status_not_200');
  if (!String(attempt.contentType || '').toLowerCase().includes('application/json')) findings.push('content_type_not_json');
  if (!String(attempt.cacheControl || '').toLowerCase().includes('no-store')) findings.push('cache_control_not_no_store');
  if (attempt.body?.ok !== true || attempt.body?.environment !== expectedEnvironment) findings.push('body_contract_invalid');
  if (Object.keys(attempt.body || {}).sort().join(',') !== 'environment,ok') findings.push('body_not_minimal');
  if (!Number.isFinite(attempt.elapsedMs) || attempt.elapsedMs < 0 || attempt.elapsedMs > maxLatencyMs) findings.push('latency_threshold_exceeded');
  return findings;
}

export function summarizeHealthAttempts(attempts, { expectedEnvironment, maxLatencyMs, minimumSuccesses }) {
  const results = attempts.map(attempt => ({
    elapsedMs: attempt.elapsedMs,
    findings: validateHealthAttempt(attempt, expectedEnvironment, maxLatencyMs)
  }));
  const successes = results.filter(result => result.findings.length === 0).length;
  const latencies = results.filter(result => result.findings.length === 0).map(result => result.elapsedMs).sort((a, b) => a - b);
  return {
    ok: successes >= minimumSuccesses,
    attempts: results.length,
    successes,
    minimumSuccesses,
    maxLatencyMs,
    maxSuccessfulLatencyMs: latencies.length ? latencies.at(-1) : null,
    failureCodes: [...new Set(results.flatMap(result => result.findings))].sort()
  };
}
