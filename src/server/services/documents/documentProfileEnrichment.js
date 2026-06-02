const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const { runStageIfCvPipeline } = require('../../utils/metricsLogger');

// Optional: DOCX parsing (installed in Phase 3). If unavailable, we fall back gracefully.
let mammoth = null;
try {
  // eslint-disable-next-line global-require
  mammoth = require('mammoth');
} catch (e) {
  mammoth = null;
}

function normalizeSkill(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[•\-\*]\s*/, '')
    .substring(0, 80);
}

function uniqStrings(values) {
  const seen = new Set();
  const out = [];
  for (const v of values || []) {
    const s = normalizeSkill(v);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function extractFromTextHeuristics(text) {
  const t = String(text || '');
  const lower = t.toLowerCase();

  const extracted = {
    skills: [],
    workExperience: [],
    education: [],
    certifications: [],
    projects: []
  };

  // Skills section heuristic
  const skillsSection = t.match(/Skills?[\s\S]{0,800}(?=\n\s*(?:Experience|Education|Projects|Languages|Certifications|$))/i);
  if (skillsSection) {
    const skillsContent = skillsSection[0].replace(/Skills?\s*/i, '');
    const stopWords = ['certification', 'experience', 'education', 'projects', 'languages'];
    let skills = skillsContent
      .split(/,/)
      .map((s) => s.trim().replace(/^[:\-]\s*/, ''))
      .filter(Boolean);
    if (skills.length < 3) {
      skills = skillsContent
        .split(/\n/)
        .map((s) => s.trim().replace(/^[:\-]\s*/, ''))
        .filter((s) => s && s.length < 60);
    }
    if (skills.length < 3) {
      skills = skillsContent
        .split(/[•\-\*]/)
        .map((s) => s.trim().replace(/^[:\-]\s*/, ''))
        .filter((s) => s && s.length < 60);
    }
    // Remove section header bleed (e.g. "Certifications: ...")
    const cleaned = [];
    for (const s of skills) {
      const low = s.toLowerCase();
      if (stopWords.some((w) => low.includes(w))) break;
      cleaned.push(s);
    }
    extracted.skills = uniqStrings(cleaned).slice(0, 50);
  }

  // Certifications heuristic
  const certSection = t.match(/Certifications?[\s\S]{0,600}(?=\n\s*(?:Experience|Education|Skills|Projects|$))/i);
  if (certSection) {
    const certContent = certSection[0].replace(/Certifications?\s*/i, '');
    const lines = certContent.split(/\n/).map((s) => s.trim()).filter((s) => s && s.length < 120);
    extracted.certifications = uniqStrings(lines).slice(0, 20);
  }

  // Projects heuristic
  const projectSection = t.match(/Projects?[\s\S]{0,1000}(?=\n\s*(?:Experience|Education|Skills|Certifications|$))/i);
  if (projectSection) {
    const projContent = projectSection[0].replace(/Projects?\s*/i, '');
    const lines = projContent.split(/\n/).map((s) => s.trim()).filter((s) => s.length > 8);
    extracted.projects = lines.slice(0, 10).map((line) => ({ name: line.substring(0, 80), description: line, skills: [] }));
  }

  // Experience heuristic (titles only)
  const experienceSection = t.match(/(?:Work\s+)?Experience[\s\S]{0,1400}(?=\n\s*(?:Education|Skills|Projects|Certifications|$))/i);
  if (experienceSection) {
    const expText = experienceSection[0];
    const jobPatterns = [
      /([A-Z][a-zA-Z\s]+)\s+at\s+([A-Z][a-zA-Z\s&]+)/g,
      /([A-Z][a-zA-Z\s]+)\s*[-–]\s*([A-Z][a-zA-Z\s&]+)/g
    ];
    const jobs = [];
    for (const pattern of jobPatterns) {
      let match;
      // eslint-disable-next-line no-cond-assign
      while ((match = pattern.exec(expText)) !== null && jobs.length < 8) {
        jobs.push({ title: match[1].trim(), company: match[2].trim(), description: '' });
      }
    }
    extracted.workExperience = jobs;
  }

  // Education heuristic (institutions)
  const educationSection = t.match(/Education[\s\S]{0,800}(?=\n\s*(?:Experience|Skills|Projects|Certifications|$))/i);
  if (educationSection) {
    const eduText = educationSection[0];
    const institutions = eduText.match(/([A-Z][a-zA-Z\s&]+(?:University|College|Institute|School|Academy))/g);
    if (institutions) {
      extracted.education = [...new Set(institutions)].slice(0, 8).map((inst) => ({ institution: inst.trim() }));
    }
  }

  // If no skills section found, do a tiny fallback: pick frequent tokens that look like skills (very conservative)
  if (extracted.skills.length === 0) {
    const candidates = t
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 40)
      .filter((s) => /[A-Za-z]/.test(s))
      .slice(0, 200);
    extracted.skills = uniqStrings(candidates).slice(0, 20);
  }

  // Light sanity: if extraction is empty, return empty
  const any =
    extracted.skills.length ||
    extracted.workExperience.length ||
    extracted.education.length ||
    extracted.certifications.length ||
    extracted.projects.length;

  return {
    extracted,
    status: any ? (extracted.skills.length >= 5 ? 'success' : 'partial') : 'failed'
  };
}

async function parseDocumentToText(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();

  const inferKindFromBuffer = (buf) => {
    if (!buf || buf.length < 4) return null;
    // PDF: %PDF-
    if (buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return 'pdf';
    // PNG signature
    if (
      buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
    ) return 'png';
    // JPEG signature
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    // ZIP local file header (docx container)
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
    // OLE compound file (legacy .doc)
    if (
      buf.length >= 8 &&
      buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 &&
      buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1
    ) return 'ole';
    return null;
  };

  return runStageIfCvPipeline('parse_document_total', { memory: true }, async () => {
    const buf = await runStageIfCvPipeline('parse_read_file', {}, async () => fs.readFile(filePath));
    const inferredKind = inferKindFromBuffer(buf);
    const treatAsPdf = ext === '.pdf' || inferredKind === 'pdf';
    const treatAsImage = ext === '.png' || ext === '.jpg' || ext === '.jpeg' || inferredKind === 'png' || inferredKind === 'jpeg';
    const treatAsDocx = (ext === '.docx') || (ext !== '.doc' && inferredKind === 'zip');
    const treatAsDoc = ext === '.doc' || inferredKind === 'ole';
    const treatAsTxt = ext === '.txt';

    if (treatAsPdf) {
      const pdf = await runStageIfCvPipeline('pdf_text_layer', { memory: true }, async () => pdfParse(buf));
      let text = pdf.text || '';
      const normalized = String(text).replace(/\u00a0/g, ' ').trim();
      if (normalized.length === 0) {
        const { extractPdfTextViaOcr } = require('./pdfImageOcr');
        text = await runStageIfCvPipeline('pdf_ocr_total', { memory: true }, async () => extractPdfTextViaOcr(buf));
      }
      return text;
    }

    if (treatAsImage) {
      const { extractImageTextViaOcr } = require('./pdfImageOcr');
      return runStageIfCvPipeline('image_ocr_total', { memory: true }, async () => extractImageTextViaOcr(buf));
    }

    if ((treatAsDocx || treatAsDoc) && mammoth && treatAsDocx) {
      return runStageIfCvPipeline('docx_extract_text', {}, async () => {
        const res = await mammoth.extractRawText({ buffer: buf });
        return res.value || '';
      });
    }

    if (treatAsTxt) {
      return buf.toString('utf8');
    }

    return '';
  });
}

function mapExtractedToSimulationInputs(extracted, baseInputs) {
  const out = JSON.parse(JSON.stringify(baseInputs || {}));

  const currentStructured = out.structuredUserInfo && typeof out.structuredUserInfo === 'object'
    ? out.structuredUserInfo
    : {};

  /** Coerce stored skills (string | object | array) to string[] for merge. */
  function normalizeStoredSkills(raw) {
    if (raw == null) return [];
    if (Array.isArray(raw)) {
      return raw.map((s) => (typeof s === 'string' ? s : s && s.name != null ? String(s.name) : '')).filter(Boolean);
    }
    if (typeof raw === 'string') {
      return raw
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (typeof raw === 'object') {
      return Object.values(raw)
        .map((v) => (typeof v === 'string' ? v : v && v.name != null ? String(v.name) : ''))
        .filter(Boolean);
    }
    return [];
  }

  const existingSkills = normalizeStoredSkills(currentStructured.skills);

  out.structuredUserInfo = {
    skills: uniqStrings([...existingSkills, ...(extracted.skills || [])]),
    skillsInDevelopment: Array.isArray(currentStructured.skillsInDevelopment) ? currentStructured.skillsInDevelopment : [],
    keyResponsibilities: Array.isArray(currentStructured.keyResponsibilities) ? currentStructured.keyResponsibilities : [],
    domains: Array.isArray(currentStructured.domains) ? currentStructured.domains : []
  };

  return out;
}

module.exports = {
  parseDocumentToText,
  extractFromTextHeuristics,
  mapExtractedToSimulationInputs
};

