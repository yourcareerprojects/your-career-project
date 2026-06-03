function buildMessages(cvText, lang = 'en') {
  const safeCvText = String(cvText || '').slice(0, 30000);
  const requested =
    String(lang || 'en')
      .toLowerCase()
      .split('-')[0] === 'de'
      ? 'de'
      : 'en';
  const outputLangHuman = requested === 'de' ? 'German' : 'English';

  const system = `You are an expert career analyst interpreting CVs for user identity prompts.
Return STRICT JSON only and follow the schema exactly.
Use interpretation over literal extraction.
If uncertain, keep confidence low and evidence empty.

Output language (${requested}) — all readable strings must be articulate ${outputLangHuman} at professional CV quality.`;

  const user = `INTERPRET the CV below into five inferred identity dimensions (not literal copy-paste).

Return STRICT JSON only:

{
  "userIdentity": {
    "workEnjoyment": { "bullets": [], "confidence": 0.0, "evidence": [] },
    "interests": { "bullets": [], "confidence": 0.0, "evidence": [] },
    "strengths": { "bullets": [], "confidence": 0.0, "evidence": [] },
    "workStyle": { "bullets": [], "confidence": 0.0, "evidence": [] },
    "careerGoals": { "bullets": [], "confidence": 0.0, "evidence": [] }
  }
}

Rules:
- each field uses "bullets" (array), 3-10 bullets when enough signals exist
- each bullet max 10 words, concise phrase, no ending punctuation
- avoid repeated bullets across fields
- avoid vague clichés unless backed by CV duties/outcomes
- do not hallucinate evidence

CV TEXT:
${safeCvText}`;

  return [
    { role: 'system', content: `${system}\nRequested document output locale: ${requested} (${outputLangHuman}).` },
    { role: 'user', content: user },
  ];
}

module.exports = {
  buildMessages,
};
