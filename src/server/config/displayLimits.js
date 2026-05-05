// Career Step Display Limits Configuration
// This file contains configuration constants for per-category career step display limits

const DISPLAY_LIMITS = {
  // Per-category display limits
  NEXT_STEPS_LIMIT: 10,
  OUTSIDE_THE_BOX_LIMIT: 10,
  
  // Initial display counts per category
  INITIAL_NEXT_STEPS: 3,
  INITIAL_OUTSIDE_THE_BOX: 3,
  
  // Warning thresholds (show warning when approaching limit)
  WARNING_THRESHOLD: 8, // Show warning when 8+ steps displayed
  
  // Total maximum exploration possible
  TOTAL_MAXIMUM: 20 // 10 per category
};

// Environment variable overrides (optional)
const getDisplayLimits = () => {
  return {
    nextSteps: process.env.NEXT_STEPS_DISPLAY_LIMIT || DISPLAY_LIMITS.NEXT_STEPS_LIMIT,
    outsideTheBox: process.env.OUTSIDE_THE_BOX_DISPLAY_LIMIT || DISPLAY_LIMITS.OUTSIDE_THE_BOX_LIMIT,
    initialNextSteps: DISPLAY_LIMITS.INITIAL_NEXT_STEPS,
    initialOutsideTheBox: DISPLAY_LIMITS.INITIAL_OUTSIDE_THE_BOX,
    warningThreshold: DISPLAY_LIMITS.WARNING_THRESHOLD,
    totalMaximum: DISPLAY_LIMITS.TOTAL_MAXIMUM
  };
};

module.exports = {
  DISPLAY_LIMITS,
  getDisplayLimits
};
