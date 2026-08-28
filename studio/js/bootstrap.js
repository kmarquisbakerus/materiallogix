// Compatibility bootstrap for the current Review build. It supplies the
// pricing/license bindings older app code expects, then loads the product and
// the small shell enhancements in a deterministic order.
import { liteRemaining } from './pricing.js';
import { activeLicense } from './license.js';
import { flushPendingUsageReleases } from './billing-client.js';

globalThis.liteRemaining = liteRemaining;
globalThis.refreshMaterialLogixLicense = async () => {
  globalThis.lic = await activeLicense();
  return globalThis.lic;
};
await globalThis.refreshMaterialLogixLicense();
await flushPendingUsageReleases();

window.addEventListener('focus', () => {
  globalThis.refreshMaterialLogixLicense();
  flushPendingUsageReleases();
});
window.addEventListener('online', () => flushPendingUsageReleases());
window.addEventListener('storage', event => {
  if (event.key === 'cros:license' || event.key === 'cros:licenseCheck') {
    globalThis.refreshMaterialLogixLicense();
  }
});

await import('./app.js');
await import('./studio-shell.js');
