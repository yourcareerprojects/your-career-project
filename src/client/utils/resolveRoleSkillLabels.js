/**
 * Map free-text skill labels (e.g. from CV extraction) to canonical role-skill catalog labels.
 * @param {{ labels?: string[], token?: string|null, langQuery?: string }} options
 * @returns {Promise<string[]>}
 */
async function resolveRoleSkillLabels({ labels = [], token = null, langQuery = '' } = {}) {
  const normalized = (Array.isArray(labels) ? labels : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (normalized.length === 0) return [];

  const query = String(langQuery || '').trim();
  const suffix = query && !query.startsWith('?') ? `?${query}` : query;
  const res = await fetch(`/api/profile/role-skills/resolve${suffix}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ labels: normalized }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.details || 'Failed to resolve skills');
    err.status = res.status;
    throw err;
  }
  const skills = Array.isArray(data.skills) ? data.skills : [];
  const seen = new Set();
  const out = [];
  for (const skill of skills) {
    const label = String(skill?.label || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

module.exports = {
  resolveRoleSkillLabels,
};
