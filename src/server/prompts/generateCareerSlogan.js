const SYSTEM_PROMPT_EN = `You transform a user's career-goal input into a short personal slogan.

This is a transformation task, not a summary task.

Rules:
- Output must be 3 to 6 words.
- Return output in the requested language.
- Use only letters, spaces, and optional hyphen.
- No punctuation other than optional hyphen.
- Avoid generic words like success, growth, innovation.
- Do not copy the user's wording.
- Keep tone inspirational, forward-looking, and emotionally engaging without sounding cheesy.
- Prefer one of these structures:
  - "<Value> through <Action>"
  - "<Adjective> <Outcome>"
  - "<Noun> driven by <Principle>"

If the input is vague, infer the strongest implied theme and still produce one slogan.

Return ONLY JSON:
{
  "career_slogan": "<3-6 word slogan>"
}`;

/** German-native patterns — avoid English calques like literal “through innovation”. */
const SYSTEM_PROMPT_DE = `Du formst die Karrierezieleingabe einer Person in einen sehr kurzen persönlichen Slogan.

Das ist eine Umformung, keine Zusammenfassung.

Regeln:
- Genau 3 bis 6 Wörter, durchweg Deutsch (du oder beschreibende Nominalphrase).
- Nur Buchstaben inklusive Ä, Ö, Ü, ß, Leerzeichen und optional ein Bindestrich innerhalb eines Wortes.
- Keine anderen Satzzeichen.
- Vermeide Floskeln wie Erfolg, Wachstum, Innovation, Exzellenz, Passion.
- Übernimm keine Formulierung der Eingabe wörtlich.
- Ton: selbstbewusst, nach vorne gerichtet, glaubwürdig — nicht kitschig und nicht wie Werbung.

Struktur (wähle eine natürliche Variante auf Deutsch):
- "<Substanz oder Haltung> durch <konkrete Handlung>"
- "<Adjektiv> <Ergebnis oder Weg>"
- "<Kraftwort oder Rolle> für <klarer Nutzen oder Ziel>"
- "<Verb im Nominalstil> mit <Substanz>" (z. B. „Gestalten mit Substanz")

Keine worthörtlichen Übernahmen aus dem Englischen. Kurze, rhythmisch saubere Phrase.

Wenn die Eingabe vage ist, leite das stärkste erkennbare Motiv ab und schreibe trotzdem genau einen Slogan.

Antwort AUSSCHLIESSLICH als JSON:
{
  "career_slogan": "<3-6 Wörter>"
}`;

function buildMessages(userInput, condensedInput = '', lang = 'en', tone = 'motivational') {
  const code = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  const systemContent = code === 'de' ? SYSTEM_PROMPT_DE : SYSTEM_PROMPT_EN;
  const instruction =
    code === 'de'
      ? 'Erzeuge genau einen Slogan nach allen Regeln. Nur JSON zurückgeben.'
      : 'Generate exactly one short slogan that follows all rules. Return only JSON.';

  return [
    { role: 'system', content: systemContent },
    {
      role: 'user',
      content: JSON.stringify({
        user_input: String(userInput || ''),
        condensed_theme_hints: String(condensedInput || ''),
        language: String(lang || 'en'),
        tone: String(tone || 'motivational'),
        instruction,
      }),
    },
  ];
}

module.exports = {
  SYSTEM_PROMPT_EN,
  SYSTEM_PROMPT_DE,
  buildMessages,
};
