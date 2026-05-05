/**
 * Minimal structured server logging (stdout/stderr JSON lines).
 * Do not pass secrets, tokens, full env, or raw request auth headers.
 */

function buildEntry(level, message, extra = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...extra,
  };
  return entry;
}

function info(message, meta) {
  const payload = buildEntry('info', message, meta && typeof meta === 'object' ? meta : {});
  console.log(JSON.stringify(payload));
}

/**
 * @param {string} message
 * @param {Error | Record<string, unknown> | undefined} errOrMeta
 */
function error(message, errOrMeta) {
  const extra = {};
  if (errOrMeta instanceof Error) {
    extra.errorName = errOrMeta.name;
    extra.stack = errOrMeta.stack;
  } else if (errOrMeta && typeof errOrMeta === 'object') {
    for (const [k, v] of Object.entries(errOrMeta)) {
      if (v instanceof Error) {
        extra.errorName = v.name;
        extra.stack = v.stack;
      } else {
        extra[k] = v;
      }
    }
  }
  const payload = buildEntry('error', message, extra);
  console.error(JSON.stringify(payload));
}

module.exports = {
  info,
  error,
};
