// Which engine may serve which customer, and why.
//
// The video engine's licence is not a footnote: the Tencent Hunyuan Community
// License grants rights "for the Territory only", and defines the Territory as
// the world minus the European Union, the United Kingdom and South Korea.
// Serving a customer outside it is unlicensed use, not a policy preference.
//
// The clause that decides the shape of this control is §5(c), quoted verbatim:
//
//   "You must not use, reproduce, modify, distribute, or display the Tencent
//    Hunyuan Works, Output or results of the Tencent Hunyuan Works outside the
//    Territory. Any such use outside the Territory is unlicensed and
//    unauthorized under this Agreement."
//
// It restricts the OUTPUT, not only the model. Rendering in Ohio and then
// showing the result to someone in Dublin is "display ... outside the
// Territory". So this gates on where the CUSTOMER is, and it gates delivery as
// well as generation - a US-only server estate does not make an EU delivery
// licensed, and the licence says nothing about where the metal sits.

export const LICENCE_SCHEMA = 'materiallogix.engine-licence.v1';

// The 27 member states. The licence says "European Union", so the EEA states
// that are not EU members - Norway, Iceland, Liechtenstein - and Switzerland
// fall outside the exclusion as drafted. Narrow reading, deliberately: this
// list decides who we refuse, and refusing too many is its own harm.
export const EU_MEMBER_STATES = Object.freeze([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
]);

export const HUNYUAN_EXCLUDED = Object.freeze([...EU_MEMBER_STATES, 'GB', 'KR']);

export const ENGINE_LICENCES = Object.freeze({
  hunyuan: Object.freeze({
    id: 'hunyuan',
    label: 'HunyuanVideo',
    licence: 'Tencent Hunyuan Community License Agreement',
    commercial: true,
    excludedTerritories: HUNYUAN_EXCLUDED,
    restrictsOutput: true,          // §5(c) - the delivery, not just the render
    monthlyActiveUserCeiling: 100_000_000,   // §4
    mayImproveOtherModels: false,   // §5(b)
    governingLaw: 'Hong Kong SAR'
  }),
  wan: Object.freeze({
    id: 'wan',
    label: 'Wan 2.2',
    licence: 'Apache-2.0',
    commercial: true,
    excludedTerritories: Object.freeze([]),
    restrictsOutput: false,
    monthlyActiveUserCeiling: null,
    mayImproveOtherModels: true,
    governingLaw: null
  })
});

/**
 * Which engine belongs to which lane.
 *
 * The standard and free lanes run Wan 2.2, which is Apache-2.0 and carries no
 * territorial condition. HunyuanVideo *is* the Pro Motion Engine - the thing
 * the Pro tiers are sold on - and it is the one with the licensed territory.
 *
 * That containment matters: most customers never touch the restricted engine,
 * so the restriction reaches only Pro renders, and a Pro customer in an
 * excluded territory falls back to the same engine everybody else uses rather
 * than losing video altogether.
 */
export const STANDARD_VIDEO_ENGINE = 'wan';
export const PRO_VIDEO_ENGINE = 'hunyuan';

// Best first, for the places that just want the list.
export const VIDEO_ENGINE_PREFERENCE = Object.freeze([PRO_VIDEO_ENGINE, STANDARD_VIDEO_ENGINE]);

const upper = value => String(value ?? '').trim().toUpperCase();

// ISO 3166-1 permanently reserves these for private use, so they name no
// country and can never clear a territory check. Letting them through would
// fail open on exactly the input a misconfigured caller is most likely to send.
const RESERVED = /^(AA|ZZ|Q[M-Z]|X[A-Z])$/;

/**
 * A country code we are willing to decide on. The server decides where a
 * customer is; this module only decides what that location permits. The client
 * is not the trust boundary here - it is the second one.
 */
export function usableCountry(countryCode) {
  const country = upper(countryCode);
  return /^[A-Z]{2}$/.test(country) && !RESERVED.test(country) ? country : null;
}

/** Whether this engine may be used for, and its output delivered to, a country. */
export function engineAllowedIn(engineId, countryCode) {
  const engine = ENGINE_LICENCES[engineId];
  if (!engine) return false;
  // An unknown location is not a licensed one. Failing open here would mean
  // guessing in the direction that breaks the licence.
  const country = usableCountry(countryCode);
  if (!country) return false;
  return !engine.excludedTerritories.includes(country);
}

/**
 * The engine to use for a customer in this country, or null if none may serve
 * them. Never silently downgrades quality without saying which engine ran:
 * callers must record `engine` on the output so provenance stays honest.
 */
export function videoEngineFor(countryCode, { pro = false } = {}) {
  const wanted = pro ? PRO_VIDEO_ENGINE : STANDARD_VIDEO_ENGINE;
  if (engineAllowedIn(wanted, countryCode)) return ENGINE_LICENCES[wanted];
  // A Pro customer in an excluded territory drops to the standard engine, not
  // to nothing. Losing the upgrade is a fair outcome; losing video is not.
  if (engineAllowedIn(STANDARD_VIDEO_ENGINE, countryCode)) return ENGINE_LICENCES[STANDARD_VIDEO_ENGINE];
  return null;
}

export const ENGINE_PREFERENCE_KEY = 'cros:videoEngine';

/**
 * The engine switch, and whether the customer may touch it.
 *
 * Inside the Territory a Pro customer chooses: the Pro Motion Engine, or the
 * standard one that carries no territorial condition on their finished work.
 * Outside it the switch is locked to standard and cannot be turned on - not
 * disabled in the interface and honoured elsewhere, but resolved to standard
 * here, so no caller can route around it by passing a preference.
 *
 * A standard-plan customer has no switch because they have no second engine.
 */
export function engineChoice(countryCode, { pro = false, preference = null } = {}) {
  const country = usableCountry(countryCode);
  if (!country) {
    return { engine: null, offered: false, locked: true, chosen: null, blocked: true,
      reason: 'region_unknown' };
  }
  const standard = ENGINE_LICENCES[STANDARD_VIDEO_ENGINE];
  if (!pro) {
    return { engine: standard, offered: false, locked: true, chosen: STANDARD_VIDEO_ENGINE,
      blocked: false, reason: 'not_a_pro_plan' };
  }
  if (!engineAllowedIn(PRO_VIDEO_ENGINE, country)) {
    // The lock is the licence, not a preference we could be talked out of.
    return { engine: standard, offered: false, locked: true, chosen: STANDARD_VIDEO_ENGINE,
      blocked: false, reason: 'not_licensed_here' };
  }
  const wants = preference === STANDARD_VIDEO_ENGINE ? STANDARD_VIDEO_ENGINE : PRO_VIDEO_ENGINE;
  return { engine: ENGINE_LICENCES[wants], offered: true, locked: false, chosen: wants,
    blocked: false, reason: '' };
}

/** What the switch should say, for the customer looking at it. */
export function engineChoiceLabel(choice) {
  if (choice.blocked) return 'We could not confirm your region, so video cannot render yet.';
  if (choice.reason === 'not_a_pro_plan') return '';
  if (choice.reason === 'not_licensed_here') {
    return 'The Pro Motion Engine is not licensed in your region. Your video renders on the standard engine, and the result carries no territorial restriction.';
  }
  return choice.chosen === PRO_VIDEO_ENGINE
    ? 'Pro Motion Engine. Its publisher licenses the result for use outside the European Union, the United Kingdom and South Korea.'
    : 'Standard engine. Slower on complex motion, and the result carries no territorial restriction.';
}

/**
 * Every engine this customer may choose between, best first.
 *
 * The terms promise that an unrestricted engine is available to every customer
 * on every plan, so that a customer who intends to publish worldwide need not
 * carry a territorial restriction on their own work. That promise is only true
 * if this list always contains one.
 */
export function videoEnginesAvailableIn(countryCode) {
  return VIDEO_ENGINE_PREFERENCE
    .filter(id => engineAllowedIn(id, countryCode))
    .map(id => ENGINE_LICENCES[id]);
}

/** An engine whose output carries no territorial condition, or null. */
export function unrestrictedEngineIn(countryCode) {
  return videoEnginesAvailableIn(countryCode)
    .find(engine => engine.excludedTerritories.length === 0) || null;
}

/**
 * What a rendered file records about the engine that made it. The terms
 * promise the customer can tell, so this goes in the provenance line rather
 * than staying an implementation detail.
 */
export function engineProvenance(engineId) {
  const engine = ENGINE_LICENCES[engineId];
  if (!engine) return '';
  return engine.excludedTerritories.length
    ? `Rendered with the ${engine.label} engine, which its publisher licenses for use outside the European Union, the United Kingdom and South Korea.`
    : `Rendered with the ${engine.label} engine, which carries no territorial restriction.`;
}

/**
 * Why a render was refused or rerouted, in words a customer can act on. Never
 * names the licence holder's terms as the customer's fault.
 */
export function engineNoticeFor(countryCode, { pro = false } = {}) {
  const country = usableCountry(countryCode);
  if (!country) {
    return { engine: null, rerouted: false, blocked: true,
      message: 'We could not confirm your region, and the video engine is licensed by region. Reconnect so we can check, and the render will continue.' };
  }
  const chosen = videoEngineFor(country, { pro });
  if (!chosen) {
    return { engine: null, rerouted: false, blocked: true,
      message: 'Video rendering is not available in your region yet.' };
  }
  // Only a Pro customer can be rerouted, because only Pro asks for the engine
  // with a territory. Say what they lose, plainly, rather than downgrading in
  // silence and letting them wonder why it looks different.
  if (pro && chosen.id !== PRO_VIDEO_ENGINE) {
    return { engine: chosen, rerouted: true, blocked: false,
      message: `The Pro Motion Engine is not licensed for your region, so your video renders on the ${chosen.label} engine — the same one every other plan uses. Everything else in Pro is unchanged.` };
  }
  return { engine: chosen, rerouted: false, blocked: false, message: '' };
}
