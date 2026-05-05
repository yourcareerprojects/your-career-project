const { CURRENT_EMPLOYMENT_STATUS_CANONICAL } = require('../../constants/currentEmploymentStatus');

function buildMessages(cvText, lang = 'en') {
  const safeCvText = String(cvText || '').slice(0, 30000);
  const requested =
    String(lang || 'en')
      .toLowerCase()
      .split('-')[0] === 'de'
      ? 'de'
      : 'en';
  const outputLangHuman = requested === 'de' ? 'German' : 'English';

  const system = `You are an expert career analyst and semantic CV interpreter.
Return STRICT JSON only and follow the schema exactly.
Use interpretation over literal extraction.
If uncertain, keep confidence low and evidence empty.

Output language (${requested}) — all readable strings (identity bullets, evidence, responsibilities, domains, skill names, learning goals, seniority prose) must be articulate ${outputLangHuman} at professional CV quality comparable across locales.`;

  const user = `Your task is NOT to extract text literally, but to INTERPRET the CV and map it into a structured user profile.

The CV may be incomplete, inconsistently formatted, or ambiguous. Use best judgment and inference where needed.

---

INPUT:
A raw CV / resume text.

---

OUTPUT:
Return STRICT JSON only. No explanations.

Schema:

{
  "userIdentity": {
    "workEnjoyment": {
      "bullets": [],
      "confidence": 0.0,
      "evidence": []
    },
    "interests": {
      "bullets": [],
      "confidence": 0.0,
      "evidence": []
    },
    "strengths": {
      "bullets": [],
      "confidence": 0.0,
      "evidence": []
    },
    "workStyle": {
      "bullets": [],
      "confidence": 0.0,
      "evidence": []
    },
    "careerGoals": {
      "bullets": [],
      "confidence": 0.0,
      "evidence": []
    }
  },

  "structuredProfile": {
    "skillDomains": [
      {
        "name": "",
        "confidence": 0.0,
        "evidence": []
      }
    ],
    "domains": [
      {
        "name": "",
        "confidence": 0.0,
        "evidence": []
      }
    ],
    "responsibilities": [
      {
        "description": "",
        "confidence": 0.0,
        "evidence": []
      }
    ],
    "skills": [
      {
        "name": "",
        "level": "beginner|intermediate|advanced",
        "confidence": 0.0,
        "evidence": []
      }
    ],
    "learningGoals": [
      {
        "name": "",
        "confidence": 0.0,
        "evidence": []
      }
    ]
  },

  "seniority": {
    "currentStatus": {
      "value": "",
      "confidence": 0.0,
      "evidence": []
    },
    "yearsOfExperience": {
      "value": "",
      "confidence": 0.0,
      "evidence": []
    },
    "highestDegree": {
      "value": "",
      "confidence": 0.0,
      "evidence": []
    },
    "mostSeniorRole": {
      "value": "",
      "confidence": 0.0,
      "evidence": []
    }
  }
}

---

INSTRUCTIONS:

1. INTERPRETATION OVER EXTRACTION
Do not copy text blindly.
Infer meaning from responsibilities, roles, and context.

2. USER IDENTITY FIELDS (INFERRED, NOT EXPLICIT)
- workEnjoyment
- interests
- strengths
- workStyle
- careerGoals

User identity format requirements:
- each must return "bullets" (array), not "value"
- 3-10 bullets per field when enough signals exist
- each bullet max 10 words
- concise phrase, no ending punctuation
- avoid repeated bullets across identity fields
- avoid vague generic claims${requested === 'en' ? '\n- in English specifically: concrete verbs and specifics from the CV; avoid empty clichés ("passionate", "detail-oriented", "team player") unless backed by duties or outcomes in the CV' : ''}

3. STRUCTURED PROFILE
- skillDomains
- domains
- responsibilities
- skills
- learningGoals

skillDomains requirements:
- high-level skill clusters (more generic capability themes)
- examples: Strategy, Leadership, Communication, Analysis, Execution, Design
- put job functions/capabilities here (e.g. Marketing, Sales, Business Development, Social Media, Product Management) — NOT in domains

Domains requirements (critical — industry / sector ONLY):
- domains must be ECONOMIC SECTORS or SCIENTIFIC / INDUSTRY VERTICALS the person works in or wants to work in
- GOOD examples: MedTech, Life Sciences, Pharmaceuticals, Healthcare, Manufacturing, Education, Energy, Agriculture, Automotive, Aerospace, Retail, Hospitality, Construction, Telecommunications, Software (as an industry), Financial Services
- NEVER put these in domains (use skillDomains or skills instead): Marketing, Digital Marketing, Social Media, Business Development, Sales, HR, Product Management, Project Management, Operations, Analytics, Consulting (as a role), Design (as a job function), Customer Success
- infer from employers, products, regulated environments, and industry nouns — not from channel or go-to-market verbs
- generalize: hospital/clinic -> Healthcare; drug R&D -> Life Sciences or Pharmaceuticals; factory floor -> Manufacturing; university -> Education
- return 3-6 distinct domains when signals exist; prefer fewer if unclear
- deduplicate synonyms; use widely understood sector names

Responsibilities requirements:
- return 5-10 detailed activity statements when enough signals exist
- use "description" field (not "name")
- each 8-20 words, start with an active verb
- include action + context (+ optional outcome)
- avoid short labels like "Project Management" or "Marketing"
- merge overlapping activities and avoid duplicates

4. SENIORITY INFERENCE AND DISPLAY LANGUAGE (${requested})
- Write any human-readable seniority evidence in ${outputLangHuman} (same as the rest of the profile).
- Machine-readable VALUE fields MUST stay parser-safe:
  - seniority.currentStatus.value must be exactly one of these English slugs (never localized tokens): ${CURRENT_EMPLOYMENT_STATUS_CANONICAL.join(', ')}, or "". Map CV wording (e.g. Angestellt/Beschäftigt→employed, Arbeitnehmer→employed, employed→employed).
  - highestDegree.value and mostSeniorRole.value should remain recognizable to downstream normalization (prefer English canonical tokens such as masters/bachelors/phd where applicable).
- yearsOfExperience robust estimation
- highestDegree
- mostSeniorRole

5. CONFIDENCE SCORING
Use 0.0–1.0.

6. EVIDENCE
Do not hallucinate evidence.

7. HANDLE MISSING DATA
Return empty value/array, confidence 0.0, evidence [].

8. NORMALIZATION
Avoid duplicates.

CV TEXT:
${safeCvText}`;

  return [
    { role: 'system', content: `${system}\nRequested document output locale: ${requested} (${outputLangHuman}).` },
    { role: 'user', content: user }
  ];
}

module.exports = {
  buildMessages
};

