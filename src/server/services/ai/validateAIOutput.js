function validateAIOutput(_task, output) {
  if (!output) return null;

  if (typeof output === 'string') {
    return output.trim();
  }

  if (Array.isArray(output)) {
    return output.filter(Boolean);
  }

  if (typeof output === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(output)) {
      if (v !== null && v !== undefined) {
        cleaned[k] = v;
      }
    }
    return cleaned;
  }

  return output;
}

module.exports = {
  validateAIOutput,
};
