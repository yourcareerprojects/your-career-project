/**
 * Evidence weight formulas — unchanged from the original per-source weighting logic.
 * Strength is the semantic match score mapped to 0–1 by traitDiscovery.
 */

function weightReflection(strength) {
  return Math.min(0.85, 0.45 + strength * 0.4);
}

function weightWhoAreYou(strength) {
  return Math.min(0.8, 0.4 + strength * 0.35);
}

function weightStructuredProfile(strength) {
  return Math.min(0.7, 0.3 + strength * 0.35);
}

function weightCv(strength) {
  return Math.min(0.75, 0.35 + strength * 0.35);
}

function weightSimulation(strength) {
  return Math.min(0.85, 0.4 + strength * 0.35);
}

module.exports = {
  weightReflection,
  weightWhoAreYou,
  weightStructuredProfile,
  weightCv,
  weightSimulation,
};
