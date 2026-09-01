const {
  createInitialState,
  normalizeState,
  mergeAnswers,
  getMissingPreferenceFields,
  isPreferencesComplete,
  applyAnswersUpdate,
  completeQuestionnaire,
  completeRoadmapGeneration,
  completeRoadmapExplanation,
  normalizeEducationPreference,
  normalizeBooleanPreference,
} = require('../services/profile/careerPathPlanning/stateManager');

const {
  resolvePathPlanningAudience,
  buildQuestionnairePayload,
  getPreferenceFieldsForAudience,
} = require('../services/profile/careerPathPlanning/questionnaireConfig');

const {
  buildCareerContext,
  formatCareerContextForPrompt,
} = require('../services/profile/careerPathPlanning/careerContextBuilder');

const {
  parseExplanationResponse,
  parseExplanationWithRetry,
} = require('../services/profile/careerPathPlanning/explanationParser');

const {
  buildPathPlanFromCoachPlan,
  buildPathPlanFromRoadmap,
  buildSummaryText,
} = require('../services/profile/careerPathPlanning/roadmapGenerator');

const {
  buildCareerCoachSystemPrompt,
} = require('../services/profile/careerPathPlanning/explanationPromptBuilder');

const {
  generateCareerPathPlan,
  advanceCareerPathCoaching,
} = require('../services/profile/careerPathCoachingService');

const COMPLETE_PUPIL_PREFERENCES = {
  educationPreference: 'work',
  apprenticeship: true,
  university: false,
};

/** @deprecated Use COMPLETE_PUPIL_PREFERENCES */
const COMPLETE_PREFERENCES = COMPLETE_PUPIL_PREFERENCES;

const COMPLETE_CAREER_PREFERENCES = {
  timeline: 'one_to_two_years',
  gapClosing: 'courses',
  moveType: 'deepen',
};

function mockCoachResponse(overrides = {}) {
  return {
    introduction: 'Based on your answers, you have chosen a practical path that fits well.',
    whyThisPath: 'You wanted to start working soon while keeping options open later. A dual apprenticeship is an excellent starting point.',
    recommendedPath: {
      title: 'Dual apprenticeship into Software Development',
      timeline: 'About 3–4 years',
      steps: [
        {
          title: 'While finishing school',
          description: 'Focus on maths and computer science, and shadow a developer for a day.',
          duration: 'Now',
        },
        {
          title: 'Start dual apprenticeship',
          description: 'Apply for IT dual apprenticeships and learn on the job with school blocks.',
          duration: 'After graduation',
        },
        {
          title: 'Build specialist skills',
          description: 'Deepen backend or frontend skills from real projects in your company.',
          duration: 'Years 1–3',
        },
        {
          title: 'Work as a developer',
          description: 'Move into a junior developer role and consider evening study later if useful.',
          duration: 'Goal',
        },
      ],
    },
    alternatives: [
      {
        title: 'Computer science Bachelor later',
        steps: [
          {
            title: 'Finish school with strong maths',
            description: 'Keep grades up in maths and computer science to qualify for university.',
            duration: 'Now',
          },
          {
            title: 'Start a Bachelor in computer science',
            description: 'Apply to universities and build foundations in algorithms and software engineering.',
            duration: 'After graduation',
          },
          {
            title: 'Gain internships during studies',
            description: 'Use semester breaks for developer internships to build practical experience.',
            duration: 'Years 2–3',
          },
          {
            title: 'Enter as a junior developer',
            description: 'Apply for graduate developer roles with a stronger theoretical background.',
            duration: 'Goal',
          },
        ],
      },
      {
        title: 'Vocational school then work',
        steps: [
          {
            title: 'Finish school',
            description: 'Meet entry requirements for a full-time vocational IT program.',
            duration: 'Now',
          },
          {
            title: 'Attend vocational school',
            description: 'Complete a focused IT vocational program with labs and group projects.',
            duration: '1–2 years',
          },
          {
            title: 'Build a portfolio',
            description: 'Create small apps and contribute to open source to show employers your skills.',
            duration: 'During training',
          },
          {
            title: 'Apply for junior roles',
            description: 'Target entry-level developer or IT support roles that lead into development.',
            duration: 'Goal',
          },
        ],
      },
    ],
    nextAction: 'This week, list three local companies offering IT apprenticeships and bookmark their openings.',
    keySkills: ['problem solving', 'programming basics'],
    ...overrides,
  };
}

describe('careerPathPlanning stateManager', () => {
  it('creates initial QUESTIONNAIRE state', () => {
    const state = createInitialState('Social Worker', 'pupil');
    expect(state.stage).toBe('QUESTIONNAIRE');
    expect(state.targetCareer).toBe('Social Worker');
    expect(state.answers).toEqual({});
    expect(state.audience).toBe('pupil');
  });

  it('tracks missing preference fields', () => {
    expect(getMissingPreferenceFields({}, 'pupil')).toEqual([
      'educationPreference',
      'apprenticeship',
      'university',
    ]);
    expect(getMissingPreferenceFields({
      educationPreference: 'work',
      apprenticeship: true,
    }, 'pupil')).toEqual(['university']);
    expect(getMissingPreferenceFields({}, 'career')).toEqual([
      'timeline',
      'gapClosing',
      'moveType',
    ]);
  });

  it('normalizes answer values', () => {
    expect(normalizeEducationPreference('arbeit')).toBe('work');
    expect(normalizeBooleanPreference('ja')).toBe(true);
    expect(normalizeBooleanPreference('vielleicht')).toBe('unsure');
  });

  it('merges answers without overwriting with invalid values', () => {
    const answers = mergeAnswers({}, {
      educationPreference: 'school',
      apprenticeship: 'unsure',
      university: false,
    });
    expect(isPreferencesComplete({ answers, audience: 'pupil' })).toBe(true);
  });

  it('advances through new stages', () => {
    const withAnswers = applyAnswersUpdate(
      createInitialState('Nurse', 'pupil'),
      COMPLETE_PUPIL_PREFERENCES
    );
    const afterQuestionnaire = completeQuestionnaire(withAnswers);
    expect(afterQuestionnaire.stage).toBe('ROADMAP_GENERATION');

    const afterRoadmap = completeRoadmapGeneration(afterQuestionnaire);
    expect(afterRoadmap.stage).toBe('ROADMAP_EXPLANATION');

    const finished = completeRoadmapExplanation(afterRoadmap);
    expect(finished.stage).toBe('FINISHED');
  });

  it('requires complete answers before leaving questionnaire', () => {
    const state = createInitialState('Nurse', 'pupil');
    expect(() => completeQuestionnaire(state)).toThrow();
  });

  it('maps legacy stages to new stages', () => {
    const state = normalizeState({ stage: 'INTRO', answers: {} }, 'Teacher', 'pupil');
    expect(state.stage).toBe('QUESTIONNAIRE');
  });
});

describe('careerPathPlanning questionnaireConfig', () => {
  it('maps Bachelor + 5 years experience to career audience', () => {
    expect(resolvePathPlanningAudience({
      currentStatus: 'employed',
      highestDegree: 'bachelors',
      yearsOfExperience: 5,
      mostSeniorWorkExperience: 'mid_level',
    })).toBe('career');
  });

  it('keeps pupils on the school-leaver question set', () => {
    expect(resolvePathPlanningAudience({ currentStatus: 'pupil' })).toBe('pupil');
    expect(getPreferenceFieldsForAudience('pupil')).toEqual([
      'educationPreference',
      'apprenticeship',
      'university',
    ]);
  });

  it('does not include apprenticeship questions for career audience', () => {
    const payload = buildQuestionnairePayload('career');
    expect(payload.audience).toBe('career');
    expect(payload.questionIds).toEqual([
      'timeline',
      'gapClosing',
      'moveType',
    ]);
    expect(payload.questionIds).not.toContain('apprenticeship');
    expect(payload.questionIds).not.toContain('educationPreference');
  });
});

describe('careerPathPlanning careerContextBuilder', () => {
  it('builds structured context from role + looked-up document without inventing routes', async () => {
    const context = await buildCareerContext({
      lang: 'en',
      role: {
        title: 'Physiotherapist',
        description: 'Helps patients recover movement.',
        requiredSkills: ['anatomy', 'patient communication'],
        keyResponsibilities: ['Assess mobility', 'Plan therapy'],
        progressionNotes: ['Senior therapist'],
      },
      lookupDoc: async () => ({
        escoId: 'http://data.europa.eu/esco/occupation/physio',
        iscoGroup: '2264',
        source: 'ESCO',
        title: { en: 'Physiotherapist', de: 'Physiotherapeut/in' },
        description: { en: 'Helps patients recover movement.', de: null },
        requiredSkills: ['anatomy', 'patient communication'],
        keyResponsibilities: { responsibilities: ['Assess mobility', 'Plan therapy'] },
        skillDomains: {
          skill_domains: [
            { domain: { en: 'Healthcare', de: 'Gesundheit' }, importance: 'core' },
          ],
        },
        seniority: { seniority_level: 2, seniority_label: 'Junior–Mid' },
      }),
    });

    expect(context.career.title).toBe('Physiotherapist');
    expect(context.career.requiredSkills).toEqual(expect.arrayContaining(['anatomy']));
    expect(context.career.typicalTasks).toEqual(expect.arrayContaining(['Assess mobility']));
    expect(context.career.isco).toBe('2264');
    expect(context.career.esco).toContain('physio');
    expect(context.career.salary).toEqual({});
    expect(context.careerProgression).toContain('Senior therapist');
    expect(context.meta.foundInDatabase).toBe(true);
    expect(context.educationRoutes.some((r) => r.type === 'isco_signal')).toBe(true);
  });

  it('marks apprenticeship occupations from application data', async () => {
    const context = await buildCareerContext({
      lang: 'de',
      role: { title: 'Elektroniker', escoId: 'de-ausbildung-elektroniker' },
      lookupDoc: async () => ({
        escoId: 'de-ausbildung-elektroniker',
        sourceVersion: 'v1',
        title: { en: 'Electronics technician', de: 'Elektroniker/in' },
        description: { en: 'Installs electrical systems.', de: 'Installiert elektrische Anlagen.' },
        requiredSkills: [],
        iscoGroup: '7411',
      }),
    });

    expect(context.educationRoutes.some((r) => r.type === 'dual apprenticeship')).toBe(true);
  });

  it('formats context for the coach prompt', async () => {
    const context = await buildCareerContext({
      lang: 'en',
      role: {
        title: 'Graphic Designer',
        requiredSkills: ['typography'],
        description: 'Creates visual designs.',
      },
      lookupDoc: async () => null,
    });
    const text = formatCareerContextForPrompt(context, 'en');
    expect(text).toContain('Graphic Designer');
    expect(text).toContain('typography');
    expect(text).toContain('no structured routes');
  });

  it('surfaces cached enrichment already stored on the CareerPath document', async () => {
    const context = await buildCareerContext({
      lang: 'en',
      role: { title: 'Nurse', escoId: 'http://data.europa.eu/esco/occupation/nurse' },
      lookupDoc: async () => ({
        _id: '507f1f77bcf86cd799439011',
        escoId: 'http://data.europa.eu/esco/occupation/nurse',
        source: 'ESCO',
        title: { en: 'Nurse', de: 'Krankenpfleger/in' },
        description: { en: 'Provides patient care.', de: null },
        requiredSkills: ['empathy'],
        careerKnowledgeEnrichment: {
          en: {
            applicationTimeline: 'Apply about one year before graduation.',
            schoolSubjects: ['Biology', 'Chemistry'],
            softSkills: ['Empathy'],
            sourceVersion: 'v1',
            lang: 'en',
            built_with: 'llm',
          },
        },
      }),
    });

    expect(context.enrichment.applicationTimeline).toContain('one year');
    expect(context.enrichment.schoolSubjects).toContain('Biology');
    expect(context.meta.enrichmentCached).toBe(true);
    expect(context.meta.sources).toContain('career_knowledge_enrichment');
  });
});


describe('careerPathPlanning explanationParser', () => {
  it('parses coaching JSON with roadmap steps', () => {
    const result = parseExplanationResponse(JSON.stringify(mockCoachResponse()));
    expect(result.ok).toBe(true);
    expect(result.data.introduction).toContain('practical path');
    expect(result.data.whyThisPath).toContain('apprenticeship');
    expect(result.data.recommendedPath.steps).toHaveLength(4);
    expect(result.data.alternativePaths[0].steps).toHaveLength(4);
    expect(result.data.alternativePaths).toHaveLength(2);
    expect(result.data.keySkills).toContain('problem solving');
  });

  it('retries when only one alternative is returned', async () => {
    let attempts = 0;
    const data = await parseExplanationWithRetry(async () => {
      attempts += 1;
      if (attempts === 1) {
        return JSON.stringify(mockCoachResponse({
          alternatives: [mockCoachResponse().alternatives[0]],
        }));
      }
      return JSON.stringify(mockCoachResponse());
    }, { maxAttempts: 3 });
    expect(attempts).toBe(2);
    expect(data.alternativePaths).toHaveLength(2);
  });

  it('retries when JSON is invalid', async () => {
    let attempts = 0;
    const data = await parseExplanationWithRetry(async () => {
      attempts += 1;
      if (attempts === 1) return 'not json';
      return JSON.stringify(mockCoachResponse({
        introduction: 'Fits well.',
        nextAction: 'Find an internship at a clinic.',
      }));
    }, { maxAttempts: 3 });
    expect(attempts).toBe(2);
    expect(data.introduction).toBe('Fits well.');
    expect(data.recommendedPath.steps.length).toBeGreaterThanOrEqual(2);
  });
});

describe('careerPathPlanning roadmapGenerator', () => {
  it('builds overview-compatible path plans from coach output', () => {
    const state = {
      targetCareer: 'Software Developer',
      answers: COMPLETE_PREFERENCES,
    };
    const coachPlan = parseExplanationResponse(JSON.stringify(mockCoachResponse())).data;
    const pathPlan = buildPathPlanFromCoachPlan(coachPlan, state, 'en');

    expect(pathPlan.headline).toContain('personal path');
    expect(pathPlan.introduction).toContain('practical path');
    expect(pathPlan.whyThisPath).toContain('apprenticeship');
    expect(pathPlan.recommendedPath.steps).toHaveLength(4);
    expect(pathPlan.keySkills).toContain('programming basics');
    expect(pathPlan.alternativePaths[0].title).toContain('Bachelor');
    expect(pathPlan.alternativePaths).toHaveLength(2);
    expect(pathPlan.alternativePaths[0].steps).toHaveLength(4);
    expect(pathPlan.alternativePaths[1].steps).toHaveLength(4);
    expect(pathPlan.alternativePaths[0].steps[0].duration).toBe('Now');
  });

  it('still maps legacy roadmap+summary shape when needed', () => {
    const summary = {
      understood: 'Start small.',
      whyThisPath: 'An apprenticeship matches your preferences.',
      alternatives: ['Design school'],
    };
    const pathPlan = buildPathPlanFromRoadmap({
      phases: [
        { title: 'Now', actions: ['Research roles'] },
        { title: 'Next', actions: ['Apply'] },
      ],
    }, summary, { targetCareer: 'Designer' }, 'en', {
      motivation: 'The first step is not knowing everything.',
      nextAction: 'Find an internship.',
    });
    expect(pathPlan.recommendedPath.steps).toHaveLength(2);
    expect(buildSummaryText(summary, 'en')).toContain('apprenticeship');
  });
});

describe('careerPathPlanning explanationPromptBuilder', () => {
  it('asks the LLM to coach with structured facts instead of rewriting a template roadmap', () => {
    const prompt = buildCareerCoachSystemPrompt({
      lang: 'en',
      state: { targetCareer: 'Nurse', answers: COMPLETE_PREFERENCES, audience: 'pupil' },
      careerContext: {
        career: {
          title: 'Nurse',
          description: 'Provides patient care.',
          typicalTasks: ['Monitor patients'],
          requiredSkills: ['empathy', 'clinical care'],
          workEnvironment: ['Healthcare'],
          salary: {},
          educationLevel: 'Junior',
          isco: '2221',
          esco: 'http://data.europa.eu/esco/occupation/nurse',
          onet: '',
        },
        educationRoutes: [],
        careerProgression: [],
        alternativePaths: [],
        meta: { sources: ['application', 'esco'], foundInDatabase: true },
      },
      userContext: { seniority: { currentStatus: 'pupil' } },
    });

    expect(prompt).toContain('experienced career coach');
    expect(prompt).toContain('NOT to explain every possible pathway');
    expect(prompt).toContain('teenagers');
    expect(prompt).toContain('Nurse');
    expect(prompt).toContain('clinical care');
    expect(prompt).not.toContain('DO NOT change');
    expect(prompt).not.toContain('NICHT ändern');
    expect(prompt.toLowerCase()).toContain('each alternative must include its own steps roadmap');
    expect(prompt).toContain('exactly 2 separate objects');
    expect(prompt).toContain('"steps"');
    expect(prompt).toContain('JSON schema');
  });

  it('uses professional framing for mid-career Bachelor profiles', () => {
    const prompt = buildCareerCoachSystemPrompt({
      lang: 'en',
      audience: 'career',
      state: {
        targetCareer: 'Product Manager',
        answers: COMPLETE_CAREER_PREFERENCES,
        audience: 'career',
      },
      careerContext: {
        career: {
          title: 'Product Manager',
          description: 'Owns product outcomes.',
          typicalTasks: [],
          requiredSkills: ['prioritization'],
          workEnvironment: [],
          salary: {},
          educationLevel: '',
          isco: '',
          esco: '',
          onet: '',
        },
        educationRoutes: [],
        careerProgression: [],
        alternativePaths: [],
        meta: { sources: [], foundInDatabase: false },
      },
      userContext: {
        seniority: {
          currentStatus: 'employed',
          highestDegree: 'bachelors',
          yearsOfExperience: 5,
        },
      },
    });

    expect(prompt).toContain('early- to mid-career professionals');
    expect(prompt).toContain('Audience / Zielgruppe: career');
    expect(prompt).not.toContain('teenagers');
    expect(prompt).not.toContain('apprenticeship duration');
    expect(prompt).toContain('Timeline:');
    expect(prompt).toContain('within about 1–2 years');
  });

  it('requires German Du-Form and forbids Sie-Form in DE prompts', () => {
    const prompt = buildCareerCoachSystemPrompt({
      lang: 'de',
      audience: 'career',
      state: {
        targetCareer: 'Media Designer',
        answers: COMPLETE_CAREER_PREFERENCES,
        audience: 'career',
      },
      careerContext: {
        career: {
          title: 'Media Designer',
          description: '',
          typicalTasks: [],
          requiredSkills: [],
          workEnvironment: [],
          salary: {},
          educationLevel: '',
          isco: '',
          esco: '',
          onet: '',
        },
        educationRoutes: [],
        careerProgression: [],
        alternativePaths: [],
        meta: { sources: [], foundInDatabase: false },
      },
      userContext: {
        seniority: {
          currentStatus: 'employed',
          highestDegree: 'bachelors',
          yearsOfExperience: 5,
        },
      },
    });

    expect(prompt).toContain('per Du');
    expect(prompt).toContain('niemals Sie');
    expect(prompt).toMatch(/du\/dich\/dir\/dein/i);
  });
});

describe('germanInformalAddress', () => {
  const {
    enforceGermanDuAddress,
    enforceGermanDuAddressDeep,
  } = require('../services/profile/careerPathPlanning/germanInformalAddress');

  it('rewrites common Sie-Form phrases to Du-Form', () => {
    const input = 'Sie können Ihre Skills ausbauen. Sollten Sie Fragen haben, melden Sie sich bei Ihrem Mentor.';
    const out = enforceGermanDuAddress(input);
    expect(out).toMatch(/du kannst|kannst du/i);
    expect(out).toContain('deine Skills');
    expect(out).toMatch(/solltest du/i);
    expect(out).toContain('melde dich');
    expect(out).toContain('deinem Mentor');
    expect(out).not.toMatch(/\bSie\b/);
    expect(out).not.toMatch(/\bIhnen\b/);
    expect(out).not.toMatch(/\bIhr(e|en|em|er|es)?\b/);
  });

  it('rewrites nested coach plan fields', () => {
    const plan = enforceGermanDuAddressDeep({
      introduction: 'Sie passen gut zu dieser Rolle.',
      recommendedPath: {
        steps: [{ title: 'Start', description: 'Nutzen Sie Ihre Stärken.' }],
      },
    });
    expect(plan.introduction).toBe('Du passt gut zu dieser Rolle.');
    expect(plan.recommendedPath.steps[0].description).toMatch(/nutze/i);
    expect(plan.recommendedPath.steps[0].description).toContain('deine Stärken');
  });
});

describe('generateCareerPathPlan', () => {
  const role = {
    title: 'Software Developer',
    description: 'Builds software systems.',
    requiredSkills: ['programming', 'debugging'],
    escoId: 'http://data.europa.eu/esco/occupation/dev',
  };
  const userContext = { seniority: { currentStatus: 'pupil' } };

  it('generates path plan with one LLM coaching call using career context', async () => {
    const llm = jest.fn().mockResolvedValue({
      text: JSON.stringify(mockCoachResponse()),
    });
    const buildContext = jest.fn().mockResolvedValue({
      career: {
        title: 'Software Developer',
        description: 'Builds software systems.',
        typicalTasks: ['Write code'],
        requiredSkills: ['programming', 'debugging'],
        workEnvironment: ['IT'],
        salary: {},
        educationLevel: '',
        isco: '2512',
        esco: role.escoId,
        onet: '',
      },
      educationRoutes: [],
      careerProgression: [],
      alternativePaths: [],
      meta: { sources: ['application'], foundInDatabase: true },
    });

    const result = await generateCareerPathPlan({
      role,
      userContext,
      preferences: COMPLETE_PREFERENCES,
      lang: 'en',
      llm,
      buildContext,
      skipEnrichment: true,
    });

    expect(result.complete).toBe(true);
    expect(result.phase).toBe('summary');
    expect(result.pathPlan.recommendedPath.steps.length).toBeGreaterThanOrEqual(3);
    expect(result.pathPlan.introduction).toContain('practical path');
    expect(result.pathPlan.whyThisPath).toContain('working soon');
    expect(result.state.stage).toBe('FINISHED');
    expect(llm).toHaveBeenCalledTimes(1);
    expect(buildContext).toHaveBeenCalledTimes(1);

    const llmCall = llm.mock.calls[0][0];
    expect(llmCall.responseFormat).toEqual({ type: 'json_object' });
    const systemPrompt = llmCall.messages[0].content;
    expect(systemPrompt).toContain('career coach');
    expect(systemPrompt).toContain('programming');
  });

  it('enriches career context before coaching when enrichment is enabled', async () => {
    const coachLlm = jest.fn().mockResolvedValue({
      text: JSON.stringify(mockCoachResponse()),
    });
    const enrichmentLlm = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        applicationTimeline: 'Apply about one year before graduation.',
        apprenticeshipDuration: 'Usually 3 years',
        schoolSubjects: ['Maths', 'Computer Science'],
        recommendedExperience: ['Coding club', 'Internship'],
        softSkills: ['Teamwork'],
      }),
    });
    const buildContext = jest.fn().mockResolvedValue({
      career: {
        title: 'Software Developer',
        description: 'Builds software systems.',
        typicalTasks: ['Write code'],
        requiredSkills: ['programming'],
        workEnvironment: [],
        salary: {},
        educationLevel: '',
        isco: '2512',
        esco: role.escoId,
        onet: '',
      },
      educationRoutes: [],
      careerProgression: [],
      alternativePaths: [],
      enrichment: null,
      meta: {
        sources: ['application'],
        foundInDatabase: true,
        careerPathId: '507f1f77bcf86cd799439011',
        lang: 'en',
      },
    });
    const writeCache = jest.fn().mockResolvedValue({});
    const readCache = jest.fn().mockResolvedValue(null);

    const { enrichCareerContext } = require('../services/profile/careerPathPlanning/careerKnowledgeEnrichmentService');

    const result = await generateCareerPathPlan({
      role,
      userContext,
      preferences: COMPLETE_PREFERENCES,
      lang: 'en',
      llm: coachLlm,
      enrichmentLlm,
      buildContext,
      enrichContext: (args) => enrichCareerContext({
        ...args,
        readCache,
        writeCache,
      }),
    });

    expect(result.complete).toBe(true);
    expect(result.careerContext.enrichment.applicationTimeline).toContain('one year');
    expect(result.careerContext.enrichment.schoolSubjects).toContain('Maths');
    expect(enrichmentLlm).toHaveBeenCalledTimes(1);
    expect(coachLlm).toHaveBeenCalledTimes(1);
    expect(writeCache).toHaveBeenCalledTimes(1);

    const coachPrompt = coachLlm.mock.calls[0][0].messages[0].content;
    expect(coachPrompt).toContain('Application timeline');
    expect(coachPrompt).toContain('Maths');
  });


  it('throws when preferences are incomplete', async () => {
    await expect(generateCareerPathPlan({
      role,
      preferences: { educationPreference: 'work' },
      lang: 'en',
      llm: jest.fn(),
      buildContext: jest.fn(),
    })).rejects.toThrow('All questionnaire preferences are required');
  });
});

describe('advanceCareerPathCoaching', () => {
  const role = { title: 'Software Developer' };

  it('returns audience-aware questionnaire when preferences are missing', async () => {
    const result = await advanceCareerPathCoaching({
      role,
      lang: 'en',
      userContext: {
        seniority: {
          currentStatus: 'employed',
          highestDegree: 'bachelors',
          yearsOfExperience: 5,
          mostSeniorWorkExperience: 'mid_level',
        },
      },
    });
    expect(result.phase).toBe('questionnaire');
    expect(result.complete).toBe(false);
    expect(result.audience).toBe('career');
    expect(result.questionIds).toEqual([
      'timeline',
      'gapClosing',
      'moveType',
    ]);
    expect(result.questions.map((q) => q.id)).toEqual(result.questionIds);
    expect(result.state.stage).toBe('QUESTIONNAIRE');
    expect(result.state.audience).toBe('career');
  });

  it('returns pupil questionnaire for school-leaver profiles', async () => {
    const result = await advanceCareerPathCoaching({
      role,
      lang: 'de',
      userContext: { seniority: { currentStatus: 'pupil' } },
    });
    expect(result.audience).toBe('pupil');
    expect(result.questionIds).toContain('apprenticeship');
    expect(result.questionIds).toContain('educationPreference');
  });

  it('generates plan when complete preferences are provided', async () => {
    const llm = jest.fn().mockResolvedValue({
      text: JSON.stringify(mockCoachResponse()),
    });

    const result = await advanceCareerPathCoaching({
      role,
      preferences: COMPLETE_PREFERENCES,
      userContext: { seniority: { currentStatus: 'pupil' } },
      lang: 'en',
      llm,
      skipEnrichment: true,
      buildContext: async () => ({
        career: {
          title: 'Software Developer',
          description: '',
          typicalTasks: [],
          requiredSkills: ['programming'],
          workEnvironment: [],
          salary: {},
          educationLevel: '',
          isco: '',
          esco: '',
          onet: '',
        },
        educationRoutes: [],
        careerProgression: [],
        alternativePaths: [],
        meta: { sources: ['simulation_role'], foundInDatabase: false },
      }),
    });

    expect(result.complete).toBe(true);
    expect(result.audience).toBe('pupil');
    expect(result.pathPlan.headline).toBeTruthy();
    expect(result.pathPlan.recommendedPath.steps.length).toBeGreaterThanOrEqual(2);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('accepts career preferences for Bachelor + experience profiles', async () => {
    const llm = jest.fn().mockResolvedValue({
      text: JSON.stringify(mockCoachResponse({
        introduction: 'Your experience positions you well for this move.',
        whyThisPath: 'You want a measured 1–2 year transition with targeted courses.',
        nextAction: 'Book a skills gap review with a mentor this week.',
      })),
    });

    const result = await advanceCareerPathCoaching({
      role,
      preferences: COMPLETE_CAREER_PREFERENCES,
      userContext: {
        seniority: {
          currentStatus: 'employed',
          highestDegree: 'bachelors',
          yearsOfExperience: 5,
        },
      },
      lang: 'en',
      llm,
      skipEnrichment: true,
      buildContext: async () => ({
        career: {
          title: 'Software Developer',
          description: '',
          typicalTasks: [],
          requiredSkills: ['programming'],
          workEnvironment: [],
          salary: {},
          educationLevel: '',
          isco: '',
          esco: '',
          onet: '',
        },
        educationRoutes: [],
        careerProgression: [],
        alternativePaths: [],
        meta: { sources: ['simulation_role'], foundInDatabase: false },
      }),
    });

    expect(result.complete).toBe(true);
    expect(result.audience).toBe('career');
    const coachPrompt = llm.mock.calls[0][0].messages[0].content;
    expect(coachPrompt).toContain('early- to mid-career professionals');
    expect(coachPrompt).not.toContain('teenagers');
  });
});
