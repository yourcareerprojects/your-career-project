const {
  assessMissingFields,
  parseEnrichmentResponse,
  mergeEnrichmentIntoContext,
  enrichCareerContext,
  isCachedEnrichmentFresh,
  ENRICHMENT_SOURCE_VERSION,
  _inflightByKey,
} = require('../services/profile/careerPathPlanning/careerKnowledgeEnrichmentService');

const {
  buildEnrichmentSystemPrompt,
} = require('../prompts/careerKnowledgeEnrichmentPrompts');

const {
  formatCareerContextForPrompt,
} = require('../services/profile/careerPathPlanning/careerContextBuilder');

function baseContext(overrides = {}) {
  return {
    career: {
      title: 'Nurse',
      description: 'Provides patient care.',
      typicalTasks: ['Monitor patients'],
      requiredSkills: ['empathy'],
      workEnvironment: [],
      salary: {},
      educationLevel: '',
      isco: '2221',
      esco: 'http://data.europa.eu/esco/occupation/nurse',
      onet: '',
    },
    educationRoutes: [],
    careerProgression: [],
    alternativePaths: [],
    enrichment: null,
    meta: {
      lang: 'en',
      sources: ['application', 'esco'],
      foundInDatabase: true,
      careerPathId: '507f1f77bcf86cd799439011',
    },
    ...overrides,
  };
}

describe('careerKnowledgeEnrichmentService', () => {
  afterEach(() => {
    _inflightByKey.clear();
  });

  it('parses enrichment JSON with factual fields only', () => {
    const result = parseEnrichmentResponse(JSON.stringify({
      applicationTimeline: 'Apply in autumn before graduation.',
      apprenticeshipDuration: '',
      schoolSubjects: ['Biology', 'Chemistry'],
      recommendedExperience: ['Hospital internship'],
      softSkills: ['Empathy', 'Resilience'],
      motivation: 'You can do it!', // must be ignored if present
    }), { lang: 'en' });

    expect(result.ok).toBe(true);
    expect(result.data.applicationTimeline).toContain('autumn');
    expect(result.data.schoolSubjects).toEqual(['Biology', 'Chemistry']);
    expect(result.data.motivation).toBeUndefined();
  });

  it('assesses missing enrichment fields from a sparse context', () => {
    const missing = assessMissingFields(baseContext());
    expect(missing).toEqual(expect.arrayContaining([
      'applicationTimeline',
      'schoolSubjects',
      'recommendedExperience',
      'careerProgression',
    ]));
  });

  it('merges enrichment without overwriting existing structured data', () => {
    const merged = mergeEnrichmentIntoContext(
      baseContext({
        career: {
          ...baseContext().career,
          workEnvironment: ['Hospital wards'],
        },
        careerProgression: ['Senior nurse'],
      }),
      {
        workingEnvironments: ['Clinic', 'Home care'],
        careerProgression: ['Ward manager'],
        schoolSubjects: ['Biology'],
        applicationTimeline: 'Often start applications one year ahead.',
        softSkills: ['Empathy'],
      }
    );

    expect(merged.career.workEnvironment).toEqual(['Hospital wards']);
    expect(merged.careerProgression).toEqual(['Senior nurse']);
    expect(merged.enrichment.schoolSubjects).toEqual(['Biology']);
    expect(merged.enrichment.applicationTimeline).toContain('one year');
    expect(merged.meta.sources).toContain('career_knowledge_enrichment');
  });

  it('uses cached enrichment and skips the LLM', async () => {
    const llm = jest.fn();
    const readCache = jest.fn().mockResolvedValue({
      applicationTimeline: 'Cached timeline',
      schoolSubjects: ['Biology'],
      recommendedExperience: [],
      commonEmployers: [],
      workingEnvironments: [],
      furtherEducation: [],
      studyOptions: [],
      certifications: [],
      careerProgression: [],
      specializationOptions: [],
      industryInsights: [],
      softSkills: [],
      firstCareerSteps: [],
      alternativePathways: [],
      apprenticeshipDuration: '',
      sourceVersion: ENRICHMENT_SOURCE_VERSION,
      lang: 'en',
      built_with: 'llm',
    });
    const writeCache = jest.fn();

    const result = await enrichCareerContext({
      careerContext: baseContext(),
      lang: 'en',
      llm,
      readCache,
      writeCache,
    });

    expect(llm).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
    expect(result.enrichment.applicationTimeline).toBe('Cached timeline');
    expect(result.meta.enrichmentCached).toBe(true);
  });

  it('calls the LLM once, persists cache, and returns enriched context', async () => {
    const llm = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        applicationTimeline: 'Apply early in the school year.',
        apprenticeshipDuration: 'Typically 3 years for related assistant roles',
        schoolSubjects: ['Biology'],
        recommendedExperience: ['Volunteer in care'],
        commonEmployers: ['Hospitals'],
        workingEnvironments: ['Wards'],
        furtherEducation: ['Specialist nursing courses'],
        studyOptions: ['Nursing bachelor later'],
        certifications: [],
        careerProgression: ['Senior nurse', 'Ward lead'],
        specializationOptions: ['Pediatrics'],
        industryInsights: ['Growing demand for nursing staff'],
        softSkills: ['Empathy'],
        firstCareerSteps: ['Nursing school / Ausbildung'],
        alternativePathways: ['Healthcare assistant first'],
      }),
    });
    const writeCache = jest.fn().mockResolvedValue({});
    const readCache = jest.fn().mockResolvedValue(null);

    const result = await enrichCareerContext({
      careerContext: baseContext(),
      lang: 'en',
      llm,
      readCache,
      writeCache,
    });

    expect(llm).toHaveBeenCalledTimes(1);
    expect(writeCache).toHaveBeenCalledTimes(1);
    expect(result.enrichment.schoolSubjects).toContain('Biology');
    expect(result.career.workEnvironment).toContain('Wards');
    expect(result.careerProgression).toContain('Senior nurse');

    const enrichmentPrompt = llm.mock.calls[0][0].messages[0].content;
    expect(enrichmentPrompt).toContain('NOT to coach');
    expect(enrichmentPrompt).toContain('Nurse');
  });

  it('marks stale sourceVersion as not fresh', () => {
    expect(isCachedEnrichmentFresh({
      applicationTimeline: 'Old',
      schoolSubjects: ['X'],
      sourceVersion: 'v0',
      lang: 'en',
    }, 'en')).toBe(false);
  });

  it('exposes enrichment facts in the coach context formatter', () => {
    const text = formatCareerContextForPrompt(mergeEnrichmentIntoContext(baseContext(), {
      applicationTimeline: 'Apply one year ahead',
      schoolSubjects: ['Biology'],
      softSkills: ['Empathy'],
    }), 'en');

    expect(text).toContain('Enriched career knowledge');
    expect(text).toContain('Apply one year ahead');
    expect(text).toContain('Biology');
  });

  it('builds an enrichment prompt that forbids coaching and roadmaps', () => {
    const prompt = buildEnrichmentSystemPrompt({
      lang: 'en',
      careerContext: baseContext(),
      missingFields: ['schoolSubjects', 'applicationTimeline'],
    });
    expect(prompt).toContain('NOT to coach');
    expect(prompt).toContain('Do not generate a roadmap');
    expect(prompt).toContain('schoolSubjects');
  });
});
