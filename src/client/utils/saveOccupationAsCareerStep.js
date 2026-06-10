import { getProfileApiLangQuery } from './profileApiLangQuery';
import { setSavedCareerStepsListQueryData } from '../hooks/useProfileQueries';
import { findMatchingSavedCareerStep } from './savedCareerStepIdentity';

/** Stable step id for roles saved from the explore/browse flow. */
export function buildBrowseStepId(escoId) {
  const id = String(escoId || '').trim();
  if (!id) throw new Error('escoId is required');
  return `explore-${id}`;
}

export function buildRoleIdentityFromOccupation(occupation = {}) {
  return {
    ...occupation,
    careerPathId: occupation.careerPathId || occupation._id || null,
    category: 'explored',
    listCategory: 'explored',
  };
}

export function buildSavePayloadFromOccupation(occupation) {
  const escoId = occupation.escoId || '';
  return {
    stepId: buildBrowseStepId(escoId),
    title: occupation.title,
    description: occupation.description,
    escoId: escoId || null,
    careerPathId: occupation.careerPathId || occupation._id || null,
    simulationResultId: 'explore',
    category: 'explored',
    listCategory: 'explored',
    savedAt: new Date().toISOString(),
    requiredSkills: occupation.requiredSkills || [],
    altTitles: occupation.altTitles || [],
    hiddenTitles: occupation.hiddenTitles || [],
    seniority: occupation.seniority || null,
    keyResponsibilities: occupation.keyResponsibilities || null,
    skillDomains: occupation.skillDomains || null,
    skillModel: occupation.skillModel || null,
  };
}

export function findSavedOccupationMatch(occupation, savedSteps) {
  if (!occupation || !Array.isArray(savedSteps)) return null;
  return findMatchingSavedCareerStep(buildRoleIdentityFromOccupation(occupation), savedSteps);
}

export function isOccupationSaved(occupation, savedSteps) {
  return Boolean(findSavedOccupationMatch(occupation, savedSteps));
}

export async function saveOccupationAsCareerStep(occupation) {
  const saveData = buildSavePayloadFromOccupation(occupation);
  const res = await fetch(`/api/profile/saved-career-steps?${getProfileApiLangQuery()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`,
    },
    body: JSON.stringify(saveData),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Failed to save career step');
  }
  if (data.success && Array.isArray(data.savedCareerSteps)) {
    setSavedCareerStepsListQueryData(data.savedCareerSteps);
  }
  return data;
}

export async function removeSavedOccupation(occupation, savedSteps) {
  const match = findSavedOccupationMatch(occupation, savedSteps);
  if (!match?.stepId) {
    throw new Error('Career step not found');
  }
  const res = await fetch(`/api/profile/saved-career-steps/${encodeURIComponent(match.stepId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('token')}`,
    },
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || data.error || 'Failed to remove career step');
  }
  if (Array.isArray(data.savedCareerSteps)) {
    setSavedCareerStepsListQueryData(data.savedCareerSteps);
  }
  return data;
}
