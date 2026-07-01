const {
  parseWorkingLifeAchievementSummary,
  normalizeWorkingLifeAchievementResult,
  formatWorkingLifeAchievementAsText,
  advanceWorkingLifeAchievementCoaching,
} = require('../services/profile/workingLifeAchievementCoachingService');
const {
  buildQuestionSystemPrompt,
  buildQuestionTurnUserMessage,
  buildQuestionTaskRules,
  buildSummarySystemPrompt,
} = require('../prompts/workingLifeAchievementCoachingPrompts');

describe('workingLifeAchievementCoachingService', () => {
  describe('parseWorkingLifeAchievementSummary', () => {
    it('parses JSON career goals and priorities', () => {
      const result = parseWorkingLifeAchievementSummary(JSON.stringify({
        careerGoals: [
          'am Ende des Tages etwas geschafft haben',
          'anderen Menschen konkret weiterhelfen',
          'eigene Ideen umsetzen können',
          'in einem stabilen Umfeld arbeiten',
          'Aufgaben mit Sinn erledigen',
        ],
        priorities: [
          'Sicherheit ist mir wichtiger als viel Geld',
          'Ich will anderen konkret helfen können',
          'Eigene Ideen sollen zählen',
        ],
      }));
      expect(result.careerGoals).toHaveLength(5);
      expect(result.priorities).toHaveLength(3);
    });

    it('trims career goals to max eight words', () => {
      const result = normalizeWorkingLifeAchievementResult(parseWorkingLifeAchievementSummary(JSON.stringify({
        careerGoals: ['Eine sehr lange und komplizierte Formulierung hier drin und noch mehr Wörter'],
        priorities: ['Kurz eins', 'Kurz zwei', 'Kurz drei'],
      })));
      expect(result.careerGoals[0].split(/\s+/)).toHaveLength(8);
    });
  });

  describe('formatWorkingLifeAchievementAsText', () => {
    it('joins career goals and priorities with a blank line', () => {
      const text = formatWorkingLifeAchievementAsText({
        careerGoals: ['A', 'B'],
        priorities: ['C', 'D'],
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
      expect(prompt).toContain('eigenständigen Themen');
      expect(prompt).toContain('Gefühl am Tagesende');
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
      expect(q1).toContain('Gefühl am Tagesende');
      expect(q2).toContain('Werte & Prioritäten');
      expect(q3).toContain('Erkennungszeichen für gute Passung');
      expect(q2).toContain('Eigenständiges Thema dieser Frage (2 von 3): Werte & Prioritäten');
    });

    it('includes synthesis rules in the summary prompt', () => {
      const prompt = buildSummarySystemPrompt({
        audience: 'pupil',
        lang: 'de',
        seniority: { currentStatus: 'pupil' },
      });
      expect(prompt).toContain('Wichtigste Ziele im Berufsleben');
      expect(prompt).toContain('besonders wichtig ist');
      expect(prompt).toContain('glücklich sein');
      expect(prompt).toContain('viel geld verdienen');
    });
    it('asks for standalone topics without building on prior answers', () => {
      const prompt = buildQuestionTurnUserMessage({
        lang: 'de',
        questionNumber: 2,
        messages: [
          { role: 'assistant', content: 'Was müsste dein Job haben?' },
          { role: 'user', content: 'Dass ich etwas geschafft habe' },
        ],
        audience: 'pupil',
      });
      expect(prompt).toContain('eigenständigen Thema');
      expect(prompt).toContain('Kein Bezug auf vorherige Antworten');
      expect(prompt).toContain('bereits abgedeckt');
      expect(prompt).not.toContain('Letzte Antwort des Nutzers');
      expect(prompt).not.toContain('ermutigender Satz');
    });

    it('requires only a single question in task rules', () => {
      const focus = { title: 'Werte & Prioritäten', example: 'Was wäre dir wichtiger?' };
      const rules = buildQuestionTaskRules({ lang: 'de', questionNumber: 2, focus, audience: 'pupil' });
      expect(rules).toContain('nur die eine Frage');
      expect(rules).toContain('kein Ermutigungssatz');
    });
  });

  describe('advanceWorkingLifeAchievementCoaching', () => {
    const seniority = { currentStatus: 'pupil', highestDegree: 'none' };

    it('returns the first question when messages are empty', async () => {
      const llm = jest.fn(async () => ({ text: 'Was müsste dein Job haben, damit du dich am Ende des Tages gut fühlst?' }));
      const result = await advanceWorkingLifeAchievementCoaching({ seniority, messages: [], lang: 'de', llm });
      expect(result.phase).toBe('question');
      expect(result.questionIndex).toBe(1);
      expect(result.message.content).toContain('Job haben');
      expect(llm).toHaveBeenCalledTimes(1);
    });

    it('returns summary after three user answers', async () => {
      const messages = [
        { role: 'assistant', content: 'Frage 1' },
        { role: 'user', content: 'Ich will am Ende etwas geschafft haben' },
        { role: 'assistant', content: 'Frage 2' },
        { role: 'user', content: 'Mir ist Sicherheit wichtiger als viel Geld' },
        { role: 'assistant', content: 'Frage 3' },
        { role: 'user', content: 'Ich merke es, wenn ich stolz nach Hause gehe' },
      ];
      const llm = jest.fn(async () => ({
        text: JSON.stringify({
          careerGoals: ['A', 'B', 'C', 'D', 'E'],
          priorities: ['P1', 'P2', 'P3'],
        }),
      }));
      const result = await advanceWorkingLifeAchievementCoaching({ seniority, messages, lang: 'de', llm });
      expect(result.phase).toBe('summary');
      expect(result.complete).toBe(true);
      expect(result.careerGoals).toHaveLength(5);
      expect(result.priorities).toHaveLength(3);
    });

    it('rejects too many user messages', async () => {
      await expect(advanceWorkingLifeAchievementCoaching({
        seniority,
        messages: [
          { role: 'assistant', content: 'Q1' },
          { role: 'user', content: 'A1' },
          { role: 'assistant', content: 'Q2' },
          { role: 'user', content: 'A2' },
          { role: 'assistant', content: 'Q3' },
          { role: 'user', content: 'A3' },
          { role: 'user', content: 'extra' },
        ],
        lang: 'de',
        llm: jest.fn(),
      })).rejects.toThrow(/too many/i);
    });
  });
});
