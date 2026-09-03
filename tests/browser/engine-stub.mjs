// A ComfyUI-compatible stand-in, so the generative paths can be driven without
// a GPU. It answers the same endpoints the Studio calls and returns a real PNG,
// which is what the blend and boundary checks need.
import { createServer } from 'node:http';
import { deflateSync, crc32 } from 'node:zlib';

const PORT = Number(process.argv[2] || 8188);

/** A real, decodable PNG - a tiny one still has to survive createImageBitmap. */
function png(width = 768, height = 512) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      raw[offset++] = (x * 7 + y * 3) % 256;
      raw[offset++] = (y * 5) % 256;
      raw[offset++] = (x * 3) % 256;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4); check.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

const OBJECT_INFO = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sd15-inpainting.safetensors', 'realistic-v6.safetensors']] } }, output: ['MODEL', 'CLIP', 'VAE'] },
  LoadImage: { input: { required: { image: [['a.png']] } }, output: ['IMAGE', 'MASK'] },
  VAEEncodeForInpaint: { input: { required: { pixels: ['IMAGE'], vae: ['VAE'], mask: ['MASK'], grow_mask_by: ['INT'] } }, output: ['LATENT'] },
  CLIPTextEncode: { input: { required: { text: ['STRING'], clip: ['CLIP'] } }, output: ['CONDITIONING'] },
  KSampler: { input: { required: { model: ['MODEL'] } }, output: ['LATENT'] },
  VAEDecode: { input: { required: { samples: ['LATENT'], vae: ['VAE'] } }, output: ['IMAGE'] },
  SaveImage: { input: { required: { images: ['IMAGE'] } }, output: [] },
  UpscaleModelLoader: { input: { required: { model_name: [['RealESRGAN_x4plus.pth']] } }, output: ['UPSCALE_MODEL'] },
  ImageUpscaleWithModel: { input: { required: { upscale_model: ['UPSCALE_MODEL'], image: ['IMAGE'] } }, output: ['IMAGE'] },
  EmptyLatentImage: { input: { required: { width: ['INT'], height: ['INT'] } }, output: ['LATENT'] }
};

export function engineStub(port = PORT) {
  const image = png();
  const jobs = new Map();
  let sequence = 0;
  const json = (response, body) => {
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    response.end(JSON.stringify(body));
  };
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://local').pathname;
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
      return response.end();
    }
    if (path === '/system_stats') return json(response, { devices: [{ name: 'Journey GPU', type: 'cuda', vram_total: 12884901888 }] });
    if (path === '/object_info') return json(response, OBJECT_INFO);
    if (path.startsWith('/object_info/')) { const key = path.split('/')[2]; return json(response, { [key]: OBJECT_INFO[key] }); }
    if (path === '/upload/image' && request.method === 'POST') {
      request.resume();
      return request.on('end', () => json(response, { name: `upload-${++sequence}.png`, subfolder: '', type: 'input' }));
    }
    if (path === '/prompt' && request.method === 'POST') {
      request.resume();
      return request.on('end', () => { const id = `job-${++sequence}`; jobs.set(id, Date.now()); json(response, { prompt_id: id, number: sequence, node_errors: {} }); });
    }
    if (path.startsWith('/history/')) {
      const id = path.split('/')[2];
      const at = jobs.get(id);
      if (!at) return json(response, {});
      if (Date.now() - at < 1200) return json(response, {});
      return json(response, { [id]: { status: { status_str: 'success', completed: true }, outputs: { 9: { images: [{ filename: `${id}.png`, subfolder: '', type: 'output' }] } } } });
    }
    if (path === '/view') {
      response.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' });
      return response.end(image);
    }
    response.writeHead(404, { 'access-control-allow-origin': '*' });
    response.end('not found');
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await engineStub();
  console.log(`engine stub on http://127.0.0.1:${PORT}`);
}
