const User = require('../models/User');
const localizedContentService = require('../services/localization/localizedContentService');
const {
  enrichProfileForNarrativeChecks,
  getProfileDisplayNarrativesReadiness,
} = require('../services/profile/profileNarrativeReadinessService');
const {
  refreshDeferredWhoAreYouOnUser,
  scheduleDeferredProfileNarrativesForUser,
} = require('../services/profile/deferredProfileNarrativeService');
const { PLACEHOLDER: WHO_ARE_YOU_PLACEHOLDER } = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');

describe('deferred profile narrative generation', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test('enrichProfileForNarrativeChecks derives raw_answers from cvExtractLocalization when stored answers are empty', () => {
    const enriched = enrichProfileForNarrativeChecks({
      cvExtractLocalization: {
        userIdentity: {
          workEnjoyMost: { en: 'Building products', de: 'Produkte entwickeln' },
        },
      },
      who_are_you: {
        raw_answers: [],
        summary_text: JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER)),
      },
    }, 'en');

    expect(enriched.who_are_you.raw_answers[0]).toBe('Building products');
    const readiness = getProfileDisplayNarrativesReadiness(enriched, 'en');
    expect(readiness.ready).toBe(false);
    expect(readiness.pending).toContain('who_are_you');
  });

  test('enrichProfileForNarrativeChecks derives raw_answers from userIdentityAnswers', () => {
    const enriched = enrichProfileForNarrativeChecks({
      userIdentityAnswers: {
        workEnjoyMost: 'Building products',
      },
      who_are_you: {
        raw_answers: [],
        summary_text: JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER)),
      },
    });

    expect(enriched.who_are_you.raw_answers[0]).toBe('Building products');
    const readiness = getProfileDisplayNarrativesReadiness(enriched, 'en');
    expect(readiness.ready).toBe(false);
    expect(readiness.pending).toContain('who_are_you');
  });

  test('enrichProfileForNarrativeChecks uses careerSimulationInputs identity when stored answers are empty', () => {
    const enriched = enrichProfileForNarrativeChecks({
      careerSimulationInputs: {
        userIdentity: {
          workEnjoyMost: 'Leading teams',
        },
      },
      who_are_you: {
        raw_answers: [],
        summary_text: JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER)),
      },
    });

    expect(enriched.who_are_you.raw_answers[0]).toBe('Leading teams');
    const readiness = getProfileDisplayNarrativesReadiness(enriched, 'en');
    expect(readiness.ready).toBe(false);
    expect(readiness.pending).toContain('who_are_you');
  });

  test('refreshDeferredWhoAreYouOnUser generates narratives when only userIdentityAnswers exist', async () => {
    delete process.env.OPENAI_API_KEY;

    const created = await User.create({
      email: 'deferred-who-identity-only@example.com',
      password: 'password123!',
      profile: {
        userIdentityAnswers: {
          workEnjoyMost: 'Leading cross-functional product teams',
          topicsIndustriesInterest: 'Technology and education',
          naturallyGoodAt: 'Synthesizing complex ideas',
          workEnvironmentFit: 'Collaborative remote teams',
          workingLifeAchievement: 'Ship meaningful products',
        },
        who_are_you: {
          raw_answers: [],
          summary_text: JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER)),
        },
      },
    });

    const user = await User.findById(created._id);
    await refreshDeferredWhoAreYouOnUser(user, { language: 'en', sourceLanguage: 'en' });
    await user.save();

    const persisted = await User.findById(created._id).lean();
    const summaryRaw = String(
      localizedContentService.get(persisted.profile.who_are_you.summary_text, 'en') || ''
    ).trim();
    expect(summaryRaw).not.toBe('');
    const parsed = JSON.parse(summaryRaw);
    expect(parsed).toHaveLength(5);
    expect(parsed.some((line) => line && line !== WHO_ARE_YOU_PLACEHOLDER)).toBe(true);
    expect(persisted.profile.who_are_you.raw_answers.some(Boolean)).toBe(true);
  });

  test('refreshDeferredWhoAreYouOnUser replaces placeholder de translation from en canonical', async () => {
    delete process.env.OPENAI_API_KEY;

    const enNarratives = JSON.stringify([
      'You engage actively with guests and foster collaboration among team members.',
      'You are drawn to hospitality and guest experience topics.',
      'You are naturally good at communication and planning.',
      'You thrive in collaborative team environments.',
      'You want to build a career around meaningful guest experiences.',
    ]);
    const placeholderDe = JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER));
    const identityAnswers = {
      workEnjoyMost: 'Guest service and teamwork',
      topicsIndustriesInterest: 'Hospitality',
      naturallyGoodAt: 'Communication',
      workEnvironmentFit: 'Collaborative teams',
      workingLifeAchievement: 'Meaningful guest experiences',
    };

    const created = await User.create({
      email: 'deferred-placeholder-de@example.com',
      password: 'password123!',
      profile: {
        userIdentityAnswers: identityAnswers,
        who_are_you: {
          raw_answers: Object.values(identityAnswers),
          summary_text: {
            original_language: 'en',
            original: enNarratives,
            translations: { en: enNarratives, de: placeholderDe },
          },
        },
      },
    });

    const user = await User.findById(created._id);
    await refreshDeferredWhoAreYouOnUser(user, { language: 'de', sourceLanguage: 'en' });
    await user.save();

    const deSummary = String(
      localizedContentService.get(user.profile.who_are_you.summary_text, 'de') || ''
    ).trim();
    expect(deSummary).not.toBe(placeholderDe);
    const parsed = JSON.parse(deSummary);
    expect(parsed[0]).not.toBe(WHO_ARE_YOU_PLACEHOLDER);
  });

  test('refreshDeferredWhoAreYouOnUser backfills missing UI-language translation', async () => {
    delete process.env.OPENAI_API_KEY;

    const deNarratives = JSON.stringify([
      'Sie leiten Teams mit klarem Fokus auf Lieferung.',
      'No personal profile information available yet.',
      'No personal profile information available yet.',
      'No personal profile information available yet.',
      'No personal profile information available yet.',
    ]);
    const created = await User.create({
      email: 'deferred-translation-backfill@example.com',
      password: 'password123!',
      profile: {
        userIdentityAnswers: {
          workEnjoyMost: 'Leading cross-functional product teams',
        },
        who_are_you: {
          raw_answers: ['Leading cross-functional product teams', '', '', '', ''],
          summary_text: {
            original_language: 'de',
            original: deNarratives,
            translations: { de: deNarratives },
          },
        },
      },
    });

    const user = await User.findById(created._id);
    await refreshDeferredWhoAreYouOnUser(user, { language: 'en', sourceLanguage: 'de' });
    await user.save();

    const enSummary = String(
      localizedContentService.get(user.profile.who_are_you.summary_text, 'en') || ''
    ).trim();
    expect(enSummary).not.toBe('');
    const parsed = JSON.parse(enSummary);
    expect(parsed[0]).not.toBe('No personal profile information available yet.');
  });

  test('scheduleDeferredProfileNarrativesForUser persists who_are_you narratives end-to-end', async () => {
    delete process.env.OPENAI_API_KEY;

    const created = await User.create({
      email: 'deferred-schedule-e2e@example.com',
      password: 'password123!',
      profile: {
        userIdentityAnswers: {
          workEnjoyMost: 'Designing scalable software architecture',
        },
        who_are_you: {
          summary_text: JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER)),
        },
        structuredUserInfo: {
          skills: {
            raw_items: ['TypeScript'],
            summary_text: 'No information available yet',
          },
        },
      },
    });

    await new Promise((resolve, reject) => {
      scheduleDeferredProfileNarrativesForUser(String(created._id), {
        dimensionKeys: ['skills'],
        deferWhoAreYou: true,
        language: 'en',
        sourceLanguage: 'en',
      });
      const check = async () => {
        for (let i = 0; i < 40; i += 1) {
          const user = await User.findById(created._id).lean();
          const whoSummary = String(
            localizedContentService.get(user.profile.who_are_you.summary_text, 'en') || ''
          ).trim();
          const skillsSummary = String(
            localizedContentService.get(user.profile.structuredUserInfo.skills.summary_text, 'en') || ''
          ).trim();
          const whoReady = whoSummary && whoSummary !== JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER));
          const skillsReady = skillsSummary && skillsSummary !== 'No information available yet';
          if (whoReady && skillsReady) {
            resolve();
            return;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        reject(new Error('Deferred narrative job did not persist in time'));
      };
      void check();
    });

    const persisted = await User.findById(created._id).lean();
    const skillsSummary = String(
      localizedContentService.get(persisted.profile.structuredUserInfo.skills.summary_text, 'en') || ''
    ).trim();
    expect(skillsSummary).not.toBe('No information available yet');
  });
});
