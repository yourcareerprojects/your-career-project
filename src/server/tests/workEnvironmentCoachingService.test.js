const {
  parseWorkEnvironmentSummary,
  normalizeWorkEnvironmentResult,
  formatWorkEnvironmentAsText,
  advanceWorkEnvironmentCoaching,
} = require('../services/profile/workEnvironmentCoachingService');
const {
  buildQuestionSystemPrompt,
  buildQuestionTurnUserMessage,
  buildSummarySystemPrompt,
} = require('../prompts/workEnvironmentCoachingPrompts');
const {
  formatCoachingTurnMessage,
} = require('../services/profile/workEnjoyCoachingService');

describe('workEnvironmentCoachingService', () => {
  describe('parseWorkEnvironmentSummary', () => {
    it('parses JSON work styles and environments', () => {
      const result = parseWorkEnvironmentSummary(JSON.stringify({
        workStyles: [
          'Aufgaben eigenständig strukturieren',
          'Ideen im Austausch entwickeln',
          'Schritt für Schritt nach Plan arbeiten',
          'Details zuverlässig beachten',
          'Aufgaben ruhig und konzentriert erledigen',
        ],
        workEnvironments: [
          'ruhige Umgebung mit wenig Ablenkung',
          'abwechslungsreiche Aufgaben im Alltag',
          'klare Strukturen und feste Abläufe',
        ],
      }));
      expect(result.workStyles).toHaveLength(5);
      expect(result.workEnvironments).toHaveLength(3);
    });

    it('trims work styles to max seven words', () => {
      const result = normalizeWorkEnvironmentResult(parseWorkEnvironmentSummary(JSON.stringify({
        workStyles: ['Eine sehr lange und komplizierte Formulierung hier drin und noch mehr'],
        workEnvironments: ['ruhige Umgebung', 'klare Strukturen', 'abwechslungsreiche Aufgaben'],
      })));
      expect(result.workStyles[0].split(/\s+/)).toHaveLength(7);
    });
  });

  describe('formatWorkEnvironmentAsText', () => {
    it('joins work styles and environments with a blank line', () => {
      const text = formatWorkEnvironmentAsText({
        workStyles: ['A', 'B'],
        workEnvironments: ['C', 'D'],
      });
      expect(text).toBe('A\nB\n\nC\nD');
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
      expect(prompt).toContain('am liebsten arbeitet');
      expect(prompt).toContain('Allein oder mit anderen');
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
      expect(q1).toContain('Allein oder mit anderen');
      expect(q2).toContain('Ruhig oder mit Action');
      expect(q3).toContain('Vorgaben oder eigene Lösungen');
      expect(q2).not.toContain('Allein oder mit anderen');
    });

    it('includes synthesis rules in the summary prompt', () => {
      const prompt = buildSummarySystemPrompt({
        audience: 'pupil',
        lang: 'de',
        seniority: { currentStatus: 'pupil' },
      });
      expect(prompt).toContain('Bevorzugte Arbeitsweise');
      expect(prompt).toContain('Passendes Arbeitsumfeld');
      expect(prompt).toContain('im team arbeiten');
      expect(prompt).toContain('wenig arbeiten, viel verdienen');
    });
  });

  describe('formatCoachingTurnMessage', () => {
    it('keeps encouragement plus pivot question on later turns', () => {
      const text = 'Super! Arbeitest du lieber ruhig oder mit viel Action?';
      expect(formatCoachingTurnMessage(text, { allowPreamble: true }))
        .toBe('Super! Arbeitest du lieber ruhig oder mit viel Action?');
    });
  });

  describe('advanceWorkEnvironmentCoaching', () => {
    const seniority = { currentStatus: 'pupil', highestDegree: 'none' };

    it('returns the first question when messages are empty', async () => {
      const llm = jest.fn(async () => ({ text: 'Wann arbeitest du am besten: allein oder mit anderen?' }));
      const result = await advanceWorkEnvironmentCoaching({ seniority, messages: [], lang: 'de', llm });
      expect(result.phase).toBe('question');
      expect(result.message.content).toContain('allein');
      expect(llm).toHaveBeenCalledTimes(1);
    });

    it('returns summary after three user answers', async () => {
      const llm = jest.fn(async ({ messages }) => {
        const isSummary = messages.some((m) => m.role === 'system' && m.content.includes('Bevorzugte Arbeitsweise'));
        if (isSummary) {
          return {
            text: JSON.stringify({
              workStyles: ['A', 'B', 'C', 'D', 'E'],
              workEnvironments: ['X', 'Y', 'Z'],
            }),
          };
        }
        return { text: 'Magst du klare Vorgaben oder eigene Lösungen?' };
      });
      const messages = [
        { role: 'assistant', content: 'Frage 1?' },
        { role: 'user', content: 'Antwort 1' },
        { role: 'assistant', content: 'Frage 2?' },
        { role: 'user', content: 'Antwort 2' },
        { role: 'assistant', content: 'Frage 3?' },
        { role: 'user', content: 'Antwort 3' },
      ];
      const result = await advanceWorkEnvironmentCoaching({ seniority, messages, lang: 'de', llm });
      expect(result.phase).toBe('summary');
      expect(result.workStyles).toHaveLength(5);
      expect(result.workEnvironments).toHaveLength(3);
    });

    it('rejects requesting another question before answering', async () => {
      await expect(advanceWorkEnvironmentCoaching({
        seniority,
        messages: [{ role: 'assistant', content: 'Frage 1?' }],
        lang: 'de',
        llm: jest.fn(),
      })).rejects.toThrow(/answer the current question/i);
    });
  });
});
