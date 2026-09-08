import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compilePhotoPrompt, applyPhotoStyleDefaults, assertLocalEngineUrl,
  normalizeInpaintSelection, normalizeInpaintPath, summarizeInpaintMask,
  buildTxt2Img, buildInpaint, buildUpscale, validateInpaintObjectInfo
} from '../studio/js/generate.js';

test('an empty or unknown request is refused before it reaches the engine', () => {
  assert.throws(() => compilePhotoPrompt('   '), /Prompt is empty/);
  assert.throws(() => compilePhotoPrompt('a mug', '', 'cartoon'), /Unknown Photo style intent/);
});

test('photographic integrity is added by default and skipped only when asked', () => {
  const natural = compilePhotoPrompt('a ceramic mug on linen');
  assert.ok(natural.appliedRules.includes('photographic-integrity'));
  assert.ok(natural.prompt.startsWith('a ceramic mug on linen'));
  assert.ok(natural.prompt.length > 'a ceramic mug on linen'.length);

  const stylized = compilePhotoPrompt('a ceramic mug on linen', '', 'stylized');
  assert.equal(stylized.prompt, 'a ceramic mug on linen', 'a stylized request is passed through untouched');
  assert.deepEqual(stylized.appliedRules, []);
});

test('a scene with people picks up the human-integrity rules', () => {
  const scene = compilePhotoPrompt('two people sharing coffee');
  assert.ok(scene.appliedRules.includes('human-scene-integrity'));
  assert.match(scene.prompt, /hands/);
});

test('applyPhotoStyleDefaults exposes only what the graph needs', () => {
  assert.deepEqual(Object.keys(applyPhotoStyleDefaults('a mug')).sort(), ['negative', 'prompt', 'styleIntent']);
});

test('the engine address may never leave this computer', () => {
  assert.ok(assertLocalEngineUrl('http://127.0.0.1:8188'));
  assert.ok(assertLocalEngineUrl('http://localhost:8188'));
  assert.throws(() => assertLocalEngineUrl('http://example.com:8188'), /must stay on this computer/);
  assert.throws(() => assertLocalEngineUrl('http://user:pass@127.0.0.1:8188'), /Unsafe/);
  assert.throws(() => assertLocalEngineUrl('ftp://127.0.0.1'), /Unsafe/);
  assert.throws(() => assertLocalEngineUrl('nonsense'), /Invalid/);
  assert.throws(() => assertLocalEngineUrl('http://192.168.1.9:8188'), /must stay on this computer/);
  assert.ok(assertLocalEngineUrl('http://192.168.1.9:8188', { allowPrivateLan: true }));
});

test('a rectangle selection is clamped inside the frame', () => {
  assert.deepEqual(normalizeInpaintSelection({}), { x: 25, y: 25, width: 50, height: 50 });
  assert.deepEqual(normalizeInpaintSelection({ x: -10, y: 250, width: 500, height: 0 }),
    { x: 0, y: 99, width: 100, height: 1 });
  assert.throws(() => normalizeInpaintSelection({ x: 'left' }), /must be a number/);
});

test('a freehand path drops junk points and keeps source-relative coordinates', () => {
  const path = normalizeInpaintPath([{ x: 0.1, y: 0.1 }, { x: 'x', y: 2 }, null, { x: 5, y: -5 }]);
  assert.deepEqual(path, [{ x: 0.1, y: 0.1 }, { x: 1, y: 0 }]);
  assert.throws(() => normalizeInpaintPath('nope'), /must be an array/);
});

test('a mask summary reports bounds and kind without retaining the drawn points', () => {
  const lasso = summarizeInpaintMask({ outline: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }] });
  assert.equal(lasso.kind, 'lasso');
  assert.equal(Math.round(lasso.x), 20);
  assert.equal(Math.round(lasso.width), 60);
  assert.equal(lasso.pointCount, 4);
  assert.equal(Object.hasOwn(lasso, 'outline'), false, 'raw points must not travel with the job record');

  assert.equal(summarizeInpaintMask({ strokes: [[{ x: .5, y: .5 }]] }).kind, 'brush');
  assert.equal(summarizeInpaintMask({ outline: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }],
    strokes: [[{ x: .5, y: .5 }]] }).kind, 'mixed');
  assert.throws(() => summarizeInpaintMask({}), /Draw around the area/);
  assert.throws(() => summarizeInpaintMask({ outline: [{ x: .2, y: .2 }, { x: .8, y: .2 }] }), /Finish drawing/);
});

test('the txt2img graph carries the compiled prompt, size, and a reusable seed', () => {
  const { graph, seed } = buildTxt2Img({ ckpt: 'model.safetensors', prompt: 'a mug', width: 832, height: 1216, steps: 20, cfg: 6 });
  assert.ok(Number.isInteger(seed));
  const nodes = Object.values(graph);
  const sampler = nodes.find(n => n.class_type === 'KSampler');
  assert.equal(sampler.inputs.seed, seed);
  assert.equal(sampler.inputs.steps, 20);
  const latent = nodes.find(n => n.class_type === 'EmptyLatentImage');
  assert.equal(latent.inputs.width, 832);
  assert.equal(latent.inputs.height, 1216);
  assert.ok(nodes.some(n => n.class_type === 'SaveImage'));
  const positive = nodes.filter(n => n.class_type === 'CLIPTextEncode').map(n => n.inputs.text);
  assert.ok(positive.some(text => text.includes('a mug')));
});

test('the inpaint graph keeps the source and the mask on separate inputs', () => {
  const { graph } = buildInpaint({ imageName: 'src.png', maskName: 'mask.png', ckpt: 'inpaint.safetensors', prompt: 'a lamp', growMaskBy: 12 });
  const loads = Object.values(graph).filter(n => n.class_type === 'LoadImage').map(n => n.inputs.image);
  assert.deepEqual(loads.sort(), ['mask.png', 'src.png']);
  const encode = Object.values(graph).find(n => n.class_type === 'VAEEncodeForInpaint');
  assert.equal(encode.inputs.grow_mask_by, 12);
});

test('an upscale graph refuses to run without an image and a model', () => {
  assert.throws(() => buildUpscale({ imageName: '', model: 'x.pth' }), /No source image/);
  assert.throws(() => buildUpscale({ imageName: 'a.png', model: '' }), /No upscale model/);
  const { graph } = buildUpscale({ imageName: 'a.png', model: 'RealESRGAN_x4plus.pth' });
  assert.ok(Object.values(graph).some(n => n.class_type === 'ImageUpscaleWithModel'));
});

test('engine compatibility reports exactly what is missing', () => {
  const complete = {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sd15-inpainting.safetensors', 'plain.safetensors']] } } },
    LoadImage: { output: ['IMAGE', 'MASK'] },
    VAEEncodeForInpaint: { input: { required: { pixels: ['IMAGE'], vae: ['VAE'], mask: ['MASK'], grow_mask_by: ['INT'] } } },
    CLIPTextEncode: {}, KSampler: {}, VAEDecode: {}, SaveImage: {}
  };
  const ok = validateInpaintObjectInfo(complete);
  assert.equal(ok.compatibleNodes, true);
  assert.equal(ok.executable, true);
  assert.deepEqual(ok.inpaintModels, ['sd15-inpainting.safetensors']);

  const noMask = structuredClone(complete);
  noMask.LoadImage.output = ['IMAGE'];
  assert.equal(validateInpaintObjectInfo(noMask).compatibleNodes, false);
  assert.ok(validateInpaintObjectInfo(noMask).missing.includes('LoadImage:IMAGE+MASK'));

  const noInpaintModel = structuredClone(complete);
  noInpaintModel.CheckpointLoaderSimple.input.required.ckpt_name = [['plain.safetensors']];
  const partial = validateInpaintObjectInfo(noInpaintModel);
  assert.equal(partial.compatibleNodes, true);
  assert.equal(partial.compatibleModel, false);
  assert.equal(partial.executable, false);

  assert.equal(validateInpaintObjectInfo({}).compatibleNodes, false);
});
