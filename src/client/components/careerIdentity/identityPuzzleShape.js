/**
 * Deterministic jigsaw silhouettes for identity traits.
 * Edge values: 1 = outward knob, -1 = inward socket, 0 = flat.
 */

const BODY = 100;
/** Knob depth — between pointed and fully circular. */
const TAB = 19;
/** Half-width of the neck where the knob meets the edge. */
const NECK = 8;
const VIEW_PAD = TAB + 5;
export const PUZZLE_VIEWBOX = `${-VIEW_PAD} ${-VIEW_PAD} ${BODY + VIEW_PAD * 2} ${BODY + VIEW_PAD * 2}`;
/** Must match viewBox padding so body centers sit exactly `bodySize` apart when joined. */
export const PUZZLE_OUTER_SCALE = (BODY + VIEW_PAD * 2) / BODY;

export function hashString(value) {
  let h = 2166136261;
  const s = String(value || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function freeEdge(seed, side) {
  const h = hashString(`${seed}:${side}`);
  // Occasional flat outer edge (three-knob pieces).
  if (h % 10 < 2) return 0;
  return (h & 1) === 1 ? 1 : -1;
}

function sharedPolarity(category, row, col, axis) {
  const h = hashString(`${category}|${row}|${col}|${axis}`);
  return (h & 1) === 1 ? 1 : -1;
}

/**
 * Compact grid dims for interlocking a category group.
 */
export function interlockingGridDims(count) {
  const n = Math.max(1, count);
  if (n === 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n === 3) return { cols: 2, rows: 2 };
  if (n === 4) return { cols: 2, rows: 2 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

/**
 * Assign complementary edges so neighboring grid pieces interlock.
 * @param {Array<{ id: string, col: number, row: number }>} cells
 * @param {string} category
 */
export function assignInterlockingEdges(cells, category) {
  const byKey = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));
  const edgesById = new Map();

  for (const cell of cells) {
    const { id, row, col } = cell;
    const right = byKey.get(`${row}:${col + 1}`);
    const below = byKey.get(`${row + 1}:${col}`);
    const left = byKey.get(`${row}:${col - 1}`);
    const above = byKey.get(`${row - 1}:${col}`);

    const edges = {
      top: above
        ? -sharedPolarity(category, row - 1, col, 'v')
        : freeEdge(id, 'top'),
      right: right
        ? sharedPolarity(category, row, col, 'h')
        : freeEdge(id, 'right'),
      bottom: below
        ? sharedPolarity(category, row, col, 'v')
        : freeEdge(id, 'bottom'),
      left: left
        ? -sharedPolarity(category, row, col - 1, 'h')
        : freeEdge(id, 'left'),
    };

    edgesById.set(id, edges);
  }

  return edgesById;
}

/**
 * Fallback silhouette when a piece is not part of a computed assembly.
 */
export function getPuzzleEdgesForTrait(traitId) {
  const h = hashString(traitId);
  const pick = (shift) => (((h >>> shift) & 1) === 1 ? 1 : -1);
  const edges = {
    top: pick(0),
    right: pick(3),
    bottom: pick(6),
    left: pick(9),
  };

  if (h % 10 < 3) {
    const side = ['top', 'right', 'bottom', 'left'][h % 4];
    edges[side] = 0;
  }

  return edges;
}

/**
 * Moderately rounded jigsaw knob — softer than pointed, less bulbous than a full circle.
 */
function appendHorizontalEdge(parts, y, fromX, toX, type, outwardSign) {
  const dir = toX >= fromX ? 1 : -1;
  const mid = (fromX + toX) / 2;

  if (type === 0) {
    parts.push(`L ${toX} ${y}`);
    return;
  }

  const bump = outwardSign * type * TAB;
  const tip = y + bump;
  const waist = y + bump * 0.58;

  parts.push(`L ${mid - dir * NECK} ${y}`);
  parts.push(
    `C ${mid - dir * NECK} ${y}, ${mid - dir * TAB * 0.85} ${y + bump * 0.12}, ${mid - dir * TAB * 0.78} ${waist}`
  );
  parts.push(
    `C ${mid - dir * TAB * 0.72} ${y + bump * 0.88}, ${mid - dir * TAB * 0.42} ${tip}, ${mid} ${tip}`
  );
  parts.push(
    `C ${mid + dir * TAB * 0.42} ${tip}, ${mid + dir * TAB * 0.72} ${y + bump * 0.88}, ${mid + dir * TAB * 0.78} ${waist}`
  );
  parts.push(
    `C ${mid + dir * TAB * 0.85} ${y + bump * 0.12}, ${mid + dir * NECK} ${y}, ${mid + dir * NECK} ${y}`
  );
  parts.push(`L ${toX} ${y}`);
}

function appendVerticalEdge(parts, x, fromY, toY, type, outwardSign) {
  const dir = toY >= fromY ? 1 : -1;
  const mid = (fromY + toY) / 2;

  if (type === 0) {
    parts.push(`L ${x} ${toY}`);
    return;
  }

  const bump = outwardSign * type * TAB;
  const tip = x + bump;
  const waist = x + bump * 0.58;

  parts.push(`L ${x} ${mid - dir * NECK}`);
  parts.push(
    `C ${x} ${mid - dir * NECK}, ${x + bump * 0.12} ${mid - dir * TAB * 0.85}, ${waist} ${mid - dir * TAB * 0.78}`
  );
  parts.push(
    `C ${x + bump * 0.88} ${mid - dir * TAB * 0.72}, ${tip} ${mid - dir * TAB * 0.42}, ${tip} ${mid}`
  );
  parts.push(
    `C ${tip} ${mid + dir * TAB * 0.42}, ${x + bump * 0.88} ${mid + dir * TAB * 0.72}, ${waist} ${mid + dir * TAB * 0.78}`
  );
  parts.push(
    `C ${x + bump * 0.12} ${mid + dir * TAB * 0.85}, ${x} ${mid + dir * NECK}, ${x} ${mid + dir * NECK}`
  );
  parts.push(`L ${x} ${toY}`);
}

/**
 * SVG path for a single puzzle piece in a 100×100 body coordinate system.
 */
export function buildPuzzlePiecePath(edges) {
  const top = edges?.top ?? 1;
  const right = edges?.right ?? -1;
  const bottom = edges?.bottom ?? 1;
  const left = edges?.left ?? -1;

  const parts = [`M 0 0`];
  appendHorizontalEdge(parts, 0, 0, BODY, top, -1);
  appendVerticalEdge(parts, BODY, 0, BODY, right, 1);
  appendHorizontalEdge(parts, BODY, BODY, 0, bottom, 1);
  appendVerticalEdge(parts, 0, BODY, 0, left, -1);
  parts.push('Z');
  return parts.join(' ');
}

export { BODY, TAB };
