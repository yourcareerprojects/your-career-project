const { MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH } = require('../../constants/savedCareerStepLimits');

/** Primary text from embedded { en, de? } or legacy plain string (prefers en, else de for validation/dupe checks). */
function embeddedOrLegacyEn(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && !Array.isArray(field)) {
    if (field.en != null && String(field.en).trim() !== '') return String(field.en);
    if (field.de != null && String(field.de).trim() !== '') return String(field.de);
  }
  return '';
}

/**
 * Duplicate Detection Utility for Career Steps
 * 
 * This utility provides multi-level duplicate detection for career steps
 * to prevent users from saving the same career step multiple times.
 */

/**
 * Calculates string similarity using Levenshtein distance
 * 
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score between 0 and 1
 */
const calculateSimilarity = (str1, str2) => {
  if (!str1 || !str2) return 0;
  
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
};

/**
 * Calculates Levenshtein distance between two strings
 * 
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Levenshtein distance
 */
const levenshteinDistance = (str1, str2) => {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
};

/**
 * Normalizes text for comparison
 * 
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
const normalizeText = (text) => {
  if (!text) return '';
  
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .replace(/[^\w\s]/g, '')        // Remove punctuation
    .trim();
};

/**
 * Checks if a stepId is a legacy format (contains timestamps or random strings)
 * 
 * @param {string} stepId - The stepId to check
 * @returns {boolean} True if it's a legacy stepId
 */
const isLegacyStepId = (stepId) => {
  if (!stepId || typeof stepId !== 'string') {
    return false;
  }
  
  // Legacy stepIds often contain timestamps or random strings
  const legacyPatterns = [
    /^\d+$/,                    // Pure timestamp
    /^[a-z-]+-\d+$/,           // title-timestamp
    /^[a-z-]+-\d+-[a-z0-9]+$/, // title-timestamp-random
    /^[a-z-]+-\d+-[a-z0-9]+-[a-z0-9]+$/ // title-timestamp-random-random
  ];
  
  return legacyPatterns.some(pattern => pattern.test(stepId));
};

/**
 * Checks for exact duplicate (Level 1)
 * 
 * @param {object} newStep - New career step to check
 * @param {object} existingStep - Existing career step to compare
 * @returns {boolean} True if exact duplicate
 */
const isExactDuplicate = (newStep, existingStep) => {
  if (newStep.savedKey && existingStep.savedKey && newStep.savedKey === existingStep.savedKey) {
    return true;
  }
  return newStep.stepId === existingStep.stepId;
};

/**
 * Checks for content-based duplicate (Level 2)
 * 
 * @param {object} newStep - New career step to check
 * @param {object} existingStep - Existing career step to compare
 * @returns {boolean} True if content duplicate
 */
const isContentDuplicate = (newStep, existingStep) => {
  const newTitle = normalizeText(embeddedOrLegacyEn(newStep.title));
  const existingTitle = normalizeText(embeddedOrLegacyEn(existingStep.title));
  const newDescription = normalizeText(embeddedOrLegacyEn(newStep.description));
  const existingDescription = normalizeText(embeddedOrLegacyEn(existingStep.description));
  
  // Exact title match (most important check)
  if (newTitle === existingTitle) {
    // If titles match exactly, check if descriptions are similar or both empty
    const descriptionMatch = newDescription === existingDescription || 
                           (!newDescription && !existingDescription);
    
    if (descriptionMatch) {
      return true;
    }
    
    // Even if descriptions differ, if titles are exactly the same, 
    // it's likely the same career step
    return true;
  }
  
  // Same title and simulation result ID
  if (newTitle === existingTitle && 
      newStep.simulationResultId === existingStep.simulationResultId &&
      newStep.simulationResultId) {
    return true;
  }
  
  // Additional check: if both have legacy stepIds with same title, consider duplicate
  if (newTitle === existingTitle && 
      isLegacyStepId(newStep.stepId) && 
      isLegacyStepId(existingStep.stepId)) {
    return true;
  }
  
  // Check: if one has legacy stepId and titles match exactly, consider duplicate
  if (newTitle === existingTitle && 
      (isLegacyStepId(newStep.stepId) || isLegacyStepId(existingStep.stepId))) {
    return true;
  }
  
  return false;
};

/**
 * Checks for semantic duplicate (Level 3)
 * 
 * @param {object} newStep - New career step to check
 * @param {object} existingStep - Existing career step to compare
 * @param {number} threshold - Similarity threshold (default 0.8)
 * @returns {boolean} True if semantic duplicate
 */
const isSemanticDuplicate = (newStep, existingStep, threshold = 0.8) => {
  const newTitle = normalizeText(embeddedOrLegacyEn(newStep.title));
  const existingTitle = normalizeText(embeddedOrLegacyEn(existingStep.title));
  const newDescription = normalizeText(embeddedOrLegacyEn(newStep.description));
  const existingDescription = normalizeText(embeddedOrLegacyEn(existingStep.description));
  
  // Check title similarity
  const titleSimilarity = calculateSimilarity(newTitle, existingTitle);
  
  // Check description similarity (if both have descriptions)
  let descriptionSimilarity = 1.0;
  if (newDescription && existingDescription) {
    descriptionSimilarity = calculateSimilarity(newDescription, existingDescription);
  }
  
  // Consider it a semantic duplicate if:
  // 1. Titles are very similar (above threshold)
  // 2. Descriptions are similar (above threshold) OR one is empty
  // 3. Same simulation context (if available)
  const titleMatch = titleSimilarity >= threshold;
  const descriptionMatch = descriptionSimilarity >= threshold || 
                          !newDescription || !existingDescription;
  const contextMatch = !newStep.simulationResultId || 
                      !existingStep.simulationResultId ||
                      newStep.simulationResultId === existingStep.simulationResultId;
  
  return titleMatch && descriptionMatch && contextMatch;
};

/**
 * Detects duplicates using multi-level checking
 * 
 * @param {object} newStep - New career step to check
 * @param {array} existingSteps - Array of existing career steps
 * @returns {object} Duplicate detection result
 */
const detectDuplicates = (newStep, existingSteps) => {
  if (!newStep || !existingSteps || !Array.isArray(existingSteps)) {
    return {
      hasDuplicate: false,
      duplicateType: null,
      existingStep: null,
      similarity: 0
    };
  }
  
  for (const existingStep of existingSteps) {
    // Level 1: Exact duplicate
    if (isExactDuplicate(newStep, existingStep)) {
      return {
        hasDuplicate: true,
        duplicateType: 'exact',
        existingStep,
        similarity: 1.0
      };
    }
    
    // Level 2: Content duplicate
    if (isContentDuplicate(newStep, existingStep)) {
      return {
        hasDuplicate: true,
        duplicateType: 'content',
        existingStep,
        similarity: 1.0
      };
    }
    
    // Level 3: Semantic duplicate
    if (isSemanticDuplicate(newStep, existingStep)) {
      const titleSimilarity = calculateSimilarity(
        normalizeText(embeddedOrLegacyEn(newStep.title)),
        normalizeText(embeddedOrLegacyEn(existingStep.title))
      );
      
      return {
        hasDuplicate: true,
        duplicateType: 'semantic',
        existingStep,
        similarity: titleSimilarity
      };
    }
  }
  
  return {
    hasDuplicate: false,
    duplicateType: null,
    existingStep: null,
    similarity: 0
  };
};

/**
 * Generates user-friendly message for duplicate detection
 * 
 * @param {object} duplicateResult - Result from detectDuplicates
 * @returns {string} User-friendly message
 */
const getDuplicateMessage = (duplicateResult) => {
  if (!duplicateResult.hasDuplicate) {
    return null;
  }
  
  const { duplicateType, similarity } = duplicateResult;
  
  switch (duplicateType) {
    case 'exact':
      return 'This career step is already saved';
    
    case 'content':
      return 'This career step is already saved with the same content';
    
    case 'semantic': {
      const similarityPercent = Math.round(similarity * 100);
      return `A similar career step is already saved (${similarityPercent}% similar). Would you like to update it?`;
    }
    
    default:
      return 'A similar career step may already be saved';
  }
};

/**
 * Validates career step data
 * 
 * @param {object} stepData - Career step data to validate
 * @returns {object} Validation result
 */
const validateStepData = (stepData) => {
  const errors = [];
  
  if (!stepData.stepId) {
    errors.push('Step ID is required');
  }
  
  const titleEn = embeddedOrLegacyEn(stepData.title);
  if (!titleEn || !String(titleEn).trim()) {
    errors.push('Title is required');
  }
  
  if (titleEn && String(titleEn).length > 200) {
    errors.push('Title must be less than 200 characters');
  }
  
  const descEn = embeddedOrLegacyEn(stepData.description);
  if (descEn && String(descEn).length > MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH) {
    errors.push(
      `Description must not exceed ${MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH} characters`
    );
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

module.exports = {
  detectDuplicates,
  getDuplicateMessage,
  validateStepData,
  calculateSimilarity,
  isExactDuplicate,
  isContentDuplicate,
  isSemanticDuplicate,
  isLegacyStepId
};
