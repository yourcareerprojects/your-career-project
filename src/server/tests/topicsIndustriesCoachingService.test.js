const {
  parseTopicsIndustriesSummary,
  normalizeTopicsIndustriesResult,
  formatTopicsIndustriesAsText,
  advanceTopicsIndustriesCoaching,
} = require('../services/profile/topicsIndustriesCoachingService');
const { buildQuestionSystemPrompt, buildQuestionTurnUserMessage, buildSummarySystemPrompt, buildSummaryUserPrompt } = require('../prompts/topicsIndustriesCoachingPrompts');
const {
  formatCoachingTurnMessage,
} = require('../services/profile/workEnjoyCoachingService');
const {
  interestTopicTooCloseToAnswers,
  countParrotInterestTopics,
} = require('../services/profile/topicsIndustriesCoachingService');

describe('topicsIndustriesCoachingService', () => {
  describe('parseTopicsIndustriesSummary', () => {
    it('parses JSON interest topics and industries', () => {
      const result = parseTopicsIndustriesSummary(JSON.stringify({
        interestTopics: [
          'Technik verstehen',
          'Tiere beobachten',
          'Geschichten schreiben',
          'Sport analysieren',
          'Menschen helfen',
        ],
        industries: ['Gesundheit', 'Medien', 'Umwelt'],
      }));
      expect(result.interestTopics).toHaveLength(5);
      expect(result.industries).toEqual(['Healthcare', 'Media & Entertainment', 'Sustainability']);
    });

    it('trims interest topics to max three words', () => {
      const result = normalizeTopicsIndustriesResult(parseTopicsIndustriesSummary(JSON.stringify({
        interestTopics: ['Sehr lange komplizierte Formulierung hier'],
        industries: ['Gesundheitswesen', 'Medien & Unterhaltung', 'Nachhaltigkeit'],
      })));
      expect(result.interestTopics[0].split(/\s+/)).toHaveLength(3);
      expect(result.industries).toEqual(['Healthcare', 'Media & Entertainment', 'Sustainability']);
    });
  });

  describe('formatCoachingTurnMessage', () => {
    it('keeps encouragement plus pivot question on later turns', () => {
      const text = 'Spannend! Welche Themen findest du in der Schule spannend?';
      expect(formatCoachingTurnMessage(text, { allowPreamble: true }))
        .toBe('Spannend! Welche Themen findest du in der Schule spannend?');
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
      expect(prompt).toContain('echtem Interesse im Alltag');
      expect(prompt).toContain('Freiwillige Themen');
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
      expect(q1).toContain('Freiwillige Themen');
      expect(q2).toContain('Schule & Lernen');
      expect(q3).toContain('Gespräche & Austausch');
      expect(q2).not.toContain('Freiwillige Themen');
    });

    it('uses student-focused wording for question 2', () => {
      const prompt = buildQuestionSystemPrompt({
        audience: 'student',
        lang: 'de',
        seniority: { currentStatus: 'student' },
        questionNumber: 2,
      });
      expect(prompt).toContain('Studium & Ausbildung');
      expect(prompt).not.toContain('Schule & Lernen');
      expect(prompt).toContain('keine Schulfragen an Berufstätige');
    });

    it('uses early-career-focused wording for question 2', () => {
      const prompt = buildQuestionSystemPrompt({
        audience: 'early_career',
        lang: 'de',
        seniority: { currentStatus: 'employed', yearsOfExperience: 2 },
        questionNumber: 2,
      });
      expect(prompt).toContain('Arbeit & Projekte');
      expect(prompt).not.toContain('Schule');
    });

    it('uses one private-life question for mid-career (question 3 only)', () => {
      const q1 = buildQuestionSystemPrompt({
        audience: 'mid_career',
        lang: 'de',
        seniority: { currentStatus: 'employed', yearsOfExperience: 8 },
        questionNumber: 1,
      });
      const q2 = buildQuestionSystemPrompt({
        audience: 'mid_career',
        lang: 'de',
        seniority: { currentStatus: 'employed', yearsOfExperience: 8 },
        questionNumber: 2,
      });
      const q3 = buildQuestionSystemPrompt({
        audience: 'mid_career',
        lang: 'de',
        seniority: { currentStatus: 'employed', yearsOfExperience: 8 },
        questionNumber: 3,
      });
      expect(q1).toContain('Freiwillige Themen');
      expect(q1).toContain('Eine der drei Fragen');
      expect(q1).not.toContain('Freizeit & Privatleben');
      expect(q2).toContain('Beruf & Fachgebiet');
      expect(q3).toContain('Freizeit & Privatleben');
      expect(q3).toContain('abseits vom Job');
    });

    it('uses one private-life question for senior (question 3 only)', () => {
      const q1 = buildQuestionSystemPrompt({
        audience: 'senior',
        lang: 'en',
        seniority: { currentStatus: 'employed', yearsOfExperience: 15, mostSeniorWorkExperience: 'director' },
        questionNumber: 1,
      });
      const q3 = buildQuestionSystemPrompt({
        audience: 'senior',
        lang: 'en',
        seniority: { currentStatus: 'employed', yearsOfExperience: 15, mostSeniorWorkExperience: 'director' },
        questionNumber: 3,
      });
      expect(q1).toContain('Voluntary topics');
      expect(q1).toContain('One of the three questions');
      expect(q1).not.toContain('Leisure & personal life');
      expect(q3).toContain('Leisure & personal life');
      expect(q3).toContain('outside work');
    });

    it('asks for encouragement then a pivot question on later turns', () => {
      const turn = buildQuestionTurnUserMessage({
        lang: 'de',
        audience: 'student',
        questionNumber: 2,
        messages: [
          { role: 'assistant', content: 'Über welche Themen schaust du Videos?' },
          { role: 'user', content: 'Ich schaue gern Videos über Weltraum und Technik.' },
        ],
      });
      expect(turn).toContain('ermutigender Satz');
      expect(turn).toContain('Weltraum');
    });

    it('asks the summary prompt to synthesize instead of repeating answers', () => {
      const prompt = buildSummarySystemPrompt({
        audience: 'pupil',
        lang: 'de',
        seniority: { currentStatus: 'pupil' },
      });
      expect(prompt).toContain('Synthese');
      expect(prompt).toContain('nicht die kurzen Antworten spiegeln');
      expect(prompt).toContain('Verboten');
    });

    it('reminds the model in the user summary turn not to copy answers', () => {
      const user = buildSummaryUserPrompt([
        { role: 'assistant', content: 'Frage 1' },
        { role: 'user', content: 'Fußball und Minecraft' },
      ], 'de');
      expect(user).toContain('kopiere die Antworten nicht');
    });
  });

  describe('interestTopicTooCloseToAnswers', () => {
    it('flags topics that repeat answer wording', () => {
      const answers = ['Fußball und Minecraft'];
      expect(interestTopicTooCloseToAnswers('Fußball', answers)).toBe(true);
      expect(interestTopicTooCloseToAnswers('Welten gestalten', answers)).toBe(false);
    });

    it('counts parrot topics for retry logic', () => {
      const answers = ['Weltraum und Technik'];
      expect(countParrotInterestTopics(['Weltraum', 'Technik', 'Systeme begreifen'], answers)).toBeGreaterThanOrEqual(2);
    });
  });

  describe('advanceTopicsIndustriesCoaching', () => {
    const seniority = {
      currentStatus: 'pupil',
      highestDegree: 'realschulabschluss',
      yearsOfExperience: 0,
      mostSeniorWorkExperience: 'intern',
    };

    it('returns the first question when history is empty', async () => {
      const result = await advanceTopicsIndustriesCoaching({
        seniority,
        messages: [],
        lang: 'de',
        llm: async () => ({ text: 'Über welche Themen schaust du freiwillig Videos?' }),
      });
      expect(result.phase).toBe('question');
      expect(result.questionIndex).toBe(1);
      expect(result.message.content).toContain('Videos');
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
      const result = await advanceTopicsIndustriesCoaching({
        seniority,
        messages,
        lang: 'de',
        llm: async () => ({
          text: JSON.stringify({
            interestTopics: [
              'Technik verstehen',
              'Weltraum erforschen',
              'Geschichten schreiben',
              'Sport verfolgen',
              'Natur beobachten',
            ],
            industries: ['Medien & Unterhaltung', 'Software', 'Nachhaltigkeit'],
          }),
        }),
      });
      expect(result.phase).toBe('summary');
      expect(result.complete).toBe(true);
      expect(result.interestTopics).toHaveLength(5);
      expect(result.industries).toHaveLength(3);
    });

    it('retries summary generation when interest topics mirror short answers', async () => {
      const messages = [
        { role: 'assistant', content: 'Frage 1' },
        { role: 'user', content: 'Fußball und Minecraft' },
        { role: 'assistant', content: 'Frage 2' },
        { role: 'user', content: 'Biologie' },
        { role: 'assistant', content: 'Frage 3' },
        { role: 'user', content: 'Tiere' },
      ];
      let calls = 0;
      const result = await advanceTopicsIndustriesCoaching({
        seniority,
        messages,
        lang: 'de',
        llm: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              text: JSON.stringify({
                interestTopics: ['Fußball', 'Minecraft', 'Biologie', 'Tiere', 'Sport'],
                industries: ['Sport', 'Bildung', 'Medien'],
              }),
            };
          }
          return {
            text: JSON.stringify({
              interestTopics: [
                'Wettbewerb verfolgen',
                'Welten gestalten',
                'Lebewesen verstehen',
                'Natur beobachten',
                'Regeln durchdenken',
              ],
              industries: ['Sport', 'Bildung', 'Medien'],
            }),
          };
        },
      });
      expect(calls).toBe(2);
      expect(result.interestTopics[0]).toBe('Wettbewerb verfolgen');
    });

    it('retries summary generation when industries fail canonical normalization', async () => {
      const messages = [
        { role: 'assistant', content: 'Frage 1' },
        { role: 'user', content: 'Ich schaue Tech-Videos und arbeite an Software-Projekten.' },
        { role: 'assistant', content: 'Frage 2' },
        { role: 'user', content: 'Medien und Nachrichten.' },
        { role: 'assistant', content: 'Frage 3' },
        { role: 'user', content: 'Gespräche über Innovation.' },
      ];
      let calls = 0;
      const result = await advanceTopicsIndustriesCoaching({
        seniority,
        messages,
        lang: 'de',
        llm: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              text: JSON.stringify({
                interestTopics: [
                  'Technik verstehen',
                  'Welten gestalten',
                  'Menschen informieren',
                  'Regeln durchdenken',
                  'Ideen teilen',
                ],
                industries: ['Random Sector', 'Another Field', 'Misc'],
              }),
            };
          }
          return {
            text: JSON.stringify({
              interestTopics: [
                'Technik verstehen',
                'Welten gestalten',
                'Menschen informieren',
                'Regeln durchdenken',
                'Ideen teilen',
              ],
              industries: ['Software', 'Media & Entertainment', 'Telecommunications'],
            }),
          };
        },
      });
      expect(calls).toBe(2);
      expect(result.industries.length).toBeGreaterThanOrEqual(3);
    });

    it('rejects another question before the user answers', async () => {
      await expect(advanceTopicsIndustriesCoaching({
        seniority,
        messages: [{ role: 'assistant', content: 'Frage 1' }],
        lang: 'de',
        llm: async () => ({ text: 'noop' }),
      })).rejects.toThrow(/answer the current/i);
    });
  });

  describe('formatTopicsIndustriesAsText', () => {
    it('joins topics and industries with a blank line', () => {
      const text = formatTopicsIndustriesAsText({
        interestTopics: ['A', 'B'],
        industries: ['Gesundheit', 'Medien'],
      });
      expect(text).toBe('A\nB\n\nGesundheit\nMedien');
    });
  });
});
