// What someone types becomes GPU time and, on the cloud lane, money.
// Every generation prompt passes through here first — the same screen runs
// client-side (fast refusal, clear message) and is mirrored server-side in
// the worker before any cloud quote (the authority). Two jobs:
//   1. Refuse what the AUP forbids before a single frame is spent on it.
//   2. Refuse waste: oversized prompts and identical re-runs.

const LIMIT = 800;

// Category rules, not an exhaustive word list: each entry needs BOTH sides
// to match, which keeps "a young family at dinner" safe while refusing what
// it must. Order is the order of refusal messages.
const RULES = [
  {
    reason: 'Content involving minors cannot be combined with sexual or revealing direction. This is refused permanently and is never re-worded around.',
    a: /\b(child|children|kid|kids|minor|minors|teen|teens|teenager|underage|schoolgirl|schoolboy|toddler|infant|[0-9]{1,2}[ -]?(?:yo|year[ -]old))\b/i,
    b: /\b(nude|naked|topless|undress|lingerie|sexual|sexy|erotic|explicit|nsfw|porn|seductive|provocative)\b/i,
  },
  {
    reason: 'Sexual or nude depictions of real, named people need that person’s documented consent — use a consented identity pack instead of a prompt.',
    a: /\b(nude|naked|topless|undress|sexual|explicit|nsfw|porn)\b/i,
    b: /\b(celebrity|actress|actor|singer|influencer|looks? like|resembling|in the likeness of)\b/i,
  },
  {
    reason: 'Graphic violence and gore are outside what the Studio renders.',
    a: /\b(gore|dismember|decapitat|mutilat|entrails|torture)\b/i,
    b: /./,
  },
  {
    reason: 'Depicting identifiable people in criminal acts they did not commit is defamation, not creative direction.',
    a: /\b(committing|caught|arrested for)\b/i,
    b: /\b(crime|robbery|assault|shoplifting|fraud)\b/i,
  },
];

export function normalizePrompt(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Screen a generation prompt. `recent` is an array of previously accepted
 * normalized prompts (the caller keeps it); an identical re-run is refused
 * as waste, since re-queueing the same text buys the same picture twice.
 */
export function screenPrompt(text, { recent = [], limit = LIMIT } = {}) {
  const normalized = normalizePrompt(text);
  if (!normalized) return { ok: false, reason: 'Describe the image before generating.' };
  if (normalized.length > limit) {
    return { ok: false, reason: `Direction over ${limit} characters costs quality, not detail — trim the prompt.` };
  }
  for (const rule of RULES) {
    if (rule.a.test(normalized) && rule.b.test(normalized)) return { ok: false, reason: rule.reason };
  }
  if (recent.includes(normalized)) {
    return { ok: false, reason: 'This exact prompt just ran. Change the direction, or reuse the render you already have.' };
  }
  return { ok: true, normalized };
}
