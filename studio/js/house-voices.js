// MaterialLogix local house performance profiles. Each profile supplies a
// stable pace, intensity, and variation target to the bundled Chatterbox
// renderer. Personal timbre requires a consented voice reference.
const voice = (id, name, locale, region, register, pace, exaggeration, cfgWeight, temperature, direction) => ({
  id, name, locale, region, register, provider:'local-chatterbox', pace,
  exaggeration, cfgWeight, temperature,
  description:`${register} delivery: ${direction}. Tuned for clear, close, professionally dry narration.`,
  status:'local-performance-profile'
});

export const HOUSE_VOICES = [
  voice('district-low','District','en-US','Middle Atlantic / urban','low',0.92,0.52,0.36,0.62,'grounded, contemporary, assured, with clean consonants and no caricature'),
  voice('harbor-warm','Harbor','en-US','Middle Atlantic','warm mid-low',0.96,0.56,0.33,0.58,'measured and editorial, with patient pauses'),
  voice('lakeside-direct','Lakeside','en-US','Upper Midwest','clear mid',1.00,0.60,0.30,0.55,'practical, friendly, and direct'),
  voice('heartland-calm','Heartland','en-US','Midwest','low-mid',0.94,0.50,0.35,0.54,'steady and relaxed, with open phrasing'),
  voice('northline-bright','Northline','en-US','Northern US','bright mid',1.04,0.70,0.27,0.66,'precise, energetic, and conversational'),
  voice('metro-quick','Metro','en-US','Northeast urban','focused mid',1.08,0.68,0.24,0.70,'quick and intelligent, with compressed pauses and confident endings'),
  voice('mesa-warm','Mesa','en-US','Southwest US','warm mid',0.97,0.60,0.32,0.58,'spacious, modern, and welcoming'),
  voice('sol-bilingual','Sol','es-US','US Spanish','warm mid-low',0.98,0.58,0.32,0.60,'natural and contemporary, with bilingual-friendly pronunciation'),
  voice('luz-bilingual','Luz','es-US','US Spanish','bright mid',1.02,0.68,0.28,0.64,'welcoming and clear, suited to product narration'),
  voice('avenue-composed','Avenue','en-US','General American / urban','composed low',0.90,0.48,0.38,0.50,'restrained and luxurious, with deliberate emphasis'),
  voice('studio-clear','Studio','en-US','General American','balanced mid',1.00,0.60,0.30,0.57,'approachable and natural, suited to creative walkthroughs'),
  voice('signal-social','Signal','en-US','General American / social','bright',1.10,0.74,0.22,0.72,'direct-to-camera, hook-forward, and controlled rather than shouty')
];

export const HOUSE_VOICE_BY_ID = Object.fromEntries(HOUSE_VOICES.map(item => [item.id, item]));
