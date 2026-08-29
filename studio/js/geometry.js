// Human geometry via MediaPipe Tasks — Google's free, Apache-licensed
// vision models, loaded lazily from CDN and run entirely in this browser.
//
// This is the one optional network dependency in the product, and it degrades
// honestly: offline, everything else works and the heuristics stand alone.
// When it loads, the checks upgrade from "energy suggests a subject here" to
// "there is a face HERE, and this crop puts it under the caption".
//
// Honesty note on hands: the landmark model fits a 21-point hand topology to
// whatever it sees, so it cannot literally count a sixth finger. What it gives
// us is *where hands are*, so the reviewer is pointed at them with the loupe.

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
import {
  HAND_LANDMARK_CODES, POSE_LANDMARK_CODES, humanGeometryRecord,
  foregroundMaskSummary, landmarkBounds, namedLandmarks,
  HUMAN_CANDIDATE_ASSETS, HUMAN_CANDIDATE_VERSION, mapHumanCandidateResult
} from './human-geometry.js';

const MODELS = {
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
};

let enginePromise = null;
const candidatePromises = new Map();

const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');

export function humanCandidateConfig(backend = 'webgl', modelBasePath = new URL('../assets/human/models/', import.meta.url).href,
  bodyModel = 'movenet-lightning') {
  if (!['webgl', 'cpu'].includes(backend)) throw new Error('Unsupported people-mapping backend.');
  if (!['movenet-lightning', 'blazepose-full'].includes(bodyModel)) throw new Error('Unsupported people-mapping body model.');
  return {
    backend,
    modelBasePath,
    cacheModels: false,
    validateModels: true,
    debug: false,
    async: true,
    warmup: 'none',
    filter: { enabled: false, return: false },
    gesture: { enabled: false },
    face: {
      enabled: true,
      detector: { modelPath: 'blazeface.json', maxDetected: 4, minConfidence: 0.5, return: false, mask: false },
      mesh: { enabled: true, modelPath: 'facemesh.json', keepInvalid: false },
      attention: { enabled: false }, iris: { enabled: false }, emotion: { enabled: false },
      description: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false },
      gear: { enabled: false }
    },
    body: { enabled: true, modelPath: `${bodyModel}.json`, maxDetected: 1, minConfidence: 0.3 },
    hand: {
      enabled: true, maxDetected: 4, landmarks: true,
      detector: { modelPath: 'handtrack.json' },
      skeleton: { modelPath: 'handlandmark-lite.json' }
    },
    object: { enabled: false },
    segmentation: { enabled: false }
  };
}

export function humanCandidateConfigAssurance(config = {}, expectedOrigin = typeof location === 'undefined' ? null : location.origin) {
  const findings = [];
  if (!['webgl', 'cpu'].includes(config.backend)) findings.push('backend_not_bounded');
  if (!['movenet-lightning.json', 'blazepose-full.json'].includes(config.body?.modelPath)) findings.push('body_model_not_pinned');
  try {
    const url = new URL(config.modelBasePath);
    if (!expectedOrigin || url.origin !== expectedOrigin) findings.push('model_path_not_same_origin');
  } catch { findings.push('model_path_not_same_origin'); }
  const disabled = [config.gesture, config.object, config.segmentation, config.face?.iris,
    config.face?.emotion, config.face?.description, config.face?.antispoof,
    config.face?.liveness, config.face?.attention, config.face?.gear];
  if (disabled.some(section => section?.enabled !== false)) findings.push('sensitive_inference_enabled');
  if (config.cacheModels !== false) findings.push('unbounded_model_cache');
  return { accepted: findings.length === 0, findings };
}

export async function verifyHumanCandidateAssets(fetchImpl = fetch) {
  const verified = [];
  let runtimeBytes = null;
  for (const artifact of HUMAN_CANDIDATE_ASSETS) {
    const url = new URL(`../${artifact.path}`, import.meta.url);
    if (typeof location !== 'undefined' && url.origin !== location.origin) throw new Error('human_candidate_cross_origin_asset');
    const response = await fetchImpl(url.href, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`human_candidate_asset_unavailable:${artifact.path}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== artifact.bytes) throw new Error(`human_candidate_asset_size_mismatch:${artifact.path}`);
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
    if (sha256 !== artifact.sha256) throw new Error(`human_candidate_asset_integrity_mismatch:${artifact.path}`);
    verified.push({ path: artifact.path, bytes: bytes.byteLength, sha256 });
    if (artifact.path.endsWith('/human.esm.js')) runtimeBytes = bytes;
  }
  if (!runtimeBytes) throw new Error('human_candidate_runtime_missing');
  return { verified, runtimeBytes };
}

export async function loadHumanCandidate(backend = 'webgl', bodyModel = 'movenet-lightning') {
  const candidateKey = `${backend}:${bodyModel}`;
  if (!candidatePromises.has(candidateKey)) {
    const pending = (async () => {
      const config = humanCandidateConfig(backend, new URL('../assets/human/models/', import.meta.url).href, bodyModel);
      const assurance = humanCandidateConfigAssurance(config);
      if (!assurance.accepted) throw new Error(`human_candidate_config_blocked:${assurance.findings.join(',')}`);
      const assets = await verifyHumanCandidateAssets();
      const moduleUrl = URL.createObjectURL(new Blob([assets.runtimeBytes], { type: 'text/javascript' }));
      try {
        const module = await import(/* @vite-ignore */ moduleUrl);
        const Human = module.Human || module.default;
        if (typeof Human !== 'function') throw new Error('human_candidate_runtime_invalid');
        const engine = new Human(config);
        return { engine, backend, verified: assets.verified };
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    })();
    candidatePromises.set(candidateKey, pending);
    pending.catch(() => candidatePromises.delete(candidateKey));
  }
  return candidatePromises.get(candidateKey);
}

const CANDIDATE_TIMEOUT_MS = 45000;

/** Proof-only candidate execution. It is never called by the production analysis path. */
export async function analyzeHumanCandidate(source, w, h, {
  backend = 'webgl', allowCpuFallback = true, bodyModel = 'movenet-lightning'
} = {}) {
  if (!source || !w || !h) return null;
  const run = async backend => {
    const loaded = await loadHumanCandidate(backend, bodyModel);
    const started = performance.now();
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('human_candidate_timeout')), CANDIDATE_TIMEOUT_MS);
    });
    let result;
    try { result = await Promise.race([loaded.engine.detect(source), timeout]); }
    finally { clearTimeout(timeoutId); }
    const mapped = mapHumanCandidateResult(result, w, h, backend);
    mapped.performance = {
      elapsedMs: +(performance.now() - started).toFixed(1),
      backend,
      bodyModel,
      modelReportedMs: Number(result?.performance?.total) || null,
      version: HUMAN_CANDIDATE_VERSION
    };
    return mapped;
  };
  try {
    return await run(backend);
  } catch (error) {
    if (!allowCpuFallback || backend === 'cpu') throw error;
    return run('cpu');
  }
}

/** Load once per session. Resolves to null (not an error) when unreachable. */
export function loadGeometry() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const faceLm = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.face },
        runningMode: 'IMAGE',
        numFaces: 4,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true
      });
      const handLm = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.hand },
        runningMode: 'IMAGE',
        numHands: 4,
        minHandDetectionConfidence: 0.4
      });
      const poseLm = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.pose },
        runningMode: 'IMAGE',
        numPoses: 1,
        outputSegmentationMasks: true
      });
      return { faceLm, handLm, poseLm };
    })().catch(() => {
      // One offline start must not disable people mapping for the whole
      // session: forget the failure so the next call can try again.
      enginePromise = null;
      return null;
    });
  }
  return enginePromise;
}

const LOAD_TIMEOUT_MS = 25000;

/**
 * Map faces, hands, and bodies in a decoded image or canvas. Compatibility
 * boxes and anchors remain available to the crop and capture-review tools.
 *
 * The engine load is raced against a timeout: on a blocked or crawling CDN the
 * import can hang rather than reject, and analysis must never hold up an
 * import queue. A load that finishes late is still cached for the next call.
 */
export async function analyzeGeometry(source, w, h) {
  const engine = await Promise.race([
    loadGeometry(),
    new Promise(resolve => setTimeout(() => resolve(null), LOAD_TIMEOUT_MS))
  ]);
  if (!engine || !w || !h) return null;
  try {
    const faceRaw = engine.faceLm.detect(source);
    const faces = (faceRaw.faceLandmarks || []).map((pts, i) => {
      const landmarks = namedLandmarks(pts, [], 'mediapipe-face-landmarker');
      const box = landmarkBounds(landmarks) || { x: 0, y: 0, w: 0, h: 0 };
      // Preserve the six-point order used by the existing head-yaw review.
      const keypoints = [33, 263, 1, 13, 234, 454].map(index => ({
        x: landmarks[index]?.x, y: landmarks[index]?.y
      }));
      return {
        ...box,
        score: 1,
        keypoints,
        landmarks,
        transformationMatrix: faceRaw.facialTransformationMatrixes?.[i]?.data
          ? Array.from(faceRaw.facialTransformationMatrixes[i].data, n => +n.toFixed(6))
          : null
      };
    });
    const handsRaw = engine.handLm.detect(source);
    const hands = (handsRaw.landmarks || []).map((pts, i) => {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const p of pts) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      return {
        x: x0, y: y0, w: x1 - x0, h: y1 - y0,
        score: +(handsRaw.handedness?.[i]?.[0]?.score || 0).toFixed(3),
        side: handsRaw.handedness?.[i]?.[0]?.categoryName || null,
        landmarks: namedLandmarks(pts, HAND_LANDMARK_CODES, 'mediapipe-hand-landmarker'),
        worldLandmarks: namedLandmarks(handsRaw.worldLandmarks?.[i] || [], HAND_LANDMARK_CODES, 'mediapipe-hand-world')
      };
    });
    // Body pose: five anchor landmarks are enough for full-circle orientation
    // (bodies, unlike faces, stay trackable from behind).
    let body = null;
    let foreground = null;
    const poses = [];
    try {
      const pose = engine.poseLm.detect(source);
      const mask = pose.segmentationMasks?.[0];
      if (mask) {
        foreground = foregroundMaskSummary(mask.getAsFloat32Array(), mask.width, mask.height);
        mask.close?.();
      }
      const lm = pose.landmarks?.[0];
      if (lm && lm.length >= 25) {
        const pick = i => ({ x: +lm[i].x.toFixed(4), y: +lm[i].y.toFixed(4),
                             v: +(lm[i].visibility ?? 1).toFixed(3) });
        body = { nose: pick(0), lShoulder: pick(11), rShoulder: pick(12),
                 lHip: pick(23), rHip: pick(24) };
        poses.push({
          landmarks: namedLandmarks(lm, POSE_LANDMARK_CODES, 'mediapipe-pose-landmarker'),
          worldLandmarks: namedLandmarks(pose.worldLandmarks?.[0] || [], POSE_LANDMARK_CODES, 'mediapipe-pose-world')
        });
      }
    } catch { /* pose optional */ }
    const mapping = humanGeometryRecord({
      engine: 'mediapipe-tasks-vision', engineVersion: '0.10.14', faces, hands, poses, foreground
    });
    return { engine: 'mediapipe-tasks-0.10', at: mapping.at, faces, hands, body, poses,
      spatial: mapping.spatial, mapping };
  } catch {
    return null;
  }
}
