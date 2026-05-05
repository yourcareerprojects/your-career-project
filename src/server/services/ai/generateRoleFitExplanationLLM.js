const { callOpenAI } = require('./callOpenAI');

/** Prefer ROLE_FIT_EXPLANATION_MODEL, then shared OPENAI_MODEL; avoid bare ids that may not exist on /v1/chat/completions. */
const DEFAULT_MODEL =
  process.env.ROLE_FIT_EXPLANATION_MODEL ||
  process.env.OPENAI_MODEL ||
  'gpt-4o-mini';

/** Formal address pronouns / determiners (capitalized) — not lowercase „sie“ (they). */
const FORMAL_DE_ADDRESS_RE =
  /\b(Sie|Ihnen|Ihr|Ihre|Ihrem|Ihren|Ihres|Ihrer)\b/;

function germanTextLooksFormalAddressed(text) {
  return typeof text === 'string' && FORMAL_DE_ADDRESS_RE.test(text);
}

/**
 * Second pass: models often drift into Sie-form despite instructions; normalize with a tight rewrite.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function rewriteGermanRoleFitTextToDuOnly(text) {
  const systemPrompt = `Du bist ein deutscher Lektor für eine digitale Karriere-App.

AUFGABE
Überarbeite den gelieferten Absatz so, dass die Nutzerin oder der Nutzer **ausschließlich informell mit „du“, „dir“, „dich“, „dein/deine/deinem/deiner …“** angesprochen wird.

NIEMALS verwenden (Bezug auf die angesprochene Person):
Sie, Ihnen, Ihr, Ihre, Ihrem, Ihren, Ihres, Ihrer — auch nicht gemischt mit Du.

RICHTIG statt falsch (Beispiele):
- „können Sie sicherstellen“ → „kannst du sicherstellen“
- „Ihr Urteilsvermögen … ermöglicht es Ihnen“ → „Dein Urteilsvermögen … ermöglicht dir“
- „So gestalten Sie …“ → „So gestaltest du …“ / „So kannst du … gestalten“

Konjugation und Kasus sauber an „du“ anpassen. Inhalt und Aussagen unverändert lassen; keine neuen Fakten.
Ausgabe: nur der überarbeitete Fließtext auf Deutsch, keine Überschrift, keine Kommentare.`;

  const { text: rewritten } = await callOpenAI({
    model: DEFAULT_MODEL,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content:
          `Überarbeite diesen Text in durchgängige Du-Anrede:\n\n${text}`,
      },
    ],
  });
  return rewritten.trim();
}

/**
 * @param {{
 *   language: 'en'|'de',
 *   role: {
 *     title: string,
 *     coreChallenge: string,
 *     typicalFailure: string,
 *     realWork: string,
 *     digest: string,
 *   },
 *   traits: { id: string, dimension: string, anchor: string, patternSentence: string }[],
 *   behavior: {
 *     id: string,
 *     primaryDimension: string,
 *     supportingDimension: string,
 *     fitTags: string[],
 *     summary: string,
 *     connection: string,
 *   },
 * }} payload
 * @returns {Promise<string>}
 */
async function generateRoleFitExplanationLLM(payload) {
  const germanDuRules =
    payload.language === 'de'
      ? `
GERMAN ADDRESSING — PRODUCT REQUIREMENT (mandatory)
This app always speaks informally to the job seeker in German (Du-Stil wie in einem Team-Chat). Höfliche Sie-Anrede ist falsch.

- Nutze durchgängig: du, dir, dich, dein, deine, deinem, deiner …
- Verboten für die angesprochene Person: Sie, Ihnen, Ihr, Ihre, Ihrem, Ihren, Ihres, Ihrer — auch nicht ein Satz Sie und ein Satz du.
- Vermeide gedoppelte Höflichkeit („Sie können …“, „Ihnen ermöglicht …“); schreibe direkt in du-Form mit angepasster Verbform.

Typische Fehler vermeiden (falsch → richtig):
- „können Sie sicherstellen“ → „kannst du sicherstellen“
- „Ihr … ermöglicht es Ihnen“ → „Dein … ermöglicht dir“ / „Dir ermöglicht dein …“
- „So gestalten Sie“ → „So gestaltest du“ oder „So kannst du … gestalten“

Quelltext auf Deutsch oft schon „du“ — wenn Material Sie enthält, konsequent auf du umbauen.`
      : '';

  const systemPrompt = `
You are an expert career analyst writing personalized role-fit explanations for job seekers.

SOURCE MATERIAL (draft product copy)
You receive localized trait lines (anchor + elaboration sentence) and archetype alignment lines (summary + connection)
from our content system. These strings capture the IDEAS we want conveyed, but they are NOT acceptable final UX copy:
they may sound templated, repetitive, or clipped.

YOUR JOB
Rewrite into ONE cohesive, natural explanation for the user. Preserve the substantive meaning of each trait idea and
the archetype alignment (summary + connection), but express everything in fresh wording and varied sentence rhythm.
This must read like thoughtful analyst prose, not a light edit of the source strings.

RULES
- Substantially rephrase: no sentence in your answer should match a source sentence verbatim or differ only trivially.
- Do not concatenate source clauses with commas or glue words; synthesize new sentences.
- Ground at least two specifics in the ROLE TITLE or DIGEST (tasks, domains, skills), not only generic strengths.
- Do NOT present traits as a bullet list or labeled inventory.
- Avoid HR clichés (“leverage synergy”, “passionate”, “dynamic”).
- Avoid forbidden boilerplate listed in the user message (English OR German — match output language).

STRUCTURE (implicit, no headings)
1. Open with a concrete on-the-job moment suggested by the role digest or title (avoid stale formula openers).
2. Name what tends to break if someone lacks this blend of strengths (risk → consequence), when useful.
3. Weave trait ideas and archetype alignment into how they navigate that situation (cause → effect).
4. Short forward-looking note (one clause).

LANGUAGE
Match payload.language exactly (${payload.language === 'de' ? 'German' : 'English'}).
${germanDuRules}
`.trim();

  const forbiddenEn = `
FORBIDDEN ENGLISH PHRASES / PATTERNS (do not use verbatim or trivial paraphrase):
- "This role fits because"
- "that shows up in how you approach real situations"
- "not just in theory"
- "That matters in this role because"
- "spotting patterns, making judgment calls, and helping others move with confidence"
- "As you grow here, you can expand your scope and shape how this kind of work is run"
`.trim();

  const forbiddenDe = `
ANREDE (harte Regel)
- Kein „Sie“, „Ihnen“, „Ihr/Ihre/Ihrem/Ihren/Ihres/Ihrer“ zur Ansprache der Nutzerin/des Nutzers — nur „du“, „dir“, „dich“, „dein/deine…“.
- Vor dem Absenden: ganzen Text nach großgeschriebenem Sie/Ihnen/Ihr… durchsuchen; jedes Vorkommen entfernen oder in Du-Form umschreiben.

VERBOTENE DEUTSCHE FORMULIERUNGEN (nicht wörtlich oder nah paraphrasieren):
- "Zu dieser Rolle passt du, weil"
- "wie du echte Situationen angehst"
- Formeln wie "In dieser Rolle zählt …" als Satzanfang mehrfach
`.trim();

  const traitsBlock = (payload.traits || [])
    .map(
      (t) =>
        `- code=${t.id} dimension=${t.dimension || ''}\n` +
        `  anchor (draft): ${t.anchor || ''}\n` +
        `  pattern (draft): ${t.patternSentence || ''}`
    )
    .join('\n');

  const bh = payload.behavior || {};
  const tags = Array.isArray(bh.fitTags) ? bh.fitTags.join(', ') : '';

  const behaviorBlock = [
    `Archetype code: ${bh.id || ''}`,
    `Dimensions (primary / supporting): ${bh.primaryDimension || ''} / ${bh.supportingDimension || ''}`,
    `Fit keyword tags (internal): ${tags}`,
    `Summary (draft — rephrase for user): ${bh.summary || ''}`,
    `Connection to role (draft — rephrase for user): ${bh.connection || ''}`,
  ].join('\n');

  const role = payload.role || {};
  const digest = role.digest ? `\nDIGEST (occupation facts — use for specificity; do not paste):\n${role.digest}` : '';

  const userPrompt = `
Write ONE cohesive explanation (80–100 words).

Language code: ${payload.language}

ROLE (fields may be empty):
Title: ${role.title || ''}
Core challenge (hint): ${role.coreChallenge || ''}
Typical failure mode (hint): ${role.typicalFailure || ''}
Real work snapshot (hint): ${role.realWork || ''}
${digest}

SOURCE MATERIAL — trait ideas (rewrite; do not echo):
${traitsBlock || '(no traits selected — lean on archetype alignment and role digest)'}

SOURCE MATERIAL — archetype / working-style alignment (rewrite; do not echo):
${behaviorBlock}

QUALITY CHECK BEFORE FINISHING:
- Every substantive idea from trait draft lines and behavior summary/connection should appear, in meaning, but in new wording.
- No long phrases copied verbatim from SOURCE MATERIAL blocks above.
- Honor forbidden boilerplate block (${payload.language === 'de' ? 'German' : 'English'}) below.
${payload.language === 'de' ? '- German: scan your draft for Sie/Ihnen/Ihr… referring to the reader; rewrite every hit to du/dir/dein… before submitting.' : ''}

${payload.language === 'de' ? forbiddenDe : forbiddenEn}
`.trim();

  const response = await callOpenAI({
    model: DEFAULT_MODEL,
    temperature: payload.language === 'de' ? 0.45 : 0.65,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  let text = response.text.trim();

  if (payload.language === 'de' && germanTextLooksFormalAddressed(text)) {
    text = await rewriteGermanRoleFitTextToDuOnly(text);
    if (germanTextLooksFormalAddressed(text)) {
      text = await rewriteGermanRoleFitTextToDuOnly(text);
    }
  }

  return text;
}

module.exports = {
  generateRoleFitExplanationLLM,
};
