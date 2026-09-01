const {
  getPreferenceFieldsForAudience,
  normalizePathPlanningAudience,
  ENUM_OPTION_VALUES,
  BOOLEAN_PREFERENCE_FIELDS,
} = require('./questionnaireConfig');

const STAGES = ['QUESTIONNAIRE', 'ROADMAP_GENERATION', 'ROADMAP_EXPLANATION', 'FINISHED'];

/** @deprecated Prefer getPreferenceFieldsForAudience(audience) */
const PREFERENCE_FIELDS = ['educationPreference', 'apprenticeship', 'university'];

const EDUCATION_PREFERENCE_VALUES = new Set(ENUM_OPTION_VALUES.educationPreference);
const BOOLEAN_ANSWER_VALUES = new Set([true, false, 'unsure']);

/**
 * @typedef {'QUESTIONNAIRE' | 'ROADMAP_GENERATION' | 'ROADMAP_EXPLANATION' | 'FINISHED'} CareerPathPlanningStage
 * @typedef {'work' | 'school' | 'unsure'} EducationPreference
 * @typedef {boolean | 'unsure'} BooleanPreference
 * @typedef {'pupil' | 'student' | 'career' | 'senior'} PathPlanningAudience
 *
 * @typedef {Object} CareerPathPlanningAnswers
 * @property {EducationPreference} [educationPreference]
 * @property {BooleanPreference} [apprenticeship]
 * @property {BooleanPreference} [university]
 * @property {'finish_first' | 'start_sooner' | 'unsure'} [studyPace]
 * @property {BooleanPreference} [extraQualification]
 * @property {'asap' | 'one_to_two_years' | 'exploring'} [timeline]
 * @property {'on_the_job' | 'courses' | 'further_degree' | 'unsure'} [gapClosing]
 * @property {'deepen' | 'pivot' | 'leadership'} [moveType]
 * @property {'ic' | 'leadership' | 'hybrid'} [scope]
 * @property {'gradual' | 'decisive' | 'exploring'} [changePace]
 * @property {'flexible' | 'geography' | 'industry' | 'both'} [constraints]
 *
 * @typedef {Object} CareerPathPlanningState
 * @property {string} targetCareer
 * @property {CareerPathPlanningStage} stage
 * @property {CareerPathPlanningAnswers} answers
 * @property {PathPlanningAudience} [audience]
 */

/**
 * @param {string} targetCareer
 * @param {PathPlanningAudience} [audience]
 * @returns {CareerPathPlanningState}
 */
function createInitialState(targetCareer, audience = 'career') {
  return {
    targetCareer: String(targetCareer || '').trim(),
    stage: 'QUESTIONNAIRE',
    answers: {},
    audience: normalizePathPlanningAudience(audience),
  };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasAnswer(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * @param {CareerPathPlanningAnswers} answers
 * @param {PathPlanningAudience | string} [audience]
 * @returns {string[]}
 */
function getMissingPreferenceFields(answers = {}, audience = 'pupil') {
  const fields = getPreferenceFieldsForAudience(audience);
  const missing = [];
  for (const field of fields) {
    if (!hasAnswer(answers[field])) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * @param {CareerPathPlanningState | { answers?: CareerPathPlanningAnswers, audience?: string }} state
 * @param {PathPlanningAudience | string} [audienceOverride]
 * @returns {boolean}
 */
function isPreferencesComplete(state, audienceOverride) {
  const audience = audienceOverride
    || state?.audience
    || 'pupil';
  return getMissingPreferenceFields(state?.answers, audience).length === 0;
}

/**
 * @param {unknown} value
 * @param {string[]} allowed
 * @returns {string | null}
 */
function normalizeEnumValue(value, allowed) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (allowed.includes(normalized)) return normalized;
  return null;
}

/**
 * @param {unknown} value
 * @returns {EducationPreference | null}
 */
function normalizeEducationPreference(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'work' || normalized === 'practical' || normalized === 'job' || normalized === 'arbeit') {
    return 'work';
  }
  if (normalized === 'school' || normalized === 'education' || normalized === 'schule') {
    return 'school';
  }
  if (normalized === 'unsure' || normalized === 'unknown' || normalized === 'unsicher') {
    return 'unsure';
  }
  if (EDUCATION_PREFERENCE_VALUES.has(normalized)) {
    return normalized;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {BooleanPreference | null}
 */
function normalizeBooleanPreference(value) {
  if (value === true || value === false) return value;
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === 'ja') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === 'nein') return false;
  if (normalized === 'unsure' || normalized === 'unknown' || normalized === 'unsicher' || normalized === 'vielleicht' || normalized === 'maybe') {
    return 'unsure';
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {'finish_first' | 'start_sooner' | 'unsure' | null}
 */
function normalizeStudyPace(value) {
  return normalizeEnumValue(value, ENUM_OPTION_VALUES.studyPace);
}

/**
 * @param {unknown} value
 * @returns {'asap' | 'one_to_two_years' | 'exploring' | null}
 */
function normalizeTimeline(value) {
  return normalizeEnumValue(value, ENUM_OPTION_VALUES.timeline);
}

/**
 * @param {unknown} value
 * @returns {'on_the_job' | 'courses' | 'further_degree' | 'unsure' | null}
 */
function normalizeGapClosing(value) {
  return normalizeEnumValue(value, ENUM_OPTION_VALUES.gapClosing);
}

/**
 * @param {unknown} value
 * @returns {'deepen' | 'pivot' | 'leadership' | null}
 */
function normalizeMoveType(value) {
  return normalizeEnumValue(value, ENUM_OPTION_VALUES.moveType);
}

/**
 * @param {unknown} value
 * @returns {'ic' | 'leadership' | 'hybrid' | null}
 */
function normalizeScope(value) {
  return normalizeEnumValue(value, ENUM_OPTION_VALUES.scope);
}

/**
 * @param {unknown} value
 * @returns {'gradual' | 'decisive' | 'exploring' | null}
 */
function normalizeChangePace(value) {
  return normalizeEnumValue(value, ENUM_OPTION_VALUES.changePace);
}

/**
 * @param {unknown} value
 * @returns {'flexible' | 'geography' | 'industry' | 'both' | null}
 */
function normalizeConstraints(value) {
  return normalizeEnumValue(value, ENUM_OPTION_VALUES.constraints);
}

/**
 * @param {CareerPathPlanningAnswers} answers
 * @param {Partial<CareerPathPlanningAnswers>} updates
 * @returns {CareerPathPlanningAnswers}
 */
function mergeAnswers(answers = {}, updates = {}) {
  const next = { ...answers };

  if (updates.educationPreference !== undefined) {
    const normalized = normalizeEducationPreference(updates.educationPreference);
    if (normalized) next.educationPreference = normalized;
  }
  if (updates.apprenticeship !== undefined) {
    const normalized = normalizeBooleanPreference(updates.apprenticeship);
    if (normalized !== null) next.apprenticeship = normalized;
  }
  if (updates.university !== undefined) {
    const normalized = normalizeBooleanPreference(updates.university);
    if (normalized !== null) next.university = normalized;
  }
  if (updates.studyPace !== undefined) {
    const normalized = normalizeStudyPace(updates.studyPace);
    if (normalized) next.studyPace = normalized;
  }
  if (updates.extraQualification !== undefined) {
    const normalized = normalizeBooleanPreference(updates.extraQualification);
    if (normalized !== null) next.extraQualification = normalized;
  }
  if (updates.timeline !== undefined) {
    const normalized = normalizeTimeline(updates.timeline);
    if (normalized) next.timeline = normalized;
  }
  if (updates.gapClosing !== undefined) {
    const normalized = normalizeGapClosing(updates.gapClosing);
    if (normalized) next.gapClosing = normalized;
  }
  if (updates.moveType !== undefined) {
    const normalized = normalizeMoveType(updates.moveType);
    if (normalized) next.moveType = normalized;
  }
  if (updates.scope !== undefined) {
    const normalized = normalizeScope(updates.scope);
    if (normalized) next.scope = normalized;
  }
  if (updates.changePace !== undefined) {
    const normalized = normalizeChangePace(updates.changePace);
    if (normalized) next.changePace = normalized;
  }
  if (updates.constraints !== undefined) {
    const normalized = normalizeConstraints(updates.constraints);
    if (normalized) next.constraints = normalized;
  }

  return next;
}

/**
 * @param {CareerPathPlanningState} state
 * @param {CareerPathPlanningStage} stage
 * @returns {CareerPathPlanningState}
 */
function setStage(state, stage) {
  if (!STAGES.includes(stage)) {
    throw new Error(`Invalid career path planning stage: ${stage}`);
  }
  return { ...state, stage };
}

/**
 * @param {CareerPathPlanningState} state
 * @returns {CareerPathPlanningState}
 */
function completeQuestionnaire(state) {
  if (!isPreferencesComplete(state)) {
    throw new Error('Cannot leave QUESTIONNAIRE until all answers are collected');
  }
  return setStage(state, 'ROADMAP_GENERATION');
}

/**
 * @param {CareerPathPlanningState} state
 * @returns {CareerPathPlanningState}
 */
function completeRoadmapGeneration(state) {
  return setStage(state, 'ROADMAP_EXPLANATION');
}

/**
 * @param {CareerPathPlanningState} state
 * @returns {CareerPathPlanningState}
 */
function completeRoadmapExplanation(state) {
  return setStage(state, 'FINISHED');
}

/**
 * @param {unknown} raw
 * @param {string} fallbackTargetCareer
 * @param {PathPlanningAudience | string} [fallbackAudience]
 * @returns {CareerPathPlanningState}
 */
function normalizeState(raw, fallbackTargetCareer = '', fallbackAudience = 'career') {
  if (!raw || typeof raw !== 'object') {
    return createInitialState(fallbackTargetCareer, fallbackAudience);
  }

  const legacyStageMap = {
    INTRO: 'QUESTIONNAIRE',
    PREFERENCES: 'QUESTIONNAIRE',
    SUMMARY: 'ROADMAP_EXPLANATION',
    ROADMAP: 'ROADMAP_GENERATION',
  };
  const rawStage = raw.stage;
  const stage = STAGES.includes(rawStage)
    ? rawStage
    : (legacyStageMap[rawStage] || 'QUESTIONNAIRE');
  const answers = mergeAnswers({}, raw.answers || raw.preferences || {});
  const audience = normalizePathPlanningAudience(
    raw.audience || fallbackAudience
  );

  return {
    targetCareer: String(raw.targetCareer || fallbackTargetCareer || '').trim(),
    stage,
    answers,
    audience,
  };
}

/**
 * @param {CareerPathPlanningState} state
 * @param {Partial<CareerPathPlanningAnswers>} answersUpdate
 * @returns {CareerPathPlanningState}
 */
function applyAnswersUpdate(state, answersUpdate = {}) {
  if (!answersUpdate || typeof answersUpdate !== 'object') {
    return state;
  }
  return {
    ...state,
    answers: mergeAnswers(state.answers, answersUpdate),
  };
}

function formatBooleanLabel(value, isDe) {
  if (value === true) return isDe ? 'ja' : 'yes';
  if (value === false) return isDe ? 'nein' : 'no';
  return isDe ? 'unsicher' : 'unsure';
}

/**
 * @param {CareerPathPlanningAnswers} answers
 * @param {'de' | 'en'} lang
 * @returns {string}
 */
function formatKnownAnswers(answers = {}, lang = 'de') {
  const isDe = lang === 'de';
  const lines = [];

  if (hasAnswer(answers.educationPreference)) {
    const labels = isDe
      ? { work: 'schnell praktisch arbeiten', school: 'länger in Schule/Ausbildung bleiben', unsure: 'unsicher' }
      : { work: 'start working practically soon', school: 'stay in school/training longer', unsure: 'unsure' };
    lines.push(
      isDe
        ? `Arbeitsstart-Präferenz: ${labels[answers.educationPreference] || answers.educationPreference}`
        : `Work-start preference: ${labels[answers.educationPreference] || answers.educationPreference}`
    );
  }
  if (hasAnswer(answers.apprenticeship)) {
    lines.push(
      isDe
        ? `Ausbildung/Lehre: ${formatBooleanLabel(answers.apprenticeship, true)}`
        : `Apprenticeship: ${formatBooleanLabel(answers.apprenticeship, false)}`
    );
  }
  if (hasAnswer(answers.university)) {
    lines.push(
      isDe
        ? `Studium später: ${formatBooleanLabel(answers.university, true)}`
        : `University later: ${formatBooleanLabel(answers.university, false)}`
    );
  }
  if (hasAnswer(answers.studyPace)) {
    const labels = isDe
      ? {
        finish_first: 'Studium/Ausbildung zuerst abschließen',
        start_sooner: 'früher in den Job einsteigen',
        unsure: 'unsicher',
      }
      : {
        finish_first: 'finish studies/training first',
        start_sooner: 'enter the job sooner',
        unsure: 'unsure',
      };
    lines.push(
      isDe
        ? `Studien-/Ausbildungs-Tempo: ${labels[answers.studyPace] || answers.studyPace}`
        : `Study/training pace: ${labels[answers.studyPace] || answers.studyPace}`
    );
  }
  if (hasAnswer(answers.extraQualification)) {
    lines.push(
      isDe
        ? `Zusatzqualifikation/Dual: ${formatBooleanLabel(answers.extraQualification, true)}`
        : `Extra/dual qualification: ${formatBooleanLabel(answers.extraQualification, false)}`
    );
  }
  if (hasAnswer(answers.timeline)) {
    const labels = isDe
      ? {
        asap: 'möglichst bald',
        one_to_two_years: 'in etwa 1–2 Jahren',
        exploring: 'noch explorierend',
      }
      : {
        asap: 'as soon as possible',
        one_to_two_years: 'within about 1–2 years',
        exploring: 'still exploring',
      };
    lines.push(
      isDe
        ? `Zeitrahmen: ${labels[answers.timeline] || answers.timeline}`
        : `Timeline: ${labels[answers.timeline] || answers.timeline}`
    );
  }
  if (hasAnswer(answers.gapClosing)) {
    const labels = isDe
      ? {
        on_the_job: 'im Job lernen',
        courses: 'gezielte Kurse/Weiterbildung',
        further_degree: 'weiterer Abschluss',
        unsure: 'unsicher',
      }
      : {
        on_the_job: 'learn on the job',
        courses: 'targeted courses/training',
        further_degree: 'further degree',
        unsure: 'unsure',
      };
    lines.push(
      isDe
        ? `Skill-Lücken schließen: ${labels[answers.gapClosing] || answers.gapClosing}`
        : `Closing skill gaps: ${labels[answers.gapClosing] || answers.gapClosing}`
    );
  }
  if (hasAnswer(answers.moveType)) {
    const labels = isDe
      ? {
        deepen: 'Vertiefung im aktuellen Feld',
        pivot: 'Wechsel in angrenzendes Feld',
        leadership: 'Schritt in Richtung Führung',
      }
      : {
        deepen: 'deeper in current field',
        pivot: 'adjacent pivot',
        leadership: 'step toward leadership',
      };
    lines.push(
      isDe
        ? `Art des Wechsels: ${labels[answers.moveType] || answers.moveType}`
        : `Type of move: ${labels[answers.moveType] || answers.moveType}`
    );
  }
  if (hasAnswer(answers.scope)) {
    const labels = isDe
      ? {
        ic: 'fachliche Expert:innenrolle',
        leadership: 'Führungsrolle',
        hybrid: 'Mischung aus Fach- und Führung',
      }
      : {
        ic: 'individual contributor / expert track',
        leadership: 'leadership track',
        hybrid: 'mix of expert and leadership',
      };
    lines.push(
      isDe
        ? `Rollen-Scope: ${labels[answers.scope] || answers.scope}`
        : `Role scope: ${labels[answers.scope] || answers.scope}`
    );
  }
  if (hasAnswer(answers.changePace)) {
    const labels = isDe
      ? {
        gradual: 'schrittweise',
        decisive: 'entschlossen/zügig',
        exploring: 'noch explorierend',
      }
      : {
        gradual: 'gradual',
        decisive: 'decisive / faster',
        exploring: 'still exploring',
      };
    lines.push(
      isDe
        ? `Tempo der Veränderung: ${labels[answers.changePace] || answers.changePace}`
        : `Pace of change: ${labels[answers.changePace] || answers.changePace}`
    );
  }
  if (hasAnswer(answers.constraints)) {
    const labels = isDe
      ? {
        flexible: 'flexibel (kaum Einschränkungen)',
        geography: 'Standort/Region wichtig',
        industry: 'Branche wichtig',
        both: 'Standort und Branche wichtig',
      }
      : {
        flexible: 'flexible (few constraints)',
        geography: 'location/region matters',
        industry: 'industry matters',
        both: 'location and industry matter',
      };
    lines.push(
      isDe
        ? `Rahmenbedingungen: ${labels[answers.constraints] || answers.constraints}`
        : `Constraints: ${labels[answers.constraints] || answers.constraints}`
    );
  }
  return lines.join('\n');
}

/**
 * @param {string[]} missing
 * @param {'de' | 'en'} lang
 * @param {PathPlanningAudience | string} [audience]
 * @returns {string}
 */
function formatMissingFields(missing = [], lang = 'de', audience = 'pupil') {
  const isDe = lang === 'de';
  const labelsByAudience = {
    pupil: isDe
      ? {
        educationPreference: 'ob eher schnell praktisch gearbeitet oder länger in Schule/Ausbildung geblieben werden soll',
        apprenticeship: 'ob eine Ausbildung/Lehre infrage kommt',
        university: 'ob ein Studium später infrage kommt',
      }
      : {
        educationPreference: 'whether they want to start working quickly or stay in school/training longer',
        apprenticeship: 'whether they would consider an apprenticeship',
        university: 'whether they would consider university later',
      },
    student: isDe
      ? {
        studyPace: 'ob Studium/Ausbildung zuerst abgeschlossen oder früher gestartet werden soll',
        extraQualification: 'ob eine Zusatz- oder Dualqualifikation infrage kommt',
      }
      : {
        studyPace: 'whether to finish studies/training first or start sooner',
        extraQualification: 'whether an extra or dual qualification is of interest',
      },
    career: isDe
      ? {
        timeline: 'in welchem Zeitrahmen der Wechsel geplant ist',
        gapClosing: 'wie Skill-Lücken geschlossen werden sollen',
        moveType: 'ob Vertiefung, Pivot oder Führungsweg gemeint ist',
      }
      : {
        timeline: 'the intended timeline for the move',
        gapClosing: 'how skill gaps should be closed',
        moveType: 'whether this is a deepen, pivot, or leadership move',
      },
    senior: isDe
      ? {
        scope: 'ob eher Fach-, Führungs- oder Hybrid-Rolle angestrebt wird',
        changePace: 'wie zügig die Veränderung sein soll',
        constraints: 'welche Rahmenbedingungen (Ort/Branche) gelten',
      }
      : {
        scope: 'whether an IC, leadership, or hybrid track is preferred',
        changePace: 'how quickly change should happen',
        constraints: 'which location/industry constraints apply',
      },
  };

  const labels = labelsByAudience[normalizePathPlanningAudience(audience)] || labelsByAudience.career;
  return missing.map((field) => labels[field] || field).join('\n');
}

module.exports = {
  STAGES,
  PREFERENCE_FIELDS,
  EDUCATION_PREFERENCE_VALUES,
  BOOLEAN_ANSWER_VALUES,
  BOOLEAN_PREFERENCE_FIELDS,
  createInitialState,
  hasAnswer,
  getMissingPreferenceFields,
  isPreferencesComplete,
  normalizeEducationPreference,
  normalizeBooleanPreference,
  normalizeStudyPace,
  normalizeTimeline,
  normalizeGapClosing,
  normalizeMoveType,
  normalizeScope,
  normalizeChangePace,
  normalizeConstraints,
  mergeAnswers,
  setStage,
  completeQuestionnaire,
  completeRoadmapGeneration,
  completeRoadmapExplanation,
  normalizeState,
  applyAnswersUpdate,
  formatKnownAnswers,
  formatMissingFields,
};
