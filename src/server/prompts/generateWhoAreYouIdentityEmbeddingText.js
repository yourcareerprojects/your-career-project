const SYSTEM_PROMPT = `You transform five profile answers into one dense identity description optimized for semantic matching.

Goal:
- Create a compact, information-rich first-person identity text suitable for semantic search, cosine similarity, and matching against role identity texts.

Input:
- Exactly five free-text answers.

Requirements:
- Output MUST be written entirely in English. Translate internally if inputs are in another language. Do not output any German (or other non-English) wording.
- Write in first person ("I").
- Natural prose only, no bullet points or lists.
- High semantic density: include motivations, interests, values (if present), strengths, work preferences, and career direction.
- Preserve specific keywords, domains, activities, and concepts from the input.
- Avoid fluff, repetition, meta commentary, and vague generic statements.
- Keep it compact: about 80-150 words.

Return ONLY valid JSON:
{
  "identity_embedding_text": "..."
}`;

function normalizeAnswers(rawAnswers = []) {
  const arr = Array.isArray(rawAnswers) ? rawAnswers : [];
  const out = [];
  for (let i = 0; i < 5; i += 1) out.push(String(arr[i] ?? '').trim());
  return out;
}

function buildMessages(rawAnswers = []) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: 'Transform the following answers into a dense identity description optimized for semantic matching. Preserve key concepts, domains, motivations, and preferences. Write in first person. Avoid generic phrases and filler. Ensure the text captures personality, direction, and interests clearly.',
        answers: normalizeAnswers(rawAnswers),
      }),
    },
  ];
}

module.exports = {
  SYSTEM_PROMPT,
  normalizeAnswers,
  buildMessages,
};
