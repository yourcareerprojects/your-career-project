/**
 * Canonical identity for simulation / exploration roles.
 * Prefer ESCO / career-path ids so exploration inserts match existing ranked rows.
 */

import { getRoleTitleEnglishForMatch } from './roleTitleDisplay';

/**
 * @param {object | null | undefined} role
 * @returns {string | null}
 */
export function getSimulationRoleKey(role) {
  if (!role || typeof role !== 'object') return null;
  const esco = String(role.escoId || role.step?.escoId || '').trim().toLowerCase();
  if (esco) return `esco:${esco}`;
  const careerPathId = String(
    role.careerPathId || role._id || role.step?.careerPathId || role.step?._id || ''
  ).trim();
  if (careerPathId) return `cp:${careerPathId}`;
  const id = String(role.stepId || role.id || role.instanceId || '').trim();
  if (id) return `id:${id}`;
  const title = getRoleTitleEnglishForMatch(role.title || role.step?.title);
  return title ? `title:${title.trim().toLowerCase()}` : null;
}
