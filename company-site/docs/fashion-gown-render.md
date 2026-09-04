# Rendering the MaterialLogix Fashion image

The Fashion card on librasidetechnologies.com should carry a rendered evening
gown on a brown dress form. This note records how to produce it.

## Why it is not already in the repository

Studio generates through a local ComfyUI engine on `127.0.0.1:8188`, using
checkpoints installed on the machine running it (`studio/js/generate.js`).
It is local-first by design: nothing is generated on a server, and there is no
hosted path to it. So this render has to come off the founder's own machine.

## Prompt

Studio composes the final prompt by appending its own guidance constants, so
write the subject only and let `compilePhotoPrompt` add the rest. Style intent
`natural`.

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
