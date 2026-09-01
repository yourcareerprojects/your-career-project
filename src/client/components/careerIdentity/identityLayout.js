/**
 * Thematic layout for identity puzzle pieces.
 *
 * Primary clustering uses relatedTraitIds / connections so related traits
 * sit together even across categories. Same-category isolates fall back to
 * category groups.
 *
 * Non-overlap is the hard constraint. Assemblies are distributed across the
 * screen; confirmed themes prefer a slightly more central band, emerging
 * themes a wider band — never at the cost of collisions.
 */

import {
  assignInterlockingEdges,
  interlockingGridDims,
  PUZZLE_OUTER_SCALE,
} from './identityPuzzleShape';

const BASE_NODE_SIZE = 96;
const NODE_GAP = 2;
/** Extra clearance between assembly bounding circles. */
const ASSEMBLY_GAP = 0;
const MAX_SPREAD_X = 0.28;
const MAX_SPREAD_Y = 0.26;
/** Vertical bias so the constellation sits closer to the refresh controls. */
const VERTICAL_CENTER_RATIO = 0.22;

function isEmergingLayer(node) {
  return node?.layer === 'emerging';
}

function nodeId(node) {
  return node?.id || node?.traitId;
}

function nodeVisualRadius(baseSize = BASE_NODE_SIZE) {
  return (baseSize / 2) * PUZZLE_OUTER_SCALE;
}

/** Stable catalog order for category fallback sectors. */
export const CATEGORY_LAYOUT_ORDER = [
  'values',
  'interests',
  'strengths',
  'work_style',
  'thinking_style',
  'motivation',
  'environment',
  'communication',
  'leadership',
  'problem_solving',
  'learning',
  'social_orientation',
];

function fitBaseSize(nodes, width, height) {
  if (!nodes.length || width <= 0 || height <= 0) return BASE_NODE_SIZE;

  const r = nodeVisualRadius(BASE_NODE_SIZE) + NODE_GAP / 2;
  const packedArea = nodes.length * Math.PI * r * r;
  const usable = width * height * 0.68;
  if (packedArea <= usable) return BASE_NODE_SIZE;
  return Math.max(64, BASE_NODE_SIZE * Math.sqrt(usable / packedArea));
}

function categorySortKey(category) {
  const idx = CATEGORY_LAYOUT_ORDER.indexOf(category);
  return idx < 0 ? CATEGORY_LAYOUT_ORDER.length : idx;
}

/**
 * Partition nodes into category groups (catalog order).
 */
export function groupNodesByCategory(nodes) {
  const groups = new Map();
  for (const node of nodes || []) {
    const category = node.category || 'other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(node);
  }

  const categories = [...groups.keys()].sort(
    (a, b) => categorySortKey(a) - categorySortKey(b)
  );

  for (const category of categories) {
    groups.get(category).sort(
      (a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0)
    );
  }

  return { categories, groups };
}

/**
 * Build undirected adjacency from relatedTraitIds and optional API connections.
 * Catalog links are treated as bidirectional for layout.
 */
export function buildRelatednessAdjacency(nodes, connections = []) {
  const ids = new Set((nodes || []).map((n) => nodeId(n)).filter(Boolean));
  const adj = new Map([...ids].map((id) => [id, new Set()]));

  const link = (a, b) => {
    if (!a || !b || a === b || !ids.has(a) || !ids.has(b)) return;
    adj.get(a).add(b);
    adj.get(b).add(a);
  };

  for (const node of nodes || []) {
    const id = nodeId(node);
    for (const relatedId of node.relatedTraitIds || []) {
      link(id, relatedId);
    }
  }

  for (const edge of connections || []) {
    link(edge.fromTraitId || edge.from, edge.toTraitId || edge.to);
  }

  return adj;
}

/**
 * Connected components among visible nodes (relatedness clusters).
 */
export function findRelatednessComponents(nodes, connections = []) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (!list.length) return [];

  const adj = buildRelatednessAdjacency(list, connections);
  const byId = new Map(list.map((n) => [nodeId(n), n]));
  const seen = new Set();
  const components = [];

  for (const node of list) {
    const start = nodeId(node);
    if (!start || seen.has(start)) continue;

    const stack = [start];
    const members = [];
    seen.add(start);

    while (stack.length) {
      const id = stack.pop();
      const current = byId.get(id);
      if (current) members.push(current);
      for (const next of adj.get(id) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }

    members.sort((a, b) => {
      const layerDiff = Number(isEmergingLayer(a)) - Number(isEmergingLayer(b));
      if (layerDiff !== 0) return layerDiff;
      return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
    });
    components.push(members);
  }

  return components;
}

/**
 * Group nodes into layout clusters:
 * 1) multi-node relatedness components stay together
 * 2) unrelated singletons merge by category
 */
export function groupNodesForLayout(nodes, connections = []) {
  const components = findRelatednessComponents(nodes, connections);
  const clusters = [];
  const categorySingletons = new Map();

  for (const component of components) {
    if (component.length >= 2) {
      const seed = component[0];
      clusters.push({
        key: `theme:${nodeId(seed)}`,
        kind: 'relatedness',
        members: component,
      });
      continue;
    }

    const alone = component[0];
    if (!alone) continue;
    const category = alone.category || 'other';
    if (!categorySingletons.has(category)) categorySingletons.set(category, []);
    categorySingletons.get(category).push(alone);
  }

  const categories = [...categorySingletons.keys()].sort(
    (a, b) => categorySortKey(a) - categorySortKey(b)
  );
  for (const category of categories) {
    const members = categorySingletons.get(category);
    members.sort(
      (a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0)
    );
    clusters.push({
      key: `category:${category}`,
      kind: 'category',
      members,
    });
  }

  clusters.sort((a, b) => {
    const aConfirmed = a.members.some((n) => !isEmergingLayer(n)) ? 0 : 1;
    const bConfirmed = b.members.some((n) => !isEmergingLayer(n)) ? 0 : 1;
    if (aConfirmed !== bConfirmed) return aConfirmed - bConfirmed;
    return b.members.length - a.members.length;
  });

  return clusters;
}

/**
 * Build a uniform-size interlocking assembly for one thematic cluster.
 */
function buildClusterAssembly(cluster, bodySize) {
  const members = cluster.members || [];
  const { cols, rows } = interlockingGridDims(members.length);
  const edgeKey = cluster.key || members.map((m) => nodeId(m)).join('|');

  const cells = members.map((node, index) => ({
    id: nodeId(node),
    node,
    col: index % cols,
    row: Math.floor(index / cols),
  }));

  const edgesById = assignInterlockingEdges(cells, edgeKey);
  const avgCol = cells.reduce((sum, cell) => sum + cell.col, 0) / cells.length;
  const avgRow = cells.reduce((sum, cell) => sum + cell.row, 0) / cells.length;

  const pieces = cells.map((cell) => ({
    id: cell.id,
    category: cell.node.category,
    layer: cell.node.layer || 'confirmed',
    bodySize,
    baseSize: bodySize,
    edges: edgesById.get(cell.id),
    localX: (cell.col - avgCol) * bodySize,
    localY: (cell.row - avgRow) * bodySize,
  }));

  const halfW = (cols * bodySize) / 2;
  const halfH = (rows * bodySize) / 2;
  const radius =
    Math.hypot(halfW, halfH) +
    (bodySize * (PUZZLE_OUTER_SCALE - 1)) / 2 +
    NODE_GAP;

  return {
    key: cluster.key,
    kind: cluster.kind,
    hasConfirmed: pieces.some((p) => p.layer !== 'emerging'),
    pieces,
    radius,
    bodySize,
    x: 0,
    y: 0,
  };
}

function clampAssembly(assembly, width, height) {
  assembly.x = Math.min(
    width - assembly.radius,
    Math.max(assembly.radius, assembly.x)
  );
  assembly.y = Math.min(
    height - assembly.radius,
    Math.max(assembly.radius, assembly.y)
  );
}

function minSeparation(a, b) {
  return a.radius + b.radius + ASSEMBLY_GAP;
}

function assembliesOverlap(assemblies) {
  for (let i = 0; i < assemblies.length; i += 1) {
    for (let j = i + 1; j < assemblies.length; j += 1) {
      const a = assemblies[i];
      const b = assemblies[j];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist < minSeparation(a, b) - 0.5) return true;
    }
  }
  return false;
}

/**
 * Push overlapping assemblies apart. Non-overlap beats centering:
 * no pull-to-center here. Soft edge repulsion keeps pieces on-screen.
 */
function separateAssemblies(assemblies, width, height, iterations = 120) {
  if (assemblies.length <= 1) {
    if (assemblies[0]) clampAssembly(assemblies[0], width, height);
    return;
  }

  for (let iter = 0; iter < iterations; iter += 1) {
    let moved = false;

    for (let i = 0; i < assemblies.length; i += 1) {
      for (let j = i + 1; j < assemblies.length; j += 1) {
        const a = assemblies[i];
        const b = assemblies[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const need = minSeparation(a, b);
        if (dist < 1e-4) {
          const angle = (i * 2.399963229728653 + iter * 0.37) % (Math.PI * 2);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1e-4;
        }
        if (dist >= need) continue;
        const push = (need - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }

    // Soft keep-inside forces (avoid hard clamp thrash that re-creates overlaps).
    for (const assembly of assemblies) {
      const minX = assembly.radius;
      const maxX = width - assembly.radius;
      const minY = assembly.radius;
      const maxY = height - assembly.radius;
      if (assembly.x < minX) {
        assembly.x += (minX - assembly.x) * 0.55;
        moved = true;
      } else if (assembly.x > maxX) {
        assembly.x -= (assembly.x - maxX) * 0.55;
        moved = true;
      }
      if (assembly.y < minY) {
        assembly.y += (minY - assembly.y) * 0.55;
        moved = true;
      } else if (assembly.y > maxY) {
        assembly.y -= (assembly.y - maxY) * 0.55;
        moved = true;
      }
    }

    if (!moved && iter > 12) break;
  }

  for (const assembly of assemblies) {
    clampAssembly(assembly, width, height);
  }
}

/**
 * Translate the whole layout so its centroid sits near the preferred
 * screen focus (slightly above geometric center), without changing
 * relative spacing (preserves non-overlap).
 */
function recenterGroup(assemblies, width, height) {
  if (!assemblies.length) return;
  const cx = width / 2;
  const cy = height * VERTICAL_CENTER_RATIO;
  const gx =
    assemblies.reduce((sum, a) => sum + a.x, 0) / assemblies.length;
  const gy =
    assemblies.reduce((sum, a) => sum + a.y, 0) / assemblies.length;
  const dx = cx - gx;
  const dy = cy - gy;
  for (const assembly of assemblies) {
    assembly.x += dx;
    assembly.y += dy;
  }
  for (const assembly of assemblies) {
    clampAssembly(assembly, width, height);
  }
}

/**
 * Ring radius large enough that assemblies can sit without overlapping
 * when spaced evenly around an ellipse.
 */
function requiredRingRadius(assemblies) {
  if (!assemblies.length) return 0;
  if (assemblies.length === 1) return 0;
  const sumDiam = assemblies.reduce(
    (sum, a) => sum + 2 * a.radius + ASSEMBLY_GAP,
    0
  );
  return sumDiam / (2 * Math.PI);
}

function seedOnEllipse(assemblies, cx, cy, rx, ry, angleOffset = -Math.PI / 2) {
  const count = assemblies.length;
  if (!count) return;
  if (count === 1) {
    assemblies[0].x = cx;
    assemblies[0].y = cy;
    return;
  }

  assemblies.forEach((assembly, index) => {
    const angle = angleOffset + (index / count) * Math.PI * 2;
      // Slight radius jitter by size so large clusters sit a bit farther out.
    const boost = Math.min(0.1, assembly.radius / 500);
    const rScale = 1 + boost;
    assembly.x = cx + Math.cos(angle) * rx * rScale;
    assembly.y = cy + Math.sin(angle) * ry * rScale;
  });
}

/**
 * Distribute assemblies across the screen. Confirmed themes start on an
 * inner band, emerging on an outer band — then separation enforces no overlap.
 */
function placeAssemblies(assemblies, width, height) {
  const cx = width / 2;
  const cy = height * VERTICAL_CENTER_RATIO;
  if (!assemblies.length) return;

  const confirmed = assemblies.filter((a) => a.hasConfirmed);
  const emerging = assemblies.filter((a) => !a.hasConfirmed);

  const maxRx = width * MAX_SPREAD_X;
  const maxRy = height * MAX_SPREAD_Y;

  if (!confirmed.length || !emerging.length) {
    const group = confirmed.length ? confirmed : emerging;
    const need = requiredRingRadius(group);
    const rx = Math.min(maxRx, Math.max(need * 0.85, maxRx * 0.22));
    const ry = Math.min(maxRy, Math.max(need * 0.85 * (height / Math.max(width, 1)), maxRy * 0.2));
    seedOnEllipse(group, cx, cy, rx, ry);
    separateAssemblies(group, width, height, 160);
    recenterGroup(group, width, height);
    separateAssemblies(group, width, height, 80);
    return;
  }

  const innerNeed = requiredRingRadius(confirmed);
  const outerNeed = requiredRingRadius(emerging);

  // Inner band for confirmed — keep compact while allowing separation.
  let innerRx = Math.min(maxRx * 0.48, Math.max(innerNeed * 0.82, maxRx * 0.14));
  let innerRy = Math.min(maxRy * 0.48, Math.max(innerNeed * 0.78, maxRy * 0.12));

  // Outer band just beyond confirmed.
  let outerRx = Math.min(
    maxRx,
    Math.max(outerNeed * 0.82, innerRx + BASE_NODE_SIZE * 0.28, maxRx * 0.4)
  );
  let outerRy = Math.min(
    maxRy,
    Math.max(outerNeed * 0.78, innerRy + BASE_NODE_SIZE * 0.28, maxRy * 0.4)
  );

  // If outer can't clear inner, widen both modestly toward spread limits.
  if (outerRx < innerRx + 24) {
    innerRx = Math.min(innerRx, maxRx * 0.36);
    outerRx = maxRx;
  }
  if (outerRy < innerRy + 24) {
    innerRy = Math.min(innerRy, maxRy * 0.36);
    outerRy = maxRy;
  }

  seedOnEllipse(confirmed, cx, cy, innerRx, innerRy, -Math.PI / 2);
  seedOnEllipse(emerging, cx, cy, outerRx, outerRy, -Math.PI / 2 + Math.PI / emerging.length);

  // Separate everything together — non-overlap wins.
  separateAssemblies(assemblies, width, height, 180);
  recenterGroup(assemblies, width, height);
  separateAssemblies(assemblies, width, height, 100);

  // If still overlapping after clamp, expand seed radii and try once more.
  if (assembliesOverlap(assemblies)) {
    seedOnEllipse(confirmed, cx, cy, Math.min(maxRx, innerRx * 1.25), Math.min(maxRy, innerRy * 1.25));
    seedOnEllipse(
      emerging,
      cx,
      cy,
      maxRx,
      maxRy,
      -Math.PI / 2 + 0.4
    );
    separateAssemblies(assemblies, width, height, 220);
    recenterGroup(assemblies, width, height);
    separateAssemblies(assemblies, width, height, 120);
  }
}

function writeAssemblyPositions(positions, assemblies, width, height) {
  for (const assembly of assemblies) {
    for (const piece of assembly.pieces) {
      const x = assembly.x + piece.localX;
      const y = assembly.y + piece.localY;
      const isEmerging = piece.layer === 'emerging';
      positions.set(piece.id, {
        leftPct: (x / width) * 100,
        topPct: (y / height) * 100,
        radius: (piece.bodySize * PUZZLE_OUTER_SCALE) / 2,
        baseSize: piece.baseSize,
        bodySize: piece.bodySize,
        edges: piece.edges,
        layer: piece.layer,
        zIndex: isEmerging ? 1 : 3,
      });
    }
  }
}

/**
 * Place relatedness/category clusters with non-overlap first, then a balanced
 * screen distribution. Confirmed themes prefer the middle band.
 */
export function layoutIdentityBubbles(nodes, width, height, connections = []) {
  const positions = new Map();
  if (!nodes?.length || width <= 0 || height <= 0) return positions;

  let bodySize = fitBaseSize(nodes, width, height);
  const clusters = groupNodesForLayout(nodes, connections);

  const buildAll = (size) =>
    clusters.map((cluster) => buildClusterAssembly(cluster, size));

  let assemblies = buildAll(bodySize);
  placeAssemblies(assemblies, width, height);

  // Last resort: shrink pieces slightly if assemblies still collide.
  if (assembliesOverlap(assemblies) && bodySize > 64) {
    bodySize = Math.max(64, bodySize * 0.88);
    assemblies = buildAll(bodySize);
    placeAssemblies(assemblies, width, height);
  }

  writeAssemblyPositions(positions, assemblies, width, height);
  return positions;
}

export { BASE_NODE_SIZE, NODE_GAP, nodeVisualRadius };
