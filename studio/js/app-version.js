// One version, one source. The publisher stamps studio/version.json from
// these; installed copies compare against the live stamp at boot.
export const APP_VERSION = '0.1.0';
export const MINIMUM_COMPATIBLE = '0.1.0';

export function versionBehind(local, remote) {
  const parse = v => String(v).split('.').map(Number);
  const [a, b] = [parse(local), parse(remote)];
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) < (b[i] || 0)) return true;
    if ((a[i] || 0) > (b[i] || 0)) return false;
  }
  return false;
}
