// Shared MaterialLogix human-geometry contract.
//
// This carries the auditable parts of the Fashion avatar standard into Studio:
// stable landmark names, explicit coordinates and provenance, and fail-closed
// completeness results. It deliberately stores no identity claim or raw PII.

export const HUMAN_GEOMETRY_SCHEMA = 'materiallogix.human-geometry.v2';
export const NORMALIZED_IMAGE_COORDINATES = 'image-normalized:x-right:y-down:z-camera-relative';
export const SUBJECT_WORLD_COORDINATES = 'mediapipe-world:meters:origin-hip-midpoint';

export const POSE_LANDMARK_CODES = Object.freeze([
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer', 'left_ear', 'right_ear',
  'mouth_left', 'mouth_right', 'left_shoulder', 'right_shoulder', 'left_elbow',
  'right_elbow', 'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
  'left_index', 'right_index', 'left_thumb', 'right_thumb', 'left_hip',
  'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index'
]);

export const HAND_LANDMARK_CODES = Object.freeze([
  'wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip',
  'index_mcp', 'index_pip', 'index_dip', 'index_tip',
  'middle_mcp', 'middle_pip', 'middle_dip', 'middle_tip',
  'ring_mcp', 'ring_pip', 'ring_dip', 'ring_tip',
  'pinky_mcp', 'pinky_pip', 'pinky_dip', 'pinky_tip'
]);

export const MOVENET_LANDMARK_CODES = Object.freeze([
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
]);

export const HUMAN_CANDIDATE_VERSION = '3.3.6';
export const HUMAN_CANDIDATE_ASSETS = Object.freeze([
  ['assets/human/human.esm.js', 2067875, 'e7c85047fb9492bd983b43d5217b54e9fb44393966f4c5db7c7ced1fdaf1fd9e'],
  ['assets/human/models/blazeface.json', 79038, 'cd7bbfc078270572beb39f9e5ae67aadbd50b5e67cff37e6d4f6b3ea39312e5f'],
  ['assets/human/models/blazeface.bin', 538928, 'dc9a97fdc50bc43216554bdd69aa3e7b9361a519ee7bdd996a2f69a98a6f9b72'],
  ['assets/human/models/facemesh.json', 95845, 'b60ca26f404724f43bd2b1575761d8265180e1f053cc0731caa68462927309e7'],
  ['assets/human/models/facemesh.bin', 1477958, '3826da640b0a3021161605369ee6af293f75d518040355b960ec71a3390c1c0b'],
  ['assets/human/models/handtrack.json', 602812, 'a27d86daea1799c65dd0ad99ea1855a6b6dc721bf7ba4d4eb1a138c9e51d5755'],
  ['assets/human/models/handtrack.bin', 2964837, '70164f725aefbbf8094a8ef4150dc10e906b6f0976b484ef8ec882d3eae4b812'],
  ['assets/human/models/handlandmark-lite.json', 83013, '8478ec3224129957f1436194738ad26ac78bbac8ea3be1730399ccad6964a27f'],
  ['assets/human/models/handlandmark-lite.bin', 2023432, '3dbf92db39720eac7f88aff322a24d3f4ed3ba1f54aa7a8a37b704f14cb76c0e'],
  ['assets/human/models/movenet-lightning.json', 161813, 'df8cbde44d00f533ccc4916a7c6ebc17316532fb3fadad114ec667fef22872e9'],
  ['assets/human/models/movenet-lightning.bin', 4650216, 'bf97bc10d9c8a11200b0190ed64ce039b6252f1aff7cb552aca99b3d191c2f34'],
  ['assets/human/models/blazepose-full.json', 157328, '543a8415032e47d9a57bbd7a17080cae62221acefbcd9007ad1b95e57f8c86eb'],
  ['assets/human/models/blazepose-full.bin', 6339202, '5dd67d57f4886a2ddfdad4496217e7ce012fb8d2e8f87d475a8cc0220d89086c']
].map(([path, bytes, sha256]) => Object.freeze({ path, bytes, sha256 })));

const finite = value => Number.isFinite(value) ? value : null;
const rounded = (value, places = 5) => {
  const n = finite(value);
  return n === null ? null : +n.toFixed(places);
};

export function namedLandmarks(points = [], codes = [], method = 'model-inference') {
  return points.map((point, index) => ({
    code: codes[index] || `point_${index}`,
    x: rounded(point?.x),
    y: rounded(point?.y),
    z: rounded(point?.z),
    visibility: rounded(point?.visibility, 3),
    presence: rounded(point?.presence, 3),
    method
  }));
}

export function landmarkBounds(landmarks = []) {
  const usable = landmarks.filter(p => finite(p.x) !== null && finite(p.y) !== null);
  if (!usable.length) return null;
  const xs = usable.map(p => p.x), ys = usable.map(p => p.y);
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  const x1 = Math.max(x, Math.min(1, Math.max(...xs)));
  const y1 = Math.max(y, Math.min(1, Math.max(...ys)));
  return { x: rounded(x), y: rounded(y), w: rounded(x1 - x), h: rounded(y1 - y) };
}

function unionBounds(groups = []) {
  return landmarkBounds(groups.flatMap(group => group || []));
}

export function foregroundMaskSummary(values, width, height, threshold = 0.5) {
  if (!values?.length || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || values.length < width * height) return null;
  let count = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!(values[y * width + x] >= threshold)) continue;
    count++; x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return {
    available: true, method: 'person-segmentation', threshold,
    coverage: rounded(count / (width * height), 4),
    bounds: count ? {
      x: rounded(x0 / width), y: rounded(y0 / height),
      w: rounded((x1 + 1 - x0) / width), h: rounded((y1 + 1 - y0) / height)
    } : null,
    rawMaskStored: false
  };
}

export function spatialGeometryModel({ faces = [], hands = [], poses = [], foreground = null } = {}) {
  const worldPoints = [...hands.map(x => x.worldLandmarks), ...poses.map(x => x.worldLandmarks)]
    .filter(Boolean).flat().filter(point => finite(point?.x) !== null
      && finite(point?.y) !== null && finite(point?.z) !== null);
  const zs = worldPoints.map(point => point.z);
  const imageBounds = unionBounds([
    ...faces.map(x => x.landmarks), ...hands.map(x => x.landmarks), ...poses.map(x => x.landmarks)
  ]);
  return {
    schema: 'materiallogix.spatial-geometry.v1',
    mode: worldPoints.length ? 'subject-3d-with-2d-scene-layers' : '2d-scene-layers',
    subject: {
      imageBounds, worldCoordinateSystem: SUBJECT_WORLD_COORDINATES,
      worldPointCount: worldPoints.length,
      depthRangeMeters: zs.length ? { near: rounded(Math.min(...zs)), far: rounded(Math.max(...zs)),
        span: rounded(Math.max(...zs) - Math.min(...zs)) } : null,
      metricScale: worldPoints.length > 0
    },
    layers: {
      foreground: foreground || { available: false, rawMaskStored: false },
      background: { identifiedByForegroundComplement: Boolean(foreground?.available),
        metricDepthMeasured: false,
        limitation: 'Single-view person segmentation does not establish metric scene depth.' }
    },
    capabilities: {
      subjectIsolationReady: Boolean(foreground?.available && foreground.bounds),
      backgroundReplacementReady: Boolean(foreground?.available && foreground.bounds),
      subjectRelative3dReady: worldPoints.length >= 21,
      metricSceneDepthReady: false
    }
  };
}

export function geometryAssurance({ faces = [], hands = [], poses = [] } = {}) {
  const findings = [];
  const hasImageCoordinates = point => finite(point?.x) !== null && finite(point?.y) !== null;
  const faceComplete = faces.every(face => (face.landmarks?.length || 0) >= 468
    && face.landmarks.slice(0, 468).every(hasImageCoordinates));
  const handComplete = hands.every(hand => (hand.landmarks?.length || 0) === HAND_LANDMARK_CODES.length
    && hand.landmarks.every(hasImageCoordinates));
  const poseComplete = poses.every(pose => (pose.landmarks?.length || 0) === POSE_LANDMARK_CODES.length
    && pose.landmarks.every(hasImageCoordinates));
  if (faces.length && !faceComplete) findings.push('face_topology_incomplete');
  if (hands.length && !handComplete) findings.push('hand_topology_incomplete');
  if (poses.length && !poseComplete) findings.push('pose_topology_incomplete');
  const expected = faces.length * 468 + hands.length * 21 + poses.length * 33;
  const observed = faces.reduce((n, x) => n + (x.landmarks?.length || 0), 0)
    + hands.reduce((n, x) => n + (x.landmarks?.length || 0), 0)
    + poses.reduce((n, x) => n + (x.landmarks?.length || 0), 0);
  return {
    status: findings.length ? 'blocked' : 'complete',
    coverage: expected ? rounded(Math.min(1, observed / expected), 4) : 1,
    findings
  };
}

export function humanGeometryRecord({ engine, engineVersion, faces = [], hands = [], poses = [], foreground = null, at } = {}) {
  return {
    schema: HUMAN_GEOMETRY_SCHEMA,
    coordinateSystem: NORMALIZED_IMAGE_COORDINATES,
    source: { kind: 'local-media', rawMediaUploaded: false },
    inference: { engine, version: engineVersion, execution: 'local-browser' },
    privacy: { containsBiometricGeometry: true, identityVerified: false, rawPiiStored: false },
    at: at || new Date().toISOString(),
    faces,
    hands,
    poses,
    spatial: spatialGeometryModel({ faces, hands, poses, foreground }),
    assurance: geometryAssurance({ faces, hands, poses })
  };
}

const pointFrom = (value, width = 1, height = 1) => {
  if (Array.isArray(value)) return { x: value[0] / width, y: value[1] / height, z: value[2] || 0 };
  const raw = value?.positionRaw;
  return Array.isArray(raw) ? { x: raw[0], y: raw[1], z: raw[2] || 0,
    visibility: value?.score, presence: value?.score } : null;
};

const worldPointFrom = value => Array.isArray(value?.distance) ? {
  x: value.distance[0], y: value.distance[1], z: value.distance[2] || 0,
  visibility: value?.score, presence: value?.score
} : null;

/** Convert the proof-only same-origin candidate into the existing geometry contract. */
export function mapHumanCandidateResult(result = {}, width = 1, height = 1, backend = 'unknown') {
  const faces = (result.face || []).map(face => {
    const points = (face.meshRaw || []).map(point => ({ x: point[0], y: point[1], z: point[2] || 0 }));
    const landmarks = namedLandmarks(points, [], 'human-candidate-face-mesh');
    const box = Array.isArray(face.boxRaw) ? face.boxRaw : [0, 0, 0, 0];
    return {
      x: rounded(box[0]), y: rounded(box[1]), w: rounded(box[2]), h: rounded(box[3]),
      score: rounded(face.faceScore ?? face.score ?? face.boxScore, 3) || 0,
      keypoints: [33, 263, 1, 13, 234, 454].map(index => ({
        x: landmarks[index]?.x, y: landmarks[index]?.y
      })),
      landmarks,
      transformationMatrix: null
    };
  });
  const hands = (result.hand || []).map(hand => {
    const points = (hand.keypoints || []).map(point => pointFrom(point, width, height)).filter(Boolean);
    const landmarks = namedLandmarks(points, HAND_LANDMARK_CODES, 'human-candidate-hand-landmark');
    const box = Array.isArray(hand.boxRaw) ? hand.boxRaw : [0, 0, 0, 0];
    return {
      x: rounded(box[0]), y: rounded(box[1]), w: rounded(box[2]), h: rounded(box[3]),
      score: rounded(hand.fingerScore ?? hand.score ?? hand.boxScore, 3) || 0,
      side: null,
      landmarks,
      worldLandmarks: []
    };
  });
  const poses = (result.body || []).map(body => {
    const canonical = value => String(value || '').replaceAll('_', '').toLowerCase();
    const byCode = new Map((body.keypoints || []).map(point => [canonical(point.part), point]));
    const blazePose = (body.keypoints || []).length >= POSE_LANDMARK_CODES.length
      && byCode.has(canonical('leftEyeInside'));
    const codes = blazePose ? POSE_LANDMARK_CODES : MOVENET_LANDMARK_CODES;
    const blazePoseAliases = {
      left_eye_inner: 'left_eye_inside', right_eye_inner: 'right_eye_inside',
      left_eye_outer: 'left_eye_outside', right_eye_outer: 'right_eye_outside',
      mouth_left: 'left_mouth', mouth_right: 'right_mouth',
      left_foot_index: 'left_foot', right_foot_index: 'right_foot'
    };
    const sourceCode = code => blazePose ? (blazePoseAliases[code] || code) : code;
    const sourcePoints = codes.map(code => byCode.get(canonical(sourceCode(code))));
    const points = sourcePoints.map(point => pointFrom(point));
    return {
      landmarks: namedLandmarks(points, codes, blazePose ? 'human-candidate-blazepose' : 'human-candidate-movenet'),
      worldLandmarks: blazePose
        ? namedLandmarks(sourcePoints.map(worldPointFrom), codes, 'human-candidate-blazepose-world')
        : []
    };
  });
  const pose = poses[0]?.landmarks || [];
  const byCode = new Map(pose.map(point => [point.code, point]));
  const anchor = code => {
    const point = byCode.get(code);
    return point ? { x: point.x, y: point.y, v: point.visibility ?? 1 } : null;
  };
  const body = poses.length ? {
    nose: anchor('nose'), lShoulder: anchor('left_shoulder'), rShoulder: anchor('right_shoulder'),
    lHip: anchor('left_hip'), rHip: anchor('right_hip')
  } : null;
  const mapping = humanGeometryRecord({
    engine: 'human-offline-candidate', engineVersion: HUMAN_CANDIDATE_VERSION,
    faces, hands, poses, foreground: null
  });
  mapping.inference.backend = backend;
  mapping.inference.productionSelected = false;
  mapping.inference.sensitiveInferenceDisabled = true;
  return { engine: `human-candidate-${HUMAN_CANDIDATE_VERSION}`, at: mapping.at,
    faces, hands, body, poses, spatial: mapping.spatial, mapping };
}

export function humanCandidateParity(reference, candidate) {
  const ref = reference?.mapping || reference || {};
  const next = candidate?.mapping || candidate || {};
  const referenceCounts = { faces: ref.faces?.length || 0, hands: ref.hands?.length || 0, poses: ref.poses?.length || 0 };
  const candidateCounts = { faces: next.faces?.length || 0, hands: next.hands?.length || 0, poses: next.poses?.length || 0 };
  const findings = [];
  if (candidateCounts.faces < referenceCounts.faces) findings.push('face_detection_regression');
  if (candidateCounts.faces > referenceCounts.faces) findings.push('face_detection_false_positive');
  if (candidateCounts.hands < referenceCounts.hands) findings.push('hand_detection_regression');
  if (candidateCounts.hands > referenceCounts.hands) findings.push('hand_detection_false_positive');
  if (candidateCounts.poses < referenceCounts.poses) findings.push('pose_detection_regression');
  if (candidateCounts.poses > referenceCounts.poses) findings.push('pose_detection_false_positive');
  if ((next.faces || []).some(face => (face.landmarks?.length || 0) < 468)) findings.push('face_topology_incomplete');
  if ((next.hands || []).some(hand => (hand.landmarks?.length || 0) !== 21)) findings.push('hand_topology_incomplete');
  if ((next.poses || []).some(pose => (pose.landmarks?.length || 0) !== 33)) findings.push('pose_topology_not_equivalent');
  if (next.assurance?.status !== 'complete') findings.push('geometry_assurance_blocked');
  return { accepted: findings.length === 0, referenceCounts, candidateCounts, findings: [...new Set(findings)] };
}
