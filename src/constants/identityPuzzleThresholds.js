/**
 * Tunable thresholds and display limits for Career Identity Puzzle pieces.
 *
 * confidence >= confirmed → established identity piece
 * emerging <= confidence < confirmed → developing possibility
 * confidence < emerging → not shown as a puzzle piece
 *
 * Display caps keep the puzzle readable:
 * - at most maxPerLayer confirmed and maxPerLayer emerging
 * - at most maxTotal overall (lowest confidence dropped first)
 */

const IDENTITY_PUZZLE_THRESHOLDS = {
  confirmed: 0.6,
  emerging: 0.3,
};

const IDENTITY_PUZZLE_LIMITS = {
  maxPerLayer: 15,
  maxTotal: 25,
};

const IDENTITY_LAYERS = Object.freeze({
  CONFIRMED: 'confirmed',
  EMERGING: 'emerging',
});

/** User-facing status copy — never expose raw confidence numbers. */
const IDENTITY_LAYER_STATUS_MESSAGES = Object.freeze({
  confirmed: {
    en: 'This is a clear part of your career identity.',
    de: 'Das ist ein klarer Teil deiner beruflichen Identität.',
  },
  emerging: {
    en: 'This trait is starting to appear based on your activities.',
    de: 'Dieses Merkmal beginnt sich anhand deiner Aktivitäten abzuzeichnen.',
  },
});

/**
 * Classify a trait confidence into a puzzle layer, or null when excluded.
 * @param {number} confidence
 * @returns {'confirmed'|'emerging'|null}
 */
function classifyIdentityLayer(confidence) {
  const value = Number(confidence) || 0;
  if (value >= IDENTITY_PUZZLE_THRESHOLDS.confirmed) return IDENTITY_LAYERS.CONFIRMED;
  if (value >= IDENTITY_PUZZLE_THRESHOLDS.emerging) return IDENTITY_LAYERS.EMERGING;
  return null;
}

/**
 * @param {'confirmed'|'emerging'} layer
 * @returns {{ en: string, de: string }|null}
 */
function getLayerStatusMessage(layer) {
  return IDENTITY_LAYER_STATUS_MESSAGES[layer] || null;
}

function confidenceDesc(a, b) {
  const confDiff = (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
  if (confDiff !== 0) return confDiff;
  // Prefer confirmed when confidence ties.
  const aConfirmed = a.layer === IDENTITY_LAYERS.CONFIRMED ? 0 : 1;
  const bConfirmed = b.layer === IDENTITY_LAYERS.CONFIRMED ? 0 : 1;
  return aConfirmed - bConfirmed;
}

/**
 * Cap puzzle traits per layer and overall so the graph stays readable.
 * @param {Array<{ confidence?: number, layer?: string }>} traits
 * @returns {Array}
 */
function selectPuzzleTraits(traits) {
  const list = Array.isArray(traits) ? traits : [];
  const { maxPerLayer, maxTotal } = IDENTITY_PUZZLE_LIMITS;

  const confirmed = list
    .filter((t) => t.layer === IDENTITY_LAYERS.CONFIRMED)
    .sort(confidenceDesc)
    .slice(0, maxPerLayer);
  const emerging = list
    .filter((t) => t.layer === IDENTITY_LAYERS.EMERGING)
    .sort(confidenceDesc)
    .slice(0, maxPerLayer);

  let selected = [...confirmed, ...emerging];
  if (selected.length > maxTotal) {
    selected = selected.sort(confidenceDesc).slice(0, maxTotal);
  }

  return selected.sort((a, b) => {
    const layerDiff =
      (a.layer === IDENTITY_LAYERS.CONFIRMED ? 0 : 1) -
      (b.layer === IDENTITY_LAYERS.CONFIRMED ? 0 : 1);
    if (layerDiff !== 0) return layerDiff;
    return confidenceDesc(a, b);
  });
}

module.exports = {
  IDENTITY_PUZZLE_THRESHOLDS,
  IDENTITY_PUZZLE_LIMITS,
  IDENTITY_LAYERS,
  IDENTITY_LAYER_STATUS_MESSAGES,
  classifyIdentityLayer,
  getLayerStatusMessage,
  selectPuzzleTraits,
};
