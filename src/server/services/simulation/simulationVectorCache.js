/**
 * Process-wide LRU + TTL cache for CareerPath.roleVectors blobs only.
 * Deduplicates Mongo reads across simulation chunks and sequential job runs on the same process.
 */

function parsePositiveIntEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

class RoleVectorsLRUCache {
  /**
   * @param {number} maxSize max entries (0 disables cache reads/writes)
   * @param {number} ttlMs entry TTL ms (<= 0 disables expiry)
   */
  constructor(maxSize, ttlMs) {
    this.maxSize = Math.max(0, Math.floor(Number(maxSize) || 0));
    this.ttlMs = Number(ttlMs) || 0;
    /** @type {Map<string, { value: unknown, expiresAt: number }>} */
    this.map = new Map();
  }

  pruneExpired(now = Date.now()) {
    if (this.ttlMs <= 0 || this.maxSize <= 0) return;
    for (const [key, entry] of this.map) {
      if (now > entry.expiresAt) this.map.delete(key);
    }
  }

  /** @returns {unknown|undefined} undefined on miss */
  get(keyStr) {
    if (this.maxSize <= 0) return undefined;
    const key = String(keyStr);
    this.pruneExpired();
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.ttlMs > 0 && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(keyStr, value) {
    if (this.maxSize <= 0 || value === undefined) return;
    const key = String(keyStr);
    this.pruneExpired();

    if (this.map.has(key)) this.map.delete(key);
    while (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    const expiresAt = this.ttlMs > 0 ? Date.now() + this.ttlMs : Number.MAX_SAFE_INTEGER;
    this.map.set(key, { value, expiresAt });
  }
}

let singleton = /** @type {RoleVectorsLRUCache | null} */ (null);

function parseCacheTtlMs() {
  const raw = process.env.SIMULATION_VECTOR_CACHE_TTL_MS;
  if (raw == null || raw === '') return 20 * 60 * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function getSimulationRoleVectorCache() {
  if (singleton) return singleton;
  const maxSize = parsePositiveIntEnv('SIMULATION_VECTOR_CACHE_SIZE', 2000);
  const ttlMs = parseCacheTtlMs();
  singleton = new RoleVectorsLRUCache(maxSize, ttlMs);
  return singleton;
}

module.exports = {
  RoleVectorsLRUCache,
  getSimulationRoleVectorCache,
  parsePositiveIntEnv,
};
