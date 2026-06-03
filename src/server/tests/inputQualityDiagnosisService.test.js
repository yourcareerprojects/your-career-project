const {
  evaluateInputFieldQuality,
  buildDeterministicDiagnosis,
  evaluateProfileReviewFollowUps,
  buildStep3ReviewTextMap,
  parseBatchScoringJson,
  parseFollowUpQuestionsJson,
  sortDiagnosesByQuality,
  REVIEW_STEP3_QUALITY_FIELD_ORDER,
  ALLOWED_ISSUES
} = require('../services/jobAnalysis/inputQualityDiagnosisService');
const { qualityDiagnosisFingerprint } = require('../utils/inputQualityDiagnosisFingerprint');
const {
  clearInputQualityDiagnosisSessionCache,
} = require('../services/jobAnalysis/inputQualityDiagnosisSessionCache');

describe('inputQualityDiagnosisService', () => {
  test('buildStep3ReviewTextMap has seven keys only', () => {
    const map = buildStep3ReviewTextMap({
      userIdentity: { workEnjoyMost: 'A' },
      structuredUserInfo: {
        skills: [{ name: 'Ignored' }],
        keyResponsibilities: ['Shipped feature'],
        skillsInDevelopment: []
      }
    });
    expect(Object.keys(map).length).toBe(7);
    expect(map['structuredUserInfo.skills']).toBeUndefined();
    expect(map['structuredUserInfo.keyResponsibilities']).toBe('Shipped feature');
  });

  test('evaluateProfileReviewFollowUps returns three items with one follow_up_question each', async () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_API_KEY');
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const { followUps } = await evaluateProfileReviewFollowUps({
      userIdentity: {
        workEnjoyMost: 'x',
        topicsIndustriesInterest: 'yy',
        naturallyGoodAt: 'zzz',
        workEnvironmentFit: 'aaaa',
        workingLifeAchievement: 'bbbbb'
      },
      structuredUserInfo: {
        keyResponsibilities: [
          'Built reporting pipelines in Python and Tableau; improved weekly decision latency for leadership.'
        ],
        skillsInDevelopment: []
      }
    });
    if (had) process.env.OPENAI_API_KEY = prev;
    expect(followUps.length).toBe(3);
    followUps.forEach((f) => {
      expect(typeof f.follow_up_question).toBe('string');
      expect(f.follow_up_question.length).toBeGreaterThan(5);
      expect(typeof f.quality_score).toBe('number');
      expect(f.field).toBeTruthy();
    });
    const scores = followUps.map((f) => f.quality_score);
    const sorted = [...scores].sort((a, b) => a - b);
    expect(scores).toEqual(sorted);
  });

  test('evaluateProfileReviewFollowUps localizes follow-up questions when lang is de', async () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_API_KEY');
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const translateFn = jest.fn(async ({ text, targetLang }) => `${targetLang.toUpperCase()}: ${text}`);
    const { followUps } = await evaluateProfileReviewFollowUps(
      {
        userIdentity: {
          workEnjoyMost: 'x',
          topicsIndustriesInterest: 'yy',
          naturallyGoodAt: 'zzz',
          workEnvironmentFit: 'aaaa',
          workingLifeAchievement: 'bbbbb'
        },
        structuredUserInfo: {
          keyResponsibilities: ['Did something'],
          skillsInDevelopment: []
        }
      },
      { lang: 'de', translateFn }
    );
    if (had) process.env.OPENAI_API_KEY = prev;
    expect(followUps.length).toBe(3);
    followUps.forEach((f) => {
      expect(f.follow_up_question.startsWith('DE: ')).toBe(true);
    });
    expect(translateFn).toHaveBeenCalled();
    expect(translateFn.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        targetLang: 'de'
      })
    );
  });

  test('ALLOWED_ISSUES matches taxonomy size', () => {
    expect(ALLOWED_ISSUES).toContain('too_short');
    expect(ALLOWED_ISSUES).toContain('inconsistent_with_other_fields');
    expect(ALLOWED_ISSUES.length).toBe(11);
  });

  test('buildDeterministicDiagnosis returns contract shape', () => {
    const d = buildDeterministicDiagnosis('keyResponsibilities', 'I did stuff.', {
      summary: 'I did stuff.'
    });
    expect(d.field).toBe('keyResponsibilities');
    expect(d).toHaveProperty('dimension_scores');
    expect(Object.keys(d.dimension_scores).sort()).toEqual(
      ['clarity', 'completeness', 'information_density', 'relevance', 'specificity'].sort()
    );
    const mean =
      (d.dimension_scores.specificity +
        d.dimension_scores.information_density +
        d.dimension_scores.clarity +
        d.dimension_scores.relevance +
        d.dimension_scores.completeness) /
      5;
    const expectedOverall = Math.round(Math.max(0, Math.min(1, mean)) * 100) / 100;
    expect(d.quality_score).toBe(expectedOverall);
    expect(d.follow_up_questions.length).toBe(3);
    d.issues.forEach((issue) => expect(ALLOWED_ISSUES).toContain(issue));
  });

  test('buildDeterministicDiagnosis flags duplicate text across fields', () => {
    const body = 'Leading cross-functional initiatives to deliver customer value at scale.';
    const d = buildDeterministicDiagnosis('domains', body, { skills: body });
    expect(d.issues).toContain('inconsistent_with_other_fields');
  });

  test('evaluateInputFieldQuality adds inconsistent_with_other_fields when duplicate across fields', async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    const body =
      'Owning roadmap prioritization and stakeholder alignment end to end across multiple quarters.';
    const llmProvider = jest.fn(async () =>
      JSON.stringify({
        field: 'domains',
        quality_score: 0.5,
        dimension_scores: {
          specificity: 0.5,
          information_density: 0.5,
          clarity: 0.5,
          relevance: 0.5,
          completeness: 0.5
        },
        issues: ['too_short'],
        follow_up_questions: ['Q1?', 'Q2?', 'Q3?']
      })
    );
    const d = await evaluateInputFieldQuality(
      { field: 'domains', text: body, otherFields: { skills: body } },
      { llmProvider }
    );
    process.env.OPENAI_API_KEY = prev;
    expect(d.issues).toContain('inconsistent_with_other_fields');
  });

  test('evaluateInputFieldQuality uses llmProvider when API key present', async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';

    const llmProvider = jest.fn(async () =>
      JSON.stringify({
        field: 'skills',
        quality_score: 0.5,
        dimension_scores: {
          specificity: 0.5,
          information_density: 0.5,
          clarity: 0.5,
          relevance: 0.5,
          completeness: 0.5
        },
        issues: ['too_short'],
        follow_up_questions: ['Q1?', 'Q2?', 'Q3?']
      })
    );

    const d = await evaluateInputFieldQuality(
      { field: 'skills', text: 'Python' },
      { llmProvider }
    );

    process.env.OPENAI_API_KEY = prev;

    expect(llmProvider).toHaveBeenCalled();
    expect(d.field).toBe('skills');
    expect(d.quality_score).toBe(0.5);
    expect(d.follow_up_questions).toEqual(['Q1?', 'Q2?', 'Q3?']);
  });

  test('evaluateInputFieldQuality uses heuristics when OPENAI_API_KEY is missing', async () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_API_KEY');
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const d = await evaluateInputFieldQuality({ field: 'skills', text: '' });
    if (had) process.env.OPENAI_API_KEY = prev;
    expect(d.issues).toContain('too_short');
    expect(d.follow_up_questions.length).toBe(3);
  });

  test('evaluateInputFieldQuality pads follow-ups when LLM returns too few', async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';

    const llmProvider = jest.fn(async () =>
      JSON.stringify({
        field: 'skills',
        quality_score: 0.4,
        dimension_scores: {
          specificity: 0.4,
          information_density: 0.4,
          clarity: 0.4,
          relevance: 0.4,
          completeness: 0.4
        },
        issues: ['too_short', 'no_tools_or_methods'],
        follow_up_questions: ['Only one?']
      })
    );

    const d = await evaluateInputFieldQuality({ field: 'skills', text: 'x' }, { llmProvider });
    process.env.OPENAI_API_KEY = prev;

    expect(d.follow_up_questions.length).toBe(3);
  });

  test('parseBatchScoringJson requires all seven fields', () => {
    const sections = REVIEW_STEP3_QUALITY_FIELD_ORDER.map((field, i) => {
      const score = Math.round(Math.max(0, Math.min(1, 0.12 + i * 0.08)) * 100) / 100;
      return {
        field,
        quality_score: score,
        dimension_scores: {
          specificity: score,
          information_density: score,
          clarity: score,
          relevance: score,
          completeness: score
        },
        issues: ['too_short']
      };
    });
    const parsed = parseBatchScoringJson(JSON.stringify({ sections }), REVIEW_STEP3_QUALITY_FIELD_ORDER);
    expect(parsed).toHaveLength(7);
    expect(sortDiagnosesByQuality(parsed)[0].field).toBe(REVIEW_STEP3_QUALITY_FIELD_ORDER[0]);
  });

  test('parseFollowUpQuestionsJson accepts follow_up_questions array', () => {
    const qs = parseFollowUpQuestionsJson(
      JSON.stringify({ follow_up_questions: ['A?', 'B?', 'C?'] }),
      'skills'
    );
    expect(qs).toEqual(['A?', 'B?', 'C?']);
  });

  test('evaluateProfileReviewFollowUps uses heuristic scoring plus three follow-up LLM calls', async () => {
    clearInputQualityDiagnosisSessionCache();
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';

    const llmProvider = jest.fn(async (messages) => {
      const user = JSON.parse(messages.find((m) => m.role === 'user').content);
      expect(user.sections).toBeUndefined();
      expect(REVIEW_STEP3_QUALITY_FIELD_ORDER).toContain(user.field);
      return JSON.stringify({
        field: user.field,
        follow_up_questions: [`Q1 for ${user.field}?`, 'Q2?', 'Q3?']
      });
    });

    const { followUps } = await evaluateProfileReviewFollowUps(
      {
        userIdentity: {
          workEnjoyMost: 'x',
          topicsIndustriesInterest: 'yy',
          naturallyGoodAt: 'zzz',
          workEnvironmentFit: 'aaaa',
          workingLifeAchievement: 'bbbbb'
        },
        structuredUserInfo: {
          keyResponsibilities: ['Built pipelines in Python'],
          skillsInDevelopment: []
        }
      },
      { llmProvider, userId: 'batch-test-user', lang: 'en' }
    );

    process.env.OPENAI_API_KEY = prev;
    expect(llmProvider).toHaveBeenCalledTimes(3);

    const cachedRun = await evaluateProfileReviewFollowUps(
      {
        userIdentity: {
          workEnjoyMost: 'x',
          topicsIndustriesInterest: 'yy',
          naturallyGoodAt: 'zzz',
          workEnvironmentFit: 'aaaa',
          workingLifeAchievement: 'bbbbb',
        },
        structuredUserInfo: {
          keyResponsibilities: ['Built pipelines in Python'],
          skillsInDevelopment: [],
        },
      },
      { llmProvider, userId: 'batch-test-user', lang: 'en' }
    );
    expect(cachedRun.cached).toBe(true);
    expect(llmProvider).toHaveBeenCalledTimes(3);

    expect(followUps).toHaveLength(3);
    followUps.forEach((f) => {
      expect(REVIEW_STEP3_QUALITY_FIELD_ORDER).toContain(f.field);
      expect(f.follow_up_question).toMatch(/^Q1 for /);
    });
  });

  test('server and client diagnosis fingerprints match for same profile', () => {
    const { qualityDiagnosisFingerprint: clientFp } = require('../../client/utils/inputQualityDiagnosisCache');
    const snapshot = {
      userIdentity: { workEnjoyMost: 'design systems' },
      structuredUserInfo: {
        keyResponsibilities: ['Shipped analytics'],
        skillsInDevelopment: ['Rust'],
      },
    };
    expect(qualityDiagnosisFingerprint(snapshot, 'de')).toBe(clientFp(snapshot, 'de'));
  });

  test('evaluateProfileReviewFollowUps returns cached result for same user and content', async () => {
    clearInputQualityDiagnosisSessionCache();
    const had = Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_API_KEY');
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const snapshot = {
      userIdentity: {
        workEnjoyMost: 'x',
        topicsIndustriesInterest: 'yy',
        naturallyGoodAt: 'zzz',
        workEnvironmentFit: 'aaaa',
        workingLifeAchievement: 'bbbbb',
      },
      structuredUserInfo: {
        keyResponsibilities: ['Did something'],
        skillsInDevelopment: [],
      },
    };

    const first = await evaluateProfileReviewFollowUps(snapshot, { userId: 'user-cache-test', lang: 'en' });
    const second = await evaluateProfileReviewFollowUps(snapshot, { userId: 'user-cache-test', lang: 'en' });

    if (had) process.env.OPENAI_API_KEY = prev;
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.followUps).toEqual(first.followUps);
  });

  test('evaluateProfileReviewFollowUps session cache is per user', async () => {
    clearInputQualityDiagnosisSessionCache();
    const had = Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_API_KEY');
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const snapshot = {
      userIdentity: {
        workEnjoyMost: 'shared text',
        topicsIndustriesInterest: 'yy',
        naturallyGoodAt: 'zzz',
        workEnvironmentFit: 'aaaa',
        workingLifeAchievement: 'bbbbb',
      },
      structuredUserInfo: { keyResponsibilities: ['R'], skillsInDevelopment: [] },
    };

    await evaluateProfileReviewFollowUps(snapshot, { userId: 'user-a', lang: 'en' });
    const forB = await evaluateProfileReviewFollowUps(snapshot, { userId: 'user-b', lang: 'en' });

    if (had) process.env.OPENAI_API_KEY = prev;
    expect(forB.cached).toBe(false);
  });

  test('evaluateProfileReviewFollowUps normalizes each section once', async () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_API_KEY');
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    jest.resetModules();
    const normalizeSpy = jest.fn(async (text) => text);
    jest.doMock('../services/ai/normalizeForProcessing', () => ({
      normalizeForProcessing: normalizeSpy
    }));
    const { evaluateProfileReviewFollowUps: evaluateFollowUps } = require(
      '../services/jobAnalysis/inputQualityDiagnosisService'
    );

    await evaluateFollowUps(
      {
        userIdentity: {
          workEnjoyMost: 'x',
          topicsIndustriesInterest: 'yy',
          naturallyGoodAt: 'zzz',
          workEnvironmentFit: 'aaaa',
          workingLifeAchievement: 'bbbbb'
        },
        structuredUserInfo: {
          keyResponsibilities: ['Did something'],
          skillsInDevelopment: []
        }
      },
      { lang: 'de' }
    );

    if (had) process.env.OPENAI_API_KEY = prev;
    expect(normalizeSpy).toHaveBeenCalledTimes(7);
    jest.resetModules();
  });
});
