const { callOpenAI } = require('./callOpenAI');

/** Prefer ROLE_FIT_EXPLANATION_MODEL, then shared OPENAI_MODEL; avoid bare ids that may not exist on /v1/chat/completions. */
const DEFAULT_MODEL =
  process.env.ROLE_FIT_EXPLANATION_MODEL ||
  process.env.OPENAI_MODEL ||
  'gpt-4o-mini';

const MAX_WORDS_PER_BULLET = 10;

/** Formal address pronouns / determiners (capitalized) — not lowercase „sie“ (they). */
const FORMAL_DE_ADDRESS_RE =
  /\b(Sie|Ihnen|Ihr|Ihre|Ihrem|Ihren|Ihres|Ihrer)\b/;

function germanTextLooksFormalAddressed(text) {
  return typeof text === 'string' && FORMAL_DE_ADDRESS_RE.test(text);
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Second pass: shorten and use Du-Anrede + plain language.
 * @param {string[]} bullets
 * @returns {Promise<string[]>}
 */
async function rewriteGermanRoleFitBulletsToDuOnly(bullets) {
  const joined = bullets.map((b, i) => `${i + 1}. ${b}`).join('\n');
  const systemPrompt = `Du bist Lektor für eine Karriere-App für junge Menschen (ca. 15–20 Jahre).

AUFGABE
Schreibe die Punkte um: kurz, klar, einfache Wörter, Du-Anrede.

REGELN
- Jeder Punkt: höchstens ${MAX_WORDS_PER_BULLET} Wörter, ein kurzer Satz.
- Beginne mit „Dein/Deine/Du …“ — nie Sie/Ihnen/Ihr.
- Keine Fachsprache, keine langen Nebensätze, kein Gedankenstrich.
- Beispiel gut: „Dein JavaScript passt zu diesem Job.“
- Beispiel schlecht: „Deine Fähigkeiten in JavaScript — zentral für die Entwicklung neuer Software in dieser Rolle“

Ausgabe: nur gültiges JSON {"bullets":["…","…"]}`;

  const { text: rewritten } = await callOpenAI({
    model: DEFAULT_MODEL,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Kürze und vereinfache diese Punkte:\n\n${joined}`,
      },
    ],
  });
  const trimmed = rewritten.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(parsed?.bullets)) {
        return parsed.bullets.map((b) => String(b || '').trim()).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  return bullets;
}

/**
 * @param {{
 *   language: 'en'|'de',
 *   role: object,
 *   userProfile: object,
 *   roleRequirements: object,
 *   profileMatches: object[],
 *   traits: object[],
 *   behavior: object,
 * }} payload
 * @returns {Promise<string>}
 */
async function generateRoleFitExplanationLLM(payload) {
  const germanDuRules =
    payload.language === 'de'
      ? `
GERMAN
- Du-Anrede only (du, dein, deine). Never Sie/Ihnen/Ihr.
- Start each bullet with Dein/Deine/Du.`
      : '';

  const systemPrompt = `
You write short, easy role-fit bullet points for teenagers (about 15–20 years old).

GOAL
3 to 5 bullets. Each links one thing from the user's profile to one thing this job needs.

STYLE (strict)
- Max ${MAX_WORDS_PER_BULLET} words per bullet. One short sentence only.
- Use simple, everyday words. No jargon, no HR speak, no long clauses.
- No em dashes, semicolons, or "aligned with / core requirement / leverage".
- English: start with "Your" or "You" (e.g. "Your coding skills fit this job.").
- German: start with "Dein/Deine/Du" (e.g. "Dein JavaScript passt zu diesem Job.").
- The reader should get it in one glance.

CONTENT
- Use profileMatches first. Only use skills/experience from the user profile — do not invent.
- Say what the job needs in plain words (build apps, talk to customers, plan projects…).

OUTPUT
Return ONLY JSON: {"bullets":["…","…","…"]}

Language: ${payload.language === 'de' ? 'German' : 'English'}.
${germanDuRules}
`.trim();

  const traitsBlock = (payload.traits || [])
    .map((t) => `- ${t.anchor || t.id}`)
    .join('\n');

  const bh = payload.behavior || {};
  const user = payload.userProfile || {};
  const reqs = payload.roleRequirements || {};
  const matchesBlock = (payload.profileMatches || [])
    .map((m) => `- ${m.userLabel} ↔ ${m.roleLabel}`)
    .join('\n');

  const role = payload.role || {};

  const goodExamples =
    payload.language === 'de'
      ? `GUT:
- "Dein JavaScript passt zu diesem Job."
- "Du kannst im Team arbeiten. Das braucht dieser Job."
- "Deine Planung hilft hier."

SCHLECHT (zu lang / zu kompliziert):
- "Deine Fähigkeiten in JavaScript — zentral für die Entwicklung neuer Software"`
      : `GOOD:
- "Your coding skills fit this job."
- "You work well in a team. This job needs that."
- "Your planning skills help here."

BAD (too long / too complex):
- "Your experience with developing web applications — aligned with developing new software features"`;

  const userPrompt = `
Write 3–5 short fit bullets as JSON {"bullets":[…]}.

Role: ${role.title || ''}

USER PROFILE:
Skills: ${(user.skills || []).join(', ') || '—'}
Experience: ${(user.responsibilities || []).join(', ') || '—'}
Areas: ${(user.domains || []).join(', ') || '—'}

JOB NEEDS:
Skills: ${(reqs.skills || []).join(', ') || '—'}
Tasks: ${(reqs.responsibilities || []).join('; ') || '—'}

BEST MATCHES (use these first):
${matchesBlock || '—'}

${goodExamples}
`.trim();

  const response = await callOpenAI({
    model: DEFAULT_MODEL,
    temperature: payload.language === 'de' ? 0.35 : 0.45,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  let text = response.text.trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');

  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(parsed?.bullets)) {
        let bullets = parsed.bullets.map((b) => String(b || '').trim()).filter(Boolean);

        const needsGermanRewrite =
          payload.language === 'de' &&
          bullets.some((b) => germanTextLooksFormalAddressed(b) || countWords(b) > MAX_WORDS_PER_BULLET);

        if (needsGermanRewrite) {
          bullets = await rewriteGermanRoleFitBulletsToDuOnly(bullets);
        }

        text = JSON.stringify({ bullets });
      }
    } catch {
      // keep raw text; client fallback will parse lines
    }
  }

  return text;
}

module.exports = {
  generateRoleFitExplanationLLM,
};
