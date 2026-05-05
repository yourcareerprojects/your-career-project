import { getRoleTitleEnglishForMatch } from './roleTitleDisplay';

/**
 * Career Step ID Generation Utility
 * 
 * This utility provides consistent stepId generation across all components
 * to prevent duplicate career step saves.
 */

/**
 * @param {unknown} title – string or embedded i18n object from API
 * @returns {string}
 */
function titleStringForStepId(title) {
  if (title == null || title === '') return '';
  if (typeof title === 'string' || typeof title === 'number') return String(title);
  return getRoleTitleEnglishForMatch(title);
}

/**
 * Generates a consistent stepId based on content rather than timestamps
 * Format: {title-slug}-{simulationId}-{category}-{index}
 * 
 * @param {string|object} title - The career step title
 * @param {string} simulationId - The simulation ID (or 'local' for local simulations)
 * @param {string} category - The category (nextSteps, outsideTheBox, etc.)
 * @param {number} index - The index within the category
 * @returns {string} Generated stepId
 */
export const generateStepId = (title, simulationId, category, index) => {
  const titleStr = titleStringForStepId(title);
  if (!titleStr) {
    throw new Error('Title is required for stepId generation');
  }
  
  // Create URL-safe slug from title
  const titleSlug = titleStr
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/[^a-zA-Z0-9-]/g, '')  // Remove special characters except hyphens
    .toLowerCase()
    .substring(0, 50);              // Limit length to prevent overly long IDs
  
  // Use 'local' for local simulations or when simulationId is not provided
  const simId = simulationId || 'local';
  
  // Ensure category is provided
  const cat = category || 'unknown';
  
  // Ensure index is a number
  const idx = typeof index === 'number' ? index : 0;
  
  return `${titleSlug}-${simId}-${cat}-${idx}`;
};

/**
 * Generates stepId for simulation result details
 * Used when saving from SimulationResultDetails page
 * 
 * @param {string} title - The career step title
 * @param {string} simulationId - The simulation ID
 * @param {string} resultId - The result ID (optional)
 * @returns {string} Generated stepId
 */
export const generateResultStepId = (title, simulationId, resultId) => {
  const titleStr = titleStringForStepId(title);
  if (!titleStr) {
    throw new Error('Title is required for stepId generation');
  }
  
  const titleSlug = titleStr
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase()
    .substring(0, 50);
  
  const simId = simulationId || 'local';
  const resId = resultId ? `-${resultId}` : '';
  
  return `${titleSlug}-${simId}-result${resId}`;
};

/**
 * Validates if a stepId follows the expected format
 * 
 * @param {string} stepId - The stepId to validate
 * @returns {boolean} True if valid format
 */
export const isValidStepId = (stepId) => {
  if (!stepId || typeof stepId !== 'string') {
    return false;
  }
  
  // Check if it follows the pattern: title-simulationId-category-index
  const pattern = /^[a-z0-9-]+-[a-z0-9-]+-[a-z0-9-]+-\d+$/;
  return pattern.test(stepId);
};

/**
 * Extracts components from a stepId
 * 
 * @param {string} stepId - The stepId to parse
 * @returns {object} Parsed components
 */
export const parseStepId = (stepId) => {
  if (!isValidStepId(stepId)) {
    return null;
  }
  
  const parts = stepId.split('-');
  if (parts.length < 4) {
    return null;
  }
  
  // Find the last three parts (simulationId, category, index)
  const index = parseInt(parts[parts.length - 1], 10);
  const category = parts[parts.length - 2];
  const simulationId = parts[parts.length - 3];
  const titleSlug = parts.slice(0, parts.length - 3).join('-');
  
  return {
    titleSlug,
    simulationId,
    category,
    index
  };
};

/**
 * Checks if two stepIds represent the same career step
 * 
 * @param {string} stepId1 - First stepId
 * @param {string} stepId2 - Second stepId
 * @returns {boolean} True if they represent the same step
 */
export const areSameStep = (stepId1, stepId2) => {
  if (!stepId1 || !stepId2) {
    return false;
  }
  
  // Exact match
  if (stepId1 === stepId2) {
    return true;
  }
  
  // Parse both stepIds
  const parsed1 = parseStepId(stepId1);
  const parsed2 = parseStepId(stepId2);
  
  if (!parsed1 || !parsed2) {
    return false;
  }
  
  // Same title, simulation, and category
  return parsed1.titleSlug === parsed2.titleSlug &&
         parsed1.simulationId === parsed2.simulationId &&
         parsed1.category === parsed2.category;
};

/**
 * Legacy stepId compatibility check
 * Checks if a stepId might be from the old system
 * 
 * @param {string} stepId - The stepId to check
 * @returns {boolean} True if it's a legacy stepId
 */
export const isLegacyStepId = (stepId) => {
  if (!stepId || typeof stepId !== 'string') {
    return false;
  }
  
  // Legacy stepIds often contain timestamps or random strings
  const legacyPatterns = [
    /^\d+$/,                    // Pure timestamp
    /^[a-z-]+-\d+$/,           // title-timestamp
    /^[a-z-]+-\d+-[a-z0-9]+$/  // title-timestamp-random
  ];
  
  return legacyPatterns.some(pattern => pattern.test(stepId));
};

export default {
  generateStepId,
  generateResultStepId,
  isValidStepId,
  parseStepId,
  areSameStep,
  isLegacyStepId
};
