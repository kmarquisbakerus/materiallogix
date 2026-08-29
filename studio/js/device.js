// On-device capability probe: what can THIS phone or laptop realistically run?
//
// The staging plan for on-device generation ("light mode"):
//   stage 1 (now)    — detect WebGPU + memory budget honestly, and route people
//                      to the fast lane (a computer running ComfyUI on Wi-Fi).
//   stage 2          — tiny distilled model via WebGPU for draft-quality
//                      composition previews, run in slices with progress saved
//                      between slices so a locked screen or memory purge never
//                      loses work ("this takes a while — come back later").
//   stage 3          — native app wrapping the same review core, using the
//                      phone's NPU (Core ML / NNAPI) for real quality.
//
// Rule carried from the rest of the product: measure, never guess. If the
// device can't do it, say so and point at the tier that can.

export async function probeDevice() {
  const out = {
    webgpu: false,
    adapter: null,
    maxBufferMB: 0,
    deviceMemoryGB: navigator.deviceMemory || null,   // coarse, Chrome-only
    cores: navigator.hardwareConcurrency || null,
    touch: matchMedia('(pointer: coarse)').matches,
    verdict: 'none'
  };

  if ('gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        out.webgpu = true;
        out.adapter = adapter.info?.vendor
          ? `${adapter.info.vendor} ${adapter.info.architecture || ''}`.trim()
          : 'GPU';
        out.maxBufferMB = Math.floor((adapter.limits?.maxBufferSize || 0) / 1048576);
      }
    } catch { /* stays false */ }
  }

  // Honest tiering. A distilled draft model wants roughly ≥1GB buffers and
  // ≥4GB device memory to survive a browser tab's share of RAM.
  if (out.webgpu && out.maxBufferMB >= 1024 && (out.deviceMemoryGB == null || out.deviceMemoryGB >= 4)) {
    out.verdict = 'draft-capable';
  } else if (out.webgpu) {
    out.verdict = 'weak-gpu';
  }
  return out;
}

export function deviceSummary(d) {
  const cores = d.cores ? `${d.cores} processor cores` : 'processor';
  const mem = d.deviceMemoryGB ? `${d.deviceMemoryGB}+ GB RAM` : 'unknown RAM';
  if (!d.webgpu) return `${cores} · ${mem} · no graphics card this browser can reach`;
  return `${d.adapter || 'GPU'} · ${d.maxBufferMB} MB max buffer · ${mem}`;
}
