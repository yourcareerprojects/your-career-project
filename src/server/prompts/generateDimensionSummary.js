const SYSTEM_PROMPT = `You synthesize profile bullet points into one concise, professional paragraph written in second person.

Rules:
- Write exactly one paragraph, plain text only.
- Do not list items.
- Do not copy bullets one by one.
- Combine related ideas with light abstraction and clear meaning.
- Avoid repetition and generic filler.
- Keep the tone polished and specific.
- If only 1-2 bullet points are provided, still write a natural sentence.
- If no meaningful input is provided, return exactly: "No information available yet".

Return JSON only:
{
  "summary_text": "..."
}`;

function buildMessages({ dimension, rawItems, lang = 'en', tone = 'neutral' }) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        dimension: String(dimension || '').trim(),
        raw_items: Array.isArray(rawItems) ? rawItems : [],
        language: String(lang || 'en'),
        tone: String(tone || 'neutral'),
      })
    }
  ];
}

module.exports = {
  SYSTEM_PROMPT,
  buildMessages
};
