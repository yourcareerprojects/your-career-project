const {
  parseNaturallyGoodAtSummary,
  normalizeNaturallyGoodAtResult,
  formatNaturallyGoodAtAsText,
  advanceNaturallyGoodAtCoaching,
} = require('../services/profile/naturallyGoodAtCoachingService');
const {
  buildQuestionSystemPrompt,
  buildSummarySystemPrompt,
} = require('../prompts/naturallyGoodAtCoachingPrompts');
const {
  formatCoachingTurnMessage,
} = require('../services/profile/workEnjoyCoachingService');

const MOCK_CATALOG = {
  skillDomains: [
    { key: 'data_analysis', label: 'Data Analysis' },
    { key: 'client_engagement', label: 'Client Engagement' },
    { key: 'problem_solving', label: 'Problem Solving' },
    { key: 'team_leadership', label: 'Team Leadership' },
    { key: 'communication', label: 'Communication' },
  ],
};

const loadMockCatalog = async () => MOCK_CATALOG;

describe('naturallyGoodAtCoachingService', () => {
  describe('parseNaturallyGoodAtSummary', () => {
    it('parses JSON strengths and skill domains', () => {
      const result = parseNaturallyGoodAtSummary(JSON.stringify({
        strengths: [
          'Zusammenhänge schnell verstehen',
          'ruhig auf Probleme reagieren',
          'Ideen klar erklären',
          'Details zuverlässig beachten',
          'Gruppen strukturiert führen',
        ],
        skillDomains: ['Data Analysis', 'Problem Solving', 'Communication'],
      }), MOCK_CATALOG.skillDomains);
      expect(result.strengths).toHaveLength(5);
      expect(result.skillDomains).toEqual(['Data Analysis', 'Problem Solving', 'Communication']);
    });

    it('trims strengths to max six words', () => {
      const result = normalizeNaturallyGoodAtResult(parseNaturallyGoodAtSummary(JSON.stringify({
        strengths: ['Eine sehr lange und komplizierte Formulierung hier drin'],
        skillDomains: ['Data Analysis', 'Problem Solving', 'Communication'],
      }), MOCK_CATALOG.skillDomains));
      expect(result.strengths[0].split(/\s+/)).toHaveLength(6);
    });
  });

  describe('formatNaturallyGoodAtAsText', () => {
    it('joins strengths with newlines', () => {
      const text = formatNaturallyGoodAtAsText({
        strengths: ['A', 'B'],
      });
      expect(text).toBe('A\nB');
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
      expect(prompt).toContain('Berufscoach für Jugendliche');
      expect(prompt).toContain('von Natur aus gut');
      expect(prompt).toContain('Leichtigkeit & Vergleich');
    });

    it('assigns a distinct exploration focus per question number', () => {
      const q1 = buildQuestionSystemPrompt({
        audience: 'pupil',
        lang: 'de',
        seniority: { currentStatus: 'pupil' },
        questionNumber: 1,
      });
      const q2 = buildQuestionSystemPrompt({
        audience: 'pupil',
        lang: 'de',
        seniority: { currentStatus: 'pupil' },
        questionNumber: 2,
      });
      const q3 = buildQuestionSystemPrompt({
        audience: 'pupil',
        lang: 'de',
        seniority: { currentStatus: 'pupil' },
        questionNumber: 3,
      });
      expect(q1).toContain('Leichtigkeit & Vergleich');
      expect(q2).toContain('Hilfe von anderen');
      expect(q3).toContain('Natürliches Sicherheitsgefühl');
      expect(q2).not.toContain('Leichtigkeit & Vergleich');
    });

    it('includes synthesis rules in the summary prompt', () => {
      const prompt = buildSummarySystemPrompt({
        audience: 'pupil',
        lang: 'de',
        seniority: { currentStatus: 'pupil' },
        skillDomainCatalog: 'Data Analysis, Communication',
      });
      expect(prompt).toContain('Natürliche Stärken');
      expect(prompt).toContain('Passende Stärken');
      expect(prompt).toContain('Data Analysis, Communication');
      expect(prompt).toContain('keine Schulfächer');
      expect(prompt).toContain('kreativ');
    });
  });

  describe('formatCoachingTurnMessage', () => {
    it('keeps encouragement plus pivot question on later turns', () => {
      const text = 'Super! Wobei bitten dich andere um Hilfe?';
      expect(formatCoachingTurnMessage(text, { allowPreamble: true }))
        .toBe('Super! Wobei bitten dich andere um Hilfe?');
    });
  });

  describe('advanceNaturallyGoodAtCoaching', () => {
    const seniority = { currentStatus: 'pupil', highestDegree: 'none' };

    it('returns the first question when messages are empty', async () => {
      const llm = jest.fn(async () => ({ text: 'Was fällt dir leichter als anderen in deinem Alter?' }));
      const result = await advanceNaturallyGoodAtCoaching({ seniority, messages: [], lang: 'de', llm });
      expect(result.phase).toBe('question');
      expect(result.message.content).toContain('leichter');
      expect(llm).toHaveBeenCalledTimes(1);
    });

    it('returns summary after three user answers', async () => {
      const llm = jest.fn(async ({ messages }) => {
        const isSummary = messages.some((m) => m.role === 'system' && m.content.includes('Natürliche Stärken'));
        if (isSummary) {
          return {
            text: JSON.stringify({
              strengths: ['A', 'B', 'C', 'D', 'E'],
              skillDomains: ['Data Analysis', 'Problem Solving', 'Communication'],
            }),
          };
        }
        return { text: 'Wann hast du das Gefühl: „Das kann ich einfach“?' };
      });
      const messages = [
        { role: 'assistant', content: 'Frage 1?' },
        { role: 'user', content: 'Antwort 1' },
        { role: 'assistant', content: 'Frage 2?' },
        { role: 'user', content: 'Antwort 2' },
        { role: 'assistant', content: 'Frage 3?' },
        { role: 'user', content: 'Antwort 3' },
      ];
      const result = await advanceNaturallyGoodAtCoaching({
        seniority,
        messages,
        lang: 'de',
        llm,
        loadSkillDomainCatalog: loadMockCatalog,
      });
      expect(result.phase).toBe('summary');
      expect(result.strengths).toHaveLength(5);
      expect(result.skillDomains).toEqual(['Data Analysis', 'Problem Solving', 'Communication']);
    });

    it('rejects requesting another question before answering', async () => {
      await expect(advanceNaturallyGoodAtCoaching({
        seniority,
        messages: [{ role: 'assistant', content: 'Frage 1?' }],
        lang: 'de',
        llm: jest.fn(),
      })).rejects.toThrow(/answer the current question/i);
    });
  });
});
