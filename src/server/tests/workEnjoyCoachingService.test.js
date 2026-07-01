const {
  resolveWorkEnjoyCoachingAudience,
  parseActivitiesFromText,
  extractSingleCoachingQuestion,
  formatCoachingTurnMessage,
  advanceWorkEnjoyCoaching,
  normalizeCoachingLang,
} = require('../services/profile/workEnjoyCoachingService');
const { buildQuestionSystemPrompt, buildQuestionTurnUserMessage } = require('../prompts/workEnjoyCoachingPrompts');

describe('workEnjoyCoachingService', () => {
  describe('resolveWorkEnjoyCoachingAudience', () => {
    it('classifies pupils and students', () => {
      expect(resolveWorkEnjoyCoachingAudience({ currentStatus: 'pupil' })).toBe('pupil');
      expect(resolveWorkEnjoyCoachingAudience({ currentStatus: 'student' })).toBe('student');
      expect(resolveWorkEnjoyCoachingAudience({
        currentStatus: 'employed',
        highestDegree: 'realschulabschluss',
        yearsOfExperience: 0,
      })).toBe('pupil');
    });

    it('classifies career stages from seniority signals', () => {
      expect(resolveWorkEnjoyCoachingAudience({
        currentStatus: 'employed',
        yearsOfExperience: 2,
        mostSeniorWorkExperience: 'entry_level',
        highestDegree: 'bachelors',
      })).toBe('early_career');

      expect(resolveWorkEnjoyCoachingAudience({
        currentStatus: 'employed',
        yearsOfExperience: 8,
        mostSeniorWorkExperience: 'mid_level',
        highestDegree: 'bachelors',
      })).toBe('mid_career');

      expect(resolveWorkEnjoyCoachingAudience({
        currentStatus: 'employed',
        yearsOfExperience: 15,
        mostSeniorWorkExperience: 'director',
        highestDegree: 'masters',
      })).toBe('senior');
    });
  });

  describe('parseActivitiesFromText', () => {
    it('parses JSON activities and trims long items', () => {
      const activities = parseActivitiesFromText(JSON.stringify({
        activities: [
          'Dinge organisieren',
          'Probleme logisch lösen',
          'Mit Menschen sprechen',
          'Etwas praktisch bauen',
          'Ideen visuell darstellen und erklären zusätzlich',
        ],
      }));
      expect(activities).toHaveLength(5);
      expect(activities[4].split(/\s+/)).toHaveLength(6);
    });
  });

  describe('extractSingleCoachingQuestion', () => {
    it('keeps only the first question when the model returns two', () => {
      const text = 'Welche Rolle hast du in Gruppen? Was machst du gern am Computer?';
      expect(extractSingleCoachingQuestion(text)).toBe('Welche Rolle hast du in Gruppen?');
    });

    it('prefers the question line when multiple lines are returned', () => {
      const text = 'Hier ist deine Frage:\nWas machst du aktiv am Handy?';
      expect(extractSingleCoachingQuestion(text)).toBe('Was machst du aktiv am Handy?');
    });
  });

  describe('formatCoachingTurnMessage', () => {
    it('keeps a motivating preamble plus the new-topic question', () => {
      const text = 'Das klingt richtig gut! Welche Rolle übernimmst du in Gruppen?';
      expect(formatCoachingTurnMessage(text, { allowPreamble: true }))
        .toBe('Das klingt richtig gut! Welche Rolle übernimmst du in Gruppen?');
    });

    it('drops follow-up questions but keeps encouragement before the pivot question', () => {
      const text = 'Super! Was magst du am Fußball am liebsten? Welche Rolle übernimmst du in Gruppen?';
      expect(formatCoachingTurnMessage(text, { allowPreamble: true }))
        .toBe('Super! Welche Rolle übernimmst du in Gruppen?');
    });

    it('strips preamble for the first question', () => {
      const text = 'Schön! Was machst du gern in der Freizeit?';
      expect(formatCoachingTurnMessage(text, { allowPreamble: false }))
        .toBe('Was machst du gern in der Freizeit?');
    });
  });

  describe('language handling', () => {
    it('uses German instructions in the question prompt for lang=de', () => {
      const prompt = buildQuestionSystemPrompt({
        audience: 'pupil',
        lang: 'de',
        seniority: { currentStatus: 'pupil' },
        questionNumber: 1,
      });
      expect(prompt).toContain('Antworte ausschließlich auf Deutsch');
      expect(prompt).toContain('Du bist ein erfahrener Berufscoach');
    });

    it('assigns a distinct exploration focus per question number', () => {
      const q1 = buildQuestionSystemPrompt({
        audience: 'early_career',
        lang: 'de',
        seniority: { currentStatus: 'employed' },
        questionNumber: 1,
      });
      const q2 = buildQuestionSystemPrompt({
        audience: 'early_career',
        lang: 'de',
        seniority: { currentStatus: 'employed' },
        questionNumber: 2,
      });
      const q3 = buildQuestionSystemPrompt({
        audience: 'early_career',
        lang: 'de',
        seniority: { currentStatus: 'employed' },
        questionNumber: 3,
      });
      expect(q1).toContain('Tätigkeiten & Energie');
      expect(q2).toContain('Menschen & Zusammenarbeit');
      expect(q3).toContain('Denken & Herausforderungen');
      expect(q1).toContain('nur die eine Frage');
      expect(q2).toContain('motivierenden Satz');
      expect(q2).not.toContain('Tätigkeiten & Energie');
      expect(q3).not.toContain('Menschen & Zusammenarbeit');
    });

    it('asks for encouragement then a pivot question on later turns', () => {
      const turn = buildQuestionTurnUserMessage({
        lang: 'de',
        questionNumber: 2,
        messages: [
          { role: 'assistant', content: 'Was machst du gern in der Freizeit?' },
          { role: 'user', content: 'Ich spiele Fußball und male gern.' },
        ],
      });
      expect(turn).toContain('Menschen & Zusammenarbeit');
      expect(turn).toContain('ermutigender Satz');
      expect(turn).toContain('Fußball');
      expect(turn).toContain('deutlich vom vorherigen Bereich');
    });

    it('normalizes coaching language to de or en', () => {
      expect(normalizeCoachingLang('de-DE')).toBe('de');
      expect(normalizeCoachingLang('en-US')).toBe('en');
      expect(normalizeCoachingLang(undefined)).toBe('de');
    });

    it('includes CV context block in question prompt when cvContext is provided', () => {
      const prompt = buildQuestionSystemPrompt({
        audience: 'early_career',
        lang: 'en',
        seniority: { currentStatus: 'employed', yearsOfExperience: 3 },
        questionNumber: 1,
        cvContext: {
          structuredUserInfo: { keyResponsibilities: ['Project management'] },
          identityHints: { workEnjoyMost: 'Leading teams' },
        },
      });
      expect(prompt).toContain('CV');
      expect(prompt).toContain('Project management');
      expect(prompt).toContain('hypothesis');
    });
  });

  describe('advanceWorkEnjoyCoaching', () => {
    const seniority = {
      currentStatus: 'pupil',
      highestDegree: 'realschulabschluss',
      yearsOfExperience: 0,
      mostSeniorWorkExperience: 'intern',
    };

    it('returns the first question when history is empty', async () => {
      const result = await advanceWorkEnjoyCoaching({
        seniority,
        messages: [],
        lang: 'de',
        llm: async () => ({ text: 'Welche Rolle übernimmst du in Gruppen?' }),
      });
      expect(result.phase).toBe('question');
      expect(result.questionIndex).toBe(1);
      expect(result.message.content).toContain('Gruppen');
    });

    it('returns summary after three user answers', async () => {
      const messages = [
        { role: 'assistant', content: 'Frage 1' },
        { role: 'user', content: 'Antwort 1' },
        { role: 'assistant', content: 'Frage 2' },
        { role: 'user', content: 'Antwort 2' },
        { role: 'assistant', content: 'Frage 3' },
        { role: 'user', content: 'Antwort 3' },
      ];
      const result = await advanceWorkEnjoyCoaching({
        seniority,
        messages,
        lang: 'de',
        llm: async () => ({
          text: JSON.stringify({
            activities: [
              'Dinge organisieren',
              'Probleme logisch lösen',
              'Mit Menschen sprechen',
              'Etwas praktisch bauen',
              'Ideen erklären',
            ],
          }),
        }),
      });
      expect(result.phase).toBe('summary');
      expect(result.complete).toBe(true);
      expect(result.activities).toHaveLength(5);
    });

    it('rejects another question before the user answers', async () => {
      await expect(advanceWorkEnjoyCoaching({
        seniority,
        messages: [{ role: 'assistant', content: 'Frage 1' }],
        lang: 'de',
        llm: async () => ({ text: 'noop' }),
      })).rejects.toThrow(/answer the current/i);
    });

    it('advances through question turns', async () => {
      const calls = [];
      const llm = async ({ messages }) => {
        calls.push(messages);
        if (calls.length === 1) return { text: 'Frage 2?' };
        return { text: 'unused' };
      };
      const result = await advanceWorkEnjoyCoaching({
        seniority,
        messages: [
          { role: 'assistant', content: 'Frage 1?' },
          { role: 'user', content: 'Antwort 1' },
        ],
        lang: 'de',
        llm,
      });
      expect(result.questionIndex).toBe(2);
      expect(result.message.content).toBe('Frage 2?');
      expect(calls.length).toBe(1);
      expect(calls[0]).toHaveLength(2);
      expect(calls[0][0].role).toBe('system');
      expect(calls[0][1].role).toBe('user');
      expect(calls[0][1].content).toContain('ermutigender Satz');
      expect(calls[0][1].content).toContain('Antwort 1');
    });

    it('limits question count', async () => {
      const messages = [
        { role: 'assistant', content: 'Q1' },
        { role: 'user', content: 'A1' },
        { role: 'assistant', content: 'Q2' },
        { role: 'user', content: 'A2' },
        { role: 'assistant', content: 'Q3' },
        { role: 'user', content: 'A3' },
        { role: 'user', content: 'extra' },
      ];
      await expect(advanceWorkEnjoyCoaching({
        seniority,
        messages,
        lang: 'de',
        llm: async () => ({ text: 'x' }),
      })).rejects.toThrow(/too many/i);
    });
  });
});
