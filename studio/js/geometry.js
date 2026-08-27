// Face and hand geometry via MediaPipe Tasks — Google's free, Apache-licensed
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
const MODELS = {
  face: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
};

let enginePromise = null;

/** Load once per session. Resolves to null (not an error) when unreachable. */
export function loadGeometry() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const faceDet = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.face },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5
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
        numPoses: 1
      });
      return { faceDet, handLm, poseLm };
    })().catch(() => null);
  }
  return enginePromise;
}

const LOAD_TIMEOUT_MS = 25000;

/**
 * Detect faces and hands in a decoded image or canvas.
 * Returns normalized 0..1 boxes, or null when the engine is unavailable.
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
    const faces = (engine.faceDet.detect(source).detections || []).map(d => ({
      x: d.boundingBox.originX / w,
      y: d.boundingBox.originY / h,
      w: d.boundingBox.width / w,
      h: d.boundingBox.height / h,
      score: +(d.categories?.[0]?.score || 0).toFixed(3),
      // BlazeFace keypoints (already normalized): right eye, left eye, nose
      // tip, mouth, right ear, left ear — enough to estimate head yaw.
      keypoints: (d.keypoints || []).map(k => ({ x: +k.x.toFixed(4), y: +k.y.toFixed(4) }))
    }));
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
        side: handsRaw.handedness?.[i]?.[0]?.categoryName || null
      };
    });
    // Body pose: five anchor landmarks are enough for full-circle orientation
    // (bodies, unlike faces, stay trackable from behind).
    let body = null;
    try {
      const pose = engine.poseLm.detect(source);
      const lm = pose.landmarks?.[0];
      if (lm && lm.length >= 25) {
        const pick = i => ({ x: +lm[i].x.toFixed(4), y: +lm[i].y.toFixed(4),
                             v: +(lm[i].visibility ?? 1).toFixed(3) });
        body = { nose: pick(0), lShoulder: pick(11), rShoulder: pick(12),
                 lHip: pick(23), rHip: pick(24) };
      }
    } catch { /* pose optional */ }
    return { engine: 'mediapipe-tasks-0.10', at: new Date().toISOString(), faces, hands, body };
  } catch {
    return null;
  }
}
