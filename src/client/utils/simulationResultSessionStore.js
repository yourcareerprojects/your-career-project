const RESULT_DETAILS_MAP_KEY = 'simulationResultDetailsById';
const RESULT_DETAILS_MAP_LOCAL_KEY = 'simulationResultDetailsByIdLocal';

const normalizeId = (value) => {
  if (value == null) return '';
  try {
    return decodeURIComponent(String(value)).trim().toLowerCase();
  } catch {
    return String(value).trim().toLowerCase();
  }
};

const parseMap = (raw) => {
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed;
};

const readSessionResultDetailsMap = () => {
  try {
    return parseMap(sessionStorage.getItem(RESULT_DETAILS_MAP_KEY));
  } catch {
    return {};
  }
};

const readLocalResultDetailsMap = () => {
  try {
    return parseMap(localStorage.getItem(RESULT_DETAILS_MAP_LOCAL_KEY));
  } catch {
    return {};
  }
};

const writeResultDetailsMap = (map, mirrorLocal = false) => {
  try {
    sessionStorage.setItem(RESULT_DETAILS_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore storage errors */
  }
  if (!mirrorLocal) return;
  try {
    localStorage.setItem(RESULT_DETAILS_MAP_LOCAL_KEY, JSON.stringify(map));
  } catch {
    /* ignore storage errors */
  }
};

/** Clear cached result-detail payloads so another account on this browser cannot see prior user's data. */
export function clearSimulationResultDetailsCaches() {
  try {
    sessionStorage.removeItem(RESULT_DETAILS_MAP_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(RESULT_DETAILS_MAP_LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

export const storeSimulationResultDetails = (details, ids = []) => {
  if (!details || typeof details !== 'object') return;
  const map = {
    ...readLocalResultDetailsMap(),
    ...readSessionResultDetailsMap(),
  };
  const keys = new Set(
    [details.resultId, details.stepId, details.id, ...ids]
      .map(normalizeId)
      .filter(Boolean)
  );
  if (!keys.size) return;
  keys.forEach((key) => {
    map[key] = details;
  });
  writeResultDetailsMap(map, true);
};

export const getSimulationResultDetails = (id) => {
  const key = normalizeId(id);
  if (!key) return null;
  const sessionMap = readSessionResultDetailsMap();
  if (sessionMap[key]) return sessionMap[key];
  const localMap = readLocalResultDetailsMap();
  const localMatch = localMap[key] || null;
  if (localMatch) {
    // Warm the current tab's session cache from local mirror.
    writeResultDetailsMap({ ...localMap, ...sessionMap }, false);
  }
  return localMatch;
};

