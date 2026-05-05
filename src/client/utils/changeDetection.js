/**
 * Deep comparison utility for detecting changes in form data
 * Handles nested objects, arrays, and primitive values
 */

/**
 * Performs deep comparison between two values to detect changes
 * @param {any} original - The original value
 * @param {any} current - The current value
 * @returns {boolean} - True if values are different, false if they are the same
 */
export const hasChanges = (original, current) => {
  // Handle null/undefined cases
  if (!original && !current) return false;
  if (!original || !current) return true;

  // Handle arrays
  if (Array.isArray(original) && Array.isArray(current)) {
    if (original.length !== current.length) return true;
    return original.some((item, index) => hasChanges(item, current[index]));
  }

  // Handle objects
  if (typeof original === 'object' && typeof current === 'object') {
    const originalKeys = Object.keys(original);
    const currentKeys = Object.keys(current);

    // Check if key sets are different
    if (originalKeys.length !== currentKeys.length) return true;

    // Check if all keys exist in both objects
    const allKeys = new Set([...originalKeys, ...currentKeys]);
    for (const key of allKeys) {
      if (hasChanges(original[key], current[key])) return true;
    }
    return false;
  }

  // Handle primitives (string, number, boolean)
  return original !== current;
};
