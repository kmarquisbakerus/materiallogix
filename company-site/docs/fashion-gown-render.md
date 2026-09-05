# Rendering the MaterialLogix Fashion image

The Fashion card on librasidetechnologies.com should carry a rendered evening
gown on a brown dress form. This note records how to produce it.

## Why it is not already in the repository

Studio generates through a local ComfyUI engine on `127.0.0.1:8188`, using
checkpoints installed on the machine running it (`studio/js/generate.js`).
It is local-first by design: nothing is generated on a server, and there is no
hosted path to it. So this render has to come off the founder's own machine.

## How to render it

`tools/render-site-photography.mjs` in this repository does it, along with the
other three site photographs. It imports `studio/js/generate.js` and calls the
same functions the Studio UI calls, so what lands in `media/` is Studio output
rather than an approximation of it.

```
node tools/render-site-photography.mjs --only gown --dry-run   # see the compiled prompt
node tools/render-site-photography.mjs --only gown --preset full
```

The prompt below is the one the script carries; it is recorded here so the
wording can be reviewed without reading the script.

## Prompt

Studio composes the final prompt by appending its own guidance constants, so
write the subject only and let `compilePhotoPrompt` add the rest. Style intent
`natural`.

Pass the subject alone to `generateOne`. It compiles the prompt itself, so
handing it an already-compiled prompt appends the guidance twice -- and for
this prompt the doubled text crosses the 1000-character guard in
`buildTxt2Img` and throws.

**Prompt**

```
A floor-length evening gown in deep bronze silk satin, presented on a rich
brown dress form in a dark studio. Trumpet silhouette: a draped asymmetric
bodice, a nipped waist, close through the hip and thigh, breaking below the
knee into a full sweep with a short train pooling on the floor. Single
shoulder strap. Visible hand-finished seams and a fine bias-cut drape.
Museum presentation: the form on a slim brass stand against a near-black
ground, one soft key light from the upper left, a cool rim light from the
right, deep falloff into shadow.
```

**Negative** — add to Studio's own `NATURAL_PHOTO_AVOID` list:

```
human model, face, head, arms, hands, mannequin head, shop window, price tag,
hanger, clutter, text, logo, watermark, busy background, flat even lighting
```

## Settings

| Setting | Value |
| --- | --- |
| Size | 1440 x 900 (the card's media box is landscape) |
| Composition | Gown centred, tall and slender, generous negative space either side |
| Steps / CFG | Studio defaults (22 / 6.5) are a good starting point |
| Style intent | `natural` |

## A heuristic this shot used to trip

Studio decides whether a prompt is a human scene by matching words in it. This
prompt used to trip that test twice -- on `silhouette`, and on the `hand` in
`hand-finished` -- so Studio appended its human-scene guidance to a picture of
an empty dress form: believable skin texture, gaze between people, complete
credible hands, relaxed facial muscles. All of it pulled against a negative
that bans face, head, arms and hands.

`HUMAN_TERMS` in `studio/js/generate.js` no longer matches either. A term
inside a hyphenated compound (`hand-finished`, `man-made`, `body-con`) is
taken as describing a thing rather than naming a person, and `silhouette` is
out of the list: in apparel it names a garment shape, and a silhouette hides
the skin and expression that guidance is about. Prompts that do show people
still get it -- they say so another way.

The renderer still warns if this shot comes back classed as a human scene, as
a tripwire against a regression. `--dry-run` prints the compiled prompt, so
what the engine will be sent is visible before anything renders.

## What a usable take looks like

- The silhouette reads as a gown at thumbnail size, not as an object.
- The dress form is clearly brown and clearly a dress form, not a torso.
- The satin has one narrow specular band with deep falloff, not an overall glow.
- Nothing in the frame looks like UI, a header, a footer, or a dashboard.
- No invented text, logo, or watermark anywhere in the image.

## Dropping it in

1. Export as WebP at quality 82-86, save to `media/fashion-gown.webp`.
2. Point the Fashion card's `<img>` in `index.html` at it, and update the
   `alt` text to describe the gown.
3. In the `sideof` repository, add `media/fashion-gown.webp` to the required
   asset list in `scripts/copy-libraside-site.cjs` and to the `COMPANY_FILES`
   map in `workers/hostname-router.js`. The map is an allowlist; a file that is
   not in it returns 404 on the apex host.
4. Remove `media/fashion-maker.webp` if nothing else references it.
