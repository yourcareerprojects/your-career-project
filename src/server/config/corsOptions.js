/**
 * Shared CORS settings for Express (root server and test app).
 * Set CORS_ORIGIN to a comma-separated list of allowed origins.
 * When unset, defaults to local webpack dev server URLs on port 3001.
 */
function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGIN;
  if (raw != null && String(raw).trim() !== '') {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ['http://localhost:3001', 'http://127.0.0.1:3001'];
}

module.exports = {
  corsOptions: {
    origin: parseCorsOrigins(),
    credentials: true,
  },
};
