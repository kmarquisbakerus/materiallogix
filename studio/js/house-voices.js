// MaterialLogix house performance personas. Regional direction describes
// cadence and cultural context, never a caricature or a claim about identity.
// Each profile has a separate Apache-licensed Kokoro model voice. Public launch
// still requires the blinded listening panel to accept every rendered seat.
const ENGINE_VOICE_BY_PROFILE = Object.freeze({
  'district-low': 'am_fenrir', 'harbor-warm': 'af_heart', 'lakeside-direct': 'af_sarah',
  'heartland-calm': 'am_michael', 'northline-bright': 'af_bella', 'metro-quick': 'am_puck',
  'mesa-warm': 'af_nicole', 'sol-bilingual': 'em_alex', 'luz-bilingual': 'ef_dora',
  'avenue-composed': 'am_onyx', 'studio-clear': 'af_aoede', 'signal-social': 'af_nova'
});

const voice = ({ id, name, locale, region, register, pace, exaggeration, cfgWeight,
  temperature, personality, attitude, cadence, direction, avoid }) => ({
  id, name, locale, region, register, provider: 'local-kokoro',
  modelVoice: ENGINE_VOICE_BY_PROFILE[id], engineLanguage: locale.startsWith('es') ? 'es' : 'en', pace,
  exaggeration, cfgWeight, temperature, personality, attitude, cadence, avoid,
  description: `${personality}. ${attitude}. ${cadence}. ${direction}.`,
  status: 'local-voice-candidate'
});

export const HOUSE_VOICES = [
  voice({ id:'district-low', name:'District', locale:'en-US', region:'Middle Atlantic / urban', register:'low', pace:.88, exaggeration:.48, cfgWeight:.40, temperature:.55, personality:'Observant and quietly funny', attitude:'Self-possessed city confidence', cadence:'Compact phrases with an unhurried landing', direction:'Grounded, contemporary, and assured', avoid:'No hard-sell growl or exaggerated street vernacular' }),
  voice({ id:'harbor-warm', name:'Harbor', locale:'en-US', region:'Middle Atlantic', register:'warm mid-low', pace:.94, exaggeration:.55, cfgWeight:.36, temperature:.60, personality:'Warm, thoughtful, and editorial', attitude:'The trusted person who already did the homework', cadence:'Patient pauses and gently shaped conclusions', direction:'Measured storytelling with clear consonants', avoid:'No prestige affectation or over-polished announcer tone' }),
  voice({ id:'lakeside-direct', name:'Lakeside', locale:'en-US', region:'Upper Midwest', register:'clear mid', pace:1.01, exaggeration:.62, cfgWeight:.30, temperature:.52, personality:'Practical, upbeat, and candid', attitude:'Friendly competence without fuss', cadence:'Clean starts, open vowels, direct endings', direction:'Explain the useful thing first', avoid:'No folksy caricature or artificial cheer' }),
  voice({ id:'heartland-calm', name:'Heartland', locale:'en-US', region:'Midwest', register:'low-mid', pace:.91, exaggeration:.46, cfgWeight:.42, temperature:.48, personality:'Calm, generous, and steady', attitude:'Reassuring without talking down', cadence:'Roomy phrasing and natural breath', direction:'Let important details arrive without pressure', avoid:'No syrupy warmth or rural stereotype' }),
  voice({ id:'northline-bright', name:'Northline', locale:'en-US', region:'Northern US', register:'bright mid', pace:1.07, exaggeration:.72, cfgWeight:.26, temperature:.66, personality:'Curious, bright, and lightly playful', attitude:'Smart friend sharing a useful discovery', cadence:'Energetic pickup with precise stops', direction:'Keep the sparkle controlled and conversational', avoid:'No sing-song delivery or breathless hype' }),
  voice({ id:'metro-quick', name:'Metro', locale:'en-US', region:'Northeast urban', register:'focused mid', pace:1.12, exaggeration:.64, cfgWeight:.22, temperature:.74, personality:'Quick-witted, decisive, and sharp', attitude:'Busy, capable, and worth keeping up with', cadence:'Compressed pauses and confident endings', direction:'Move fast without swallowing meaning', avoid:'No impatience, shouting, or cartoon accent' }),
  voice({ id:'mesa-warm', name:'Mesa', locale:'en-US', region:'Southwest US', register:'warm mid', pace:.98, exaggeration:.64, cfgWeight:.28, temperature:.56, personality:'Open, optimistic, and easygoing', attitude:'Modern hospitality with quiet confidence', cadence:'Spacious middles and clean final words', direction:'Invite the listener in without overselling', avoid:'No drawl imitation or wellness cliché' }),
  voice({ id:'sol-bilingual', name:'Sol', locale:'es-US', region:'US Spanish', register:'warm mid-low', pace:.95, exaggeration:.52, cfgWeight:.37, temperature:.63, personality:'Grounded, expressive, and generous', attitude:'Bilingual confidence with natural warmth', cadence:'Meaning-led phrasing that protects Spanish stress and names', direction:'Sound contemporary in either language', avoid:'No generic Latin accent, code-switch gimmick, or unreviewed pronunciation' }),
  voice({ id:'luz-bilingual', name:'Luz', locale:'es-US', region:'US Spanish', register:'bright mid', pace:1.05, exaggeration:.76, cfgWeight:.24, temperature:.68, personality:'Bubbly, clever, and welcoming', attitude:'The person who makes the room feel easier', cadence:'Bright lift, varied pauses, and crisp product language', direction:'Keep joy natural rather than promotional', avoid:'No exaggerated accent, forced enthusiasm, or unreviewed Spanish' }),
  voice({ id:'avenue-composed', name:'Avenue', locale:'en-US', region:'General American / urban', register:'composed low', pace:.86, exaggeration:.42, cfgWeight:.45, temperature:.46, personality:'Composed, discerning, and subtly warm', attitude:'Executive calm with nothing to prove', cadence:'Deliberate emphasis and generous silence', direction:'Make restraint feel expensive and human', avoid:'No aloof luxury whisper or theatrical gravitas' }),
  voice({ id:'studio-clear', name:'Studio', locale:'en-US', region:'General American', register:'balanced mid', pace:.99, exaggeration:.54, cfgWeight:.39, temperature:.51, personality:'Approachable, articulate, and creatively curious', attitude:'A skilled collaborator at the same table', cadence:'Balanced pace with explanatory emphasis', direction:'Ideal for product walkthroughs and thoughtful demos', avoid:'No tutorial monotone or synthetic perkiness' }),
  voice({ id:'signal-social', name:'Signal', locale:'en-US', region:'General American / social', register:'bright', pace:1.15, exaggeration:.82, cfgWeight:.18, temperature:.78, personality:'Bold, spontaneous, and socially fluent', attitude:'Direct-to-camera confidence with a real sense of humor', cadence:'Immediate hook, conversational pivots, controlled landing', direction:'Feel present, not performed', avoid:'No influencer parody, shouting, vocal fry imitation, or trend-chasing slang' })
];

export const HOUSE_VOICE_BY_ID = Object.fromEntries(HOUSE_VOICES.map(item => [item.id, item]));
