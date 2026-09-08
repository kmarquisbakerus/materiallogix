export const INPAINT_CONTRACT = 'materiallogix.inpaint-job.v1';
export const INPAINT_BENCHMARK = 'materiallogix.inpaint-benchmark.v1';

const finiteInt = (value, label, min, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} is outside the supported range.`);
  return n;
};

/** Media-free contract for local execution or a deliberately disabled cloud path. */
export function makeInpaintJobSpec({ width, height, selection, operation, variations = 1, geometry = null,
  execution = 'local', maskCoverage = null, selectionKind = 'rectangle' }) {
  const w = finiteInt(width, 'Width', 64, 16384);
  const h = finiteInt(height, 'Height', 64, 16384);
  if (!['add', 'remove', 'replace'].includes(operation)) throw new Error('Unsupported inpainting operation.');
  if (!['local', 'cloud-disabled'].includes(execution)) throw new Error('Cloud inpainting is not enabled.');
  const sx = Number(selection?.x), sy = Number(selection?.y), sw = Number(selection?.width), sh = Number(selection?.height);
  if (![sx, sy, sw, sh].every(Number.isFinite) || sx < 0 || sy < 0 || sw <= 0 || sh <= 0 || sx + sw > 100 || sy + sh > 100) {
    throw new Error('Selection must be a bounded percentage rectangle.');
  }
  const measuredCoverage = Number(maskCoverage);
  const coverage = maskCoverage !== null && maskCoverage !== undefined && Number.isFinite(measuredCoverage)
    ? Math.max(0.000001, Math.min(1, measuredCoverage))
    : (sw / 100) * (sh / 100);
  const kind = ['rectangle', 'lasso', 'brush', 'mixed'].includes(selectionKind) ? selectionKind : 'rectangle';
  const guidance = geometry ? {
    schema: String(geometry.schema || ''),
    humanGeometrySchema: String(geometry.humanGeometrySchema || geometry.assurance?.schema || ''),
    faces: Number(geometry.faces?.length || 0), hands: Number(geometry.hands?.length || 0),
    poses: Number(geometry.poses?.length || 0), segmentationAvailable: !!geometry.spatial?.layers?.length
  } : null;
  return {
    schema: INPAINT_CONTRACT, execution, operation, width: w, height: h,
    maskCoverage: coverage, selectionKind: kind, variations: finiteInt(variations, 'Variations', 1, 8), guidance,
    boundaries: { persistentMask: false, metricSceneDepth: false, providerConfigured: false }
  };
}

/** Privacy-safe timer. It never accepts prompts, images, paths, or credentials. */
export function createInpaintBenchmark(spec, clock = () => performance.now()) {
  const started = clock();
  const phases = [];
  let phaseStart = started;
  return {
    phase(name, providerUsage = null) {
      if (!['local_3d_mapping', 'mask_preparation', 'inpainting_request', 'output_processing', 'variants'].includes(name)) throw new Error('Unknown benchmark phase.');
      const now = clock();
      const cleanUsage = providerUsage && typeof providerUsage === 'object' ? {
        gpuModel: String(providerUsage.gpuModel || '').slice(0, 120),
        gpuSeconds: Number.isFinite(Number(providerUsage.gpuSeconds)) ? Number(providerUsage.gpuSeconds) : null,
        billedCents: Number.isInteger(Number(providerUsage.billedCents)) ? Number(providerUsage.billedCents) : null
      } : null;
      phases.push({ name, elapsedMs: Math.max(0, Math.round(now - phaseStart)), providerUsage: cleanUsage });
      phaseStart = now;
    },
    finish() {
      const ended = clock();
      return { schema: INPAINT_BENCHMARK, recordedAt: new Date().toISOString(), width: spec.width, height: spec.height,
        maskCoverage: spec.maskCoverage, variations: spec.variations, execution: spec.execution,
        elapsedMs: Math.max(0, Math.round(ended - started)), phases };
    }
  };
}

/** Accepts only an authenticated server quote; never guesses GPU cost or spends local units. */
export function planCloudInpaintReservation({ quoteId, quotedCents, purchasedWalletCents, enabled = false }) {
  // Enabling is a server decision, never a caller's argument.
  if (enabled) throw new Error('Cloud inpainting is enabled by the server, not by the client.');
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(String(quoteId || ''))) throw new Error('A server quote is required.');
  const reserveCents = finiteInt(quotedCents, 'Quoted cost', 1, 50000);
  const availableCents = finiteInt(purchasedWalletCents, 'Purchased wallet balance', 0, 100000000);
  return { enabled: false, executable: false,
    reason: availableCents < reserveCents ? 'insufficient_purchased_wallet' : 'provider_disabled',
    quoteId, reserveCents, availableCents, fundingSource: 'purchased_cloud_wallet', localIncludedUnitsUsed: 0,
    settlement: { state: 'not_reserved', actualCents: null } };
}
