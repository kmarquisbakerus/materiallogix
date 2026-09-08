import { spawnSync } from 'node:child_process';

let failed = false;
for (const file of ['tests/browser/journey.mjs', 'tests/browser/music.mjs']) {
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit', env: process.env });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
