// MaterialLogix local house-voice direction profiles. Parler-TTS is the
// text-described base (Apache-2.0); Chatterbox remains the owned/custom-pack
// engine. Neither requires a paid provider call for local rendering.
const voice = (id, name, locale, region, register, speaker, pace, direction) => ({
  id, name, locale, region, register, provider:'local-parler', speaker, pace,
  description:`${speaker}'s voice is ${register}, ${direction}. The recording is very clear, close, and professionally dry.`,
  status:'local-model'
});

export const HOUSE_VOICES = [
  voice('district-low','District','en-US','Middle Atlantic / urban','low','Jon',0.92,'grounded, contemporary, assured, with clean consonants and no caricature'),
  voice('harbor-warm','Harbor','en-US','Middle Atlantic','warm mid-low','David',0.96,'measured and editorial, with patient pauses'),
  voice('lakeside-direct','Lakeside','en-US','Upper Midwest','clear mid','Jordan',1.00,'practical, friendly, and direct'),
  voice('heartland-calm','Heartland','en-US','Midwest','low-mid','Will',0.94,'steady and relaxed, with open phrasing'),
  voice('northline-bright','Northline','en-US','Northern US','bright mid','Lauren',1.04,'precise, energetic, and conversational'),
  voice('metro-quick','Metro','en-US','Northeast urban','focused mid','Jason',1.08,'quick and intelligent, with compressed pauses and confident endings'),
  voice('mesa-warm','Mesa','en-US','Southwest US','warm mid','Brenda',0.97,'spacious, modern, and welcoming'),
  voice('sol-bilingual','Sol','es-US','US Spanish','warm mid-low','Gary',0.98,'natural and contemporary, with bilingual-friendly pronunciation'),
  voice('luz-bilingual','Luz','es-US','US Spanish','bright mid','Laura',1.02,'welcoming and clear, suited to product narration'),
  voice('avenue-composed','Avenue','en-US','General American / urban','composed low','Bruce',0.90,'restrained and luxurious, with deliberate emphasis'),
  voice('studio-clear','Studio','en-US','General American','balanced mid','Emily',1.00,'approachable and natural, suited to creative walkthroughs'),
  voice('signal-social','Signal','en-US','General American / social','bright','Joy',1.10,'direct-to-camera, hook-forward, and controlled rather than shouty')
];

export const HOUSE_VOICE_BY_ID = Object.fromEntries(HOUSE_VOICES.map(item => [item.id, item]));
