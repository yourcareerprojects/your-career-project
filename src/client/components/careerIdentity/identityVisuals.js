/**
 * Visual tokens for identity categories — clearer, more distinct hues
 * so thematic clusters read at a glance.
 */
const CATEGORY_COLORS = {
  values: '#3D7AD9',
  interests: '#2F9E6B',
  strengths: '#7B5CC8',
  work_style: '#C47A3A',
  thinking_style: '#1F9AA8',
  motivation: '#D4566A',
  environment: '#5A9E3D',
  communication: '#4A6FD4',
  leadership: '#C48A1A',
  problem_solving: '#3A7BA8',
  learning: '#8B5FBF',
  social_orientation: '#9A5FA0',
};

function hexToRgb(hex) {
  const raw = String(hex || '').replace('#', '');
  if (raw.length !== 6) return { r: 90, g: 122, b: 152 };
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

/** Mix toward gray so emerging outlines read softer than confirmed ones. */
function muteHex(hex, amount = 0.42) {
  const { r, g, b } = hexToRgb(hex);
  const t = Math.max(0, Math.min(1, amount));
  const gray = 168;
  const mix = (channel) => Math.round(channel + (gray - channel) * t);
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

export function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#5A7A98';
}

/** Softer, less saturated stroke for emerging puzzle pieces. */
export function getEmergingCategoryColor(category) {
  return muteHex(getCategoryColor(category), 0.28);
}

export function confidenceLabel(percent, t) {
  if (percent >= 70) return t('careerIdentity.confidence.strong');
  if (percent >= 40) return t('careerIdentity.confidence.emerging');
  return t('careerIdentity.confidence.early');
}
