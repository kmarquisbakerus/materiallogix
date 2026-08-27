// Undo stack + per-asset audit trail.
//
// Every decision in this tool is a claim someone will be asked to defend
// ("who approved the one with six fingers?"). The log is the answer, and it
// ships inside the export package.

const UNDO_LIMIT = 60;
const LOG_LIMIT = 120;

const stack = [];

const clone = obj => structuredClone(obj);

/** Call immediately BEFORE mutating an asset. */
export function snapshot(asset, label) {
  stack.push({ kind: 'asset', id: asset.id, label, data: clone(asset) });
  if (stack.length > UNDO_LIMIT) stack.shift();
}

export function snapshotProject(project, label) {
  stack.push({ kind: 'project', id: project.id, label, data: clone(project) });
  if (stack.length > UNDO_LIMIT) stack.shift();
}

export const canUndo = () => stack.length > 0;
export const peekLabel = () => stack[stack.length - 1]?.label || null;
export const popUndo = () => stack.pop() || null;
export const clearUndo = () => { stack.length = 0; };

/** Append an audit entry. Reviewer identity is whatever the operator typed. */
export function log(asset, what, who) {
  asset.log = asset.log || [];
  const last = asset.log[asset.log.length - 1];
  // Collapse repeated edits of the same field within a minute.
  if (last && last.what === what && Date.now() - new Date(last.at).getTime() < 60000) return;
  asset.log.push({ at: new Date().toISOString(), what, who: who || 'reviewer' });
  if (asset.log.length > LOG_LIMIT) asset.log.splice(0, asset.log.length - LOG_LIMIT);
}

export function logMarkdown(assets) {
  const L = ['# Decision audit trail', '',
    'Every recorded action, newest last. Times are local to the reviewing machine.', ''];
  const any = assets.filter(a => a.log?.length);
  if (!any.length) L.push('_No actions recorded._');
  for (const a of any) {
    L.push(`## ${a.filename}`, '');
    for (const e of a.log) {
      L.push(`- \`${new Date(e.at).toLocaleString()}\` — ${e.who} — ${e.what}`);
    }
    L.push('');
  }
  return L.join('\n');
}
