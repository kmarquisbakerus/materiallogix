// The one place a video engine is chosen, and the only product code that reads
// the engine licence.
//
// Two facts have to live together here without either one being fudged:
//
//   1. The Pro Motion Engine is territorially licensed. A customer in the
//      European Union, the United Kingdom or South Korea may not use it, and
//      the restriction reaches the finished file, not just the render.
//   2. No generative video engine is enabled in this build. Today the Studio
//      renders a customer's own footage - trim, reframe, speed, fades, colour,
//      sound, captions - and no model of any kind touches the pixels.
//
// So the honest answer for every render today is "no generative engine", and
// that is what goes on the file. The gate below is not decoration waiting for
// a feature: it runs on every render, it records its decision, and the day an
// engine is added to ENABLED_VIDEO_ENGINES the territory check is already the
// only path to one. Nothing else may call `model-licence.js`.

import {
  ENGINE_LICENCES, ENGINE_PREFERENCE_KEY, PRO_VIDEO_ENGINE, STANDARD_VIDEO_ENGINE,
  engineChoice, engineChoiceLabel, engineProvenance, usableCountry, unrestrictedEngineIn
} from './model-licence.js';
import { customerCountry } from './region.js';

/**
 * Generative video engines this build can actually run.
 *
 * Empty on purpose. `KNOWN_LIMITATIONS.md` records that neither Wan 2.2 nor
 * HunyuanVideo is shipped; declaring one here without the runtime behind it
 * would put a false engine name on a customer's file. Adding an id here is the
 * single switch that turns the engine, its territory gate and its disclosure
 * on together.
 */
export const ENABLED_VIDEO_ENGINES = Object.freeze([]);

/** What produced a file when no model did. Stated, not omitted. */
export const EDITORIAL_PROVENANCE =
  'Rendered from your own footage with the editorial settings you chose. No generative video model was used.';

export function storedEnginePreference() {
  try { return localStorage.getItem(ENGINE_PREFERENCE_KEY); } catch { return null; }
}

export function rememberEnginePreference(engineId) {
  try {
    if (engineId) localStorage.setItem(ENGINE_PREFERENCE_KEY, engineId);
    else localStorage.removeItem(ENGINE_PREFERENCE_KEY);
  } catch { /* storage unavailable; the choice is re-made next time */ }
}

/**
 * Decide the engine for one render.
 *
 * `available` is injected so the territory gate can be exercised against a
 * build that does have engines - a test must be able to prove that a customer
 * in Dublin cannot reach the restricted engine, and it cannot prove that
 * against an empty list.
 *
 * Returns, always:
 *   generative  did a model make this
 *   engineId    which one, or null
 *   offered     may the customer switch
 *   locked      is the choice fixed, and
 *   lockReason  why
 *   blocked     must the render be refused
 *   notice      what to show the customer, '' when there is nothing to say
 *   provenance  what goes on the finished file
 */
export function resolveVideoEngine({ country = null, pro = false, preference = null,
  available = ENABLED_VIDEO_ENGINES } = {}) {
  const enabled = [...available].filter(id => ENGINE_LICENCES[id]);
  if (!enabled.length) {
    return {
      generative: false, engineId: null, offered: false, locked: true,
      lockReason: 'no_generative_engine', blocked: false, notice: '',
      provenance: EDITORIAL_PROVENANCE
    };
  }

  // The engines this build can run that carry no territorial condition. The
  // terms promise one of these sits beside any restricted engine we offer, so
  // this list is what makes that sentence true rather than aspirational.
  const unrestricted = enabled.filter(id => !ENGINE_LICENCES[id].excludedTerritories.length);
  const substitute = unrestricted[0] || null;

  const choice = engineChoice(country, { pro, preference });

  if (choice.blocked) {
    // The region could not be confirmed. That is only a reason to refuse when
    // the only thing we could run is territorially licensed - an Apache-2.0
    // engine raises no territorial question, and refusing it would take
    // generative video off an offline or proxied customer for a licence reason
    // that does not apply to them.
    if (!substitute) {
      return {
        generative: false, engineId: null, offered: false, locked: true,
        lockReason: choice.reason, blocked: true,
        notice: engineChoiceLabel(choice), provenance: ''
      };
    }
    return {
      generative: true, engineId: substitute, offered: false, locked: true,
      lockReason: 'region_unknown', blocked: false,
      notice: 'We could not confirm your region, so your video renders on the engine that carries no territorial restriction. The result is yours to use anywhere.',
      provenance: engineProvenance(substitute)
    };
  }

  if (!enabled.includes(choice.chosen)) {
    // The licence permits an engine this build cannot run. Substituting the
    // installed unrestricted one keeps the customer working; refusing would
    // contradict the promise that an unrestricted engine is always available.
    //
    // There is no substitute when the only installed engine is the restricted
    // one and the customer's territory excludes it - then refusing is correct,
    // because running it would be unlicensed use.
    if (!substitute) {
      return {
        generative: false, engineId: null, offered: false, locked: true,
        lockReason: 'engine_not_installed', blocked: true,
        notice: 'The engine your region requires is not installed on this build. Update the Video pack, or render without a generative engine.',
        provenance: ''
      };
    }
    return {
      generative: true, engineId: substitute, offered: false, locked: true,
      lockReason: 'engine_not_installed', blocked: false,
      notice: `Your video renders on the ${ENGINE_LICENCES[substitute].label} engine, which carries no territorial restriction.`,
      provenance: engineProvenance(substitute)
    };
  }

  // A switch is only real when there are two engines the customer may pick
  // between AND this build can run both.
  const switchable = choice.offered
    && enabled.includes(PRO_VIDEO_ENGINE) && enabled.includes(STANDARD_VIDEO_ENGINE);
  return {
    generative: true, engineId: choice.chosen, offered: switchable,
    locked: !switchable, lockReason: switchable ? '' : choice.reason,
    blocked: false, notice: engineChoiceLabel(choice),
    provenance: engineProvenance(choice.chosen)
  };
}

/**
 * Does this build honour the terms' promise that an unrestricted engine is
 * available to every customer, in every territory, alongside any restricted
 * one? A build that offers only a territorially licensed engine breaks that
 * sentence, so the invariant is asserted rather than assumed.
 */
export function keepsUnrestrictedPromise(countryCode, available = ENABLED_VIDEO_ENGINES) {
  const enabled = [...available].filter(id => ENGINE_LICENCES[id]);
  if (!enabled.some(id => ENGINE_LICENCES[id].excludedTerritories.length)) return true;
  const licensedHere = unrestrictedEngineIn(countryCode);
  return Boolean(licensedHere && enabled.includes(licensedHere.id));
}

/**
 * The same decision, with the region fetched from the edge. This is what the
 * render path calls; `resolveVideoEngine` stays pure so it can be tested
 * against every country without a network.
 */
export async function videoEngineForThisCustomer({ pro = false, available = ENABLED_VIDEO_ENGINES } = {}) {
  // Skip the lookup entirely when no engine could be territorially restricted:
  // asking the network where somebody is, to answer a question that has no
  // territorial component, is a request we have no reason to make.
  const needsRegion = [...available].some(id => ENGINE_LICENCES[id]?.excludedTerritories.length);
  const country = needsRegion ? usableCountry(await customerCountry()) : null;
  return { country, ...resolveVideoEngine({ country, pro, preference: storedEnginePreference(), available }) };
}
