/**
 * Exploration presentation strategy
 * =================================
 *
 * Separates *what happened* (computation) from *how much to surface* (presentation).
 *
 * - Computation: always runs when identity meaningfully changes (changeScore ≥ floor).
 * - Presentation: banded job counts, UI prominence, notification intensity.
 *
 * Fatigue signals adjust presentation — they no longer block exploration.
 */

const {
  EXPLORATION_MEANINGFUL_CHANGE_SCORE,
  EXPLORATION_PRESENTATION_BANDS,
  EXPLORATION_PRESENTATION_FATIGUE,
} = require('../../../constants/explorationPresentationConfig');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value, precision = 1) {
  const factor = 10 ** Math.max(0, precision);
  return Math.round(Number(value) * factor) / factor;
}

/**
 * @param {number} changeScore
 * @param {object} [config]
 * @returns {object|null}
 */
function resolvePresentationBand(changeScore, config = {}) {
  const bands = Array.isArray(config.bands) ? config.bands : EXPLORATION_PRESENTATION_BANDS;
  const score = Number(changeScore) || 0;

  for (const band of bands) {
    if (score >= band.minChangeScore) {
      return band;
    }
  }

  return null;
}

/**
 * Apply fatigue-based presentation dampening (never blocks exploration).
 * @param {object} band
 * @param {object} signals
 * @param {object} [config]
 */
function applyFatigueToPresentation(band, signals, config = {}) {
  const fatigue = { ...EXPLORATION_PRESENTATION_FATIGUE, ...(config.fatigue || {}) };
  let minJobs = band.minJobs;
  let maxJobs = band.maxJobs;
  // Continuous loop: always surface a toast when roles are delivered.
  // Fatigue only reduces volume / prominence — never hides discovery.
  const notify = true;
  let prominence = band.prominence;
  let intensity = band.intensity;

  const recentHours = signals.hoursSinceLastExploration;
  const recentSessions = Number(signals.recentExplorationSessions) || 0;
  const recentJobs = Number(signals.recentExplorationJobs) || 0;

  if (
    recentHours != null
    && recentHours <= fatigue.RECENT_HOURS
  ) {
    maxJobs = Math.max(minJobs, maxJobs - fatigue.RECENT_JOB_REDUCTION);
    intensity *= fatigue.RECENT_INTENSITY_MULTIPLIER;
  }

  if (
    recentSessions >= fatigue.SESSION_SOFT_CAP
    && band.minChangeScore < fatigue.REDUCE_SIZE_BELOW_BAND_SCORE
  ) {
    maxJobs = Math.max(minJobs, maxJobs - 1);
    intensity *= fatigue.SESSION_INTENSITY_MULTIPLIER;
  }

  if (recentJobs >= fatigue.JOBS_SOFT_CAP && band.minChangeScore < 20) {
    maxJobs = Math.max(minJobs, Math.min(maxJobs, 2));
  }

  if (prominence === 'full' && intensity < 0.9) {
    prominence = 'featured';
  } else if (prominence === 'featured' && intensity < 0.75) {
    prominence = 'standard';
  } else if (prominence === 'standard' && intensity < 0.55) {
    prominence = 'subtle';
  }

  return {
    tier: band.id,
    minJobs,
    maxJobs,
    targetJobCount: maxJobs,
    notify,
    prominence,
    intensity: roundTo(intensity, 2),
    bandMinChangeScore: band.minChangeScore,
  };
}

/**
 * @param {number} changeScore
 * @param {object} signals
 * @param {{ reasons?: string[], config?: object, language?: string }} [options]
 */
function resolveExplorationPresentation(changeScore, signals, options = {}) {
  const score = Number(changeScore) || 0;
  const meaningfulFloor =
    options.config?.meaningfulChangeScore ?? EXPLORATION_MEANINGFUL_CHANGE_SCORE;
  const band = resolvePresentationBand(score, options.config);

  if (!band || score < meaningfulFloor) {
    const language = options.language === 'de' ? 'de' : 'en';
    return {
      shouldExplore: false,
      shouldCompute: false,
      shouldNotify: false,
      tier: 'none',
      minJobs: 0,
      maxJobs: 0,
      targetJobCount: 0,
      notify: false,
      prominence: 'none',
      intensity: 0,
      reason:
        language === 'de'
          ? `Änderungsscore ${roundTo(score)} liegt unter der Schwelle für eine Exploration (${meaningfulFloor}).`
          : `Change score ${roundTo(score)} is below the meaningful exploration floor (${meaningfulFloor}).`,
      adjustments: {
        meaningfulChangeFloor: meaningfulFloor,
        matchedBand: null,
      },
    };
  }

  const presentation = applyFatigueToPresentation(band, signals, options.config);
  const language = options.language === 'de' ? 'de' : 'en';

  const reason =
    language === 'de'
      ? `Änderungsscore ${roundTo(score)} → ${presentation.tier} (${presentation.minJobs}–${presentation.maxJobs} Berufe, ${presentation.prominence}).`
      : `Change score ${roundTo(score)} → ${presentation.tier} (${presentation.minJobs}–${presentation.maxJobs} careers, ${presentation.prominence} prominence).`;

  return {
    shouldExplore: true,
    shouldCompute: true,
    shouldNotify: presentation.notify,
    ...presentation,
    reason,
    adjustments: {
      meaningfulChangeFloor: meaningfulFloor,
      matchedBand: band.id,
      fatigueSignals: {
        recentExplorationSessions: signals.recentExplorationSessions,
        recentExplorationJobs: signals.recentExplorationJobs,
        hoursSinceLastExploration: signals.hoursSinceLastExploration,
      },
    },
  };
}

module.exports = {
  resolvePresentationBand,
  resolveExplorationPresentation,
  applyFatigueToPresentation,
};
