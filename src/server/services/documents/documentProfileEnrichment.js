const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const { runStageIfCvPipeline } = require('../../utils/metricsLogger');
const { getRawItems } = require('../profile/profileReviewSaveService');

// Optional: DOCX parsing (installed in Phase 3). If unavailable, we fall back gracefully.
let mammoth = null;
try {
  // eslint-disable-next-line global-require
  mammoth = require('mammoth');
} catch (e) {
  mammoth = null;
}

// Optional: legacy .doc (OLE) parsing.
let WordExtractor = null;
try {
  // eslint-disable-next-line global-require
  WordExtractor = require('word-extractor');
} catch (e) {
  WordExtractor = null;
}

function normalizeSkill(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[•\-\*]\s*/, '')
    .substring(0, 80);
}

function looksLikeSkillCandidate(value) {
  const s = normalizeSkill(value);
  if (!s || s.length < 2 || s.length > 50) return false;
  const words = s.split(/\s+/);
  if (words.length > 6) return false;
  if (/^\d{4}\b/.test(s) || /\b\d{4}\s*[-–—]\s*(?:\d{4}|present|current)\b/i.test(s)) return false;
  if (/@|https?:\/\/|www\./i.test(s)) return false;
  if (/^[+\d][\d\s\-().]{6,}$/.test(s)) return false;
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(s)) return false;
  if (/\b(university|college|school|institute|experience|education|certification|references?|curriculum vitae|resume)\b/i.test(s)) return false;
  if (/[.!?]$/.test(s) && words.length > 4) return false;
  return true;
}

function filterHeuristicSkillNames(values) {
  return uniqStrings(values).filter(looksLikeSkillCandidate);
}

function filterHeuristicSkillObjects(values) {
  return filterHeuristicSkillNames(
    (Array.isArray(values) ? values : []).map((item) => (typeof item === 'string' ? item : item?.name))
  ).map((name) => ({ name }));
}

const SKILLS_SECTION_END_PATTERN =
  /\n\s*(?:Experience|Work\s+Experience|Professional\s+Experience|Employment|Education|Projects|Languages|Certifications|References?)\b/i;

function extractSkillsSectionContent(text) {
  const t = String(text || '');
  // Require a standalone "Skills" section header (not "soft skills" mid-sentence).
  const headerMatch = t.match(
    /(?:^|\n)\s*(?:(?:Technical|Core|Key|Professional)\s+)?(?<![A-Za-z])Skills(?![A-Za-z])\s*(?::|[-–—])?\s*/i
  );
  if (!headerMatch || headerMatch.index == null) return '';

  const afterHeaderStart = headerMatch.index + headerMatch[0].length;
  const tail = t.slice(afterHeaderStart);
  const endMatch = tail.match(SKILLS_SECTION_END_PATTERN);
  const sectionBody = endMatch ? tail.slice(0, endMatch.index) : tail.slice(0, 1200);
  return sectionBody.trim();
}

function parseSkillsFromSectionContent(skillsContent) {
  if (!skillsContent) return [];

  const stopWords = ['certification', 'experience', 'education', 'projects', 'languages'];
  let skills = skillsContent
    .split(/,/)
    .map((s) => s.trim().replace(/^[:\-]\s*/, ''))
    .filter(Boolean);

  if (skills.length < 3) {
    skills = skillsContent
      .split(/\n/)
      .map((s) => s.trim().replace(/^[:\-•*]\s*/, ''))
      .filter((s) => s && s.length <= 50);
  }
  if (skills.length < 3) {
    skills = skillsContent
      .split(/[•\-\*]/)
      .map((s) => s.trim().replace(/^[:\-]\s*/, ''))
      .filter((s) => s && s.length <= 50);
  }

  const cleaned = [];
  for (const s of skills) {
    const low = s.toLowerCase();
    if (stopWords.some((w) => low.includes(w))) break;
    if (!looksLikeSkillCandidate(s)) continue;
    cleaned.push(s);
  }
  return filterHeuristicSkillNames(cleaned).slice(0, 25);
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

const INSTITUTION_NAME_PATTERN = /([A-Z][a-zA-Z\s&]+(?:University|College|Institute|School|Academy))/g;

const EDUCATION_SECTION_STOP =
  '(?=\\n\\s*(?:Experience|Skills|Work|Projects|Certifications|$))';
const EXPERIENCE_SECTION_STOP =
  '(?=\\n\\s*(?:Education|Skills|Projects|Certifications|$))';

function extractEducationSectionText(text, maxSectionLen = 800) {
  const t = String(text || '');
  const match = t.match(
    new RegExp(`Education[\\s\\S]{0,${maxSectionLen}}${EDUCATION_SECTION_STOP}`, 'i')
  );
  return match ? match[0] : '';
}

/**
 * @param {string} text
 * @param {{ maxEntries?: number, maxSectionLen?: number }} [options]
 * @returns {Array<{ institution: string }>}
 */
function extractEducationInstitutionsFromText(text, options = {}) {
  const { maxEntries = 8, maxSectionLen = 800 } = options;
  const eduText = extractEducationSectionText(text, maxSectionLen);
  if (!eduText) return [];
  const institutions = eduText.match(INSTITUTION_NAME_PATTERN);
  if (!institutions) return [];
  return [...new Set(institutions)].slice(0, maxEntries).map((inst) => ({
    institution: inst.trim(),
  }));
}

function extractExperienceSectionText(text, maxSectionLen = 1400) {
  const t = String(text || '');
  const match = t.match(
    new RegExp(`(?:Work\\s+)?Experience[\\s\\S]{0,${maxSectionLen}}${EXPERIENCE_SECTION_STOP}`, 'i')
  );
  return match ? match[0] : '';
}

/**
 * @param {string} text
 * @param {{ maxJobs?: number, maxSectionLen?: number }} [options]
 * @returns {Array<{ title: string, company: string, description: string }>}
 */
function extractWorkExperienceJobsFromText(text, options = {}) {
  const { maxJobs = 8, maxSectionLen = 1400 } = options;
  const expText = extractExperienceSectionText(text, maxSectionLen);
  if (!expText) return [];

  const jobPatterns = [
    /([A-Z][a-zA-Z\s]+)\s+at\s+([A-Z][a-zA-Z\s&]+)/g,
    /([A-Z][a-zA-Z\s]+)\s*[-–]\s*([A-Z][a-zA-Z\s&]+)/g,
  ];
  const jobs = [];
  for (const pattern of jobPatterns) {
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = pattern.exec(expText)) !== null && jobs.length < maxJobs) {
      jobs.push({ title: match[1].trim(), company: match[2].trim(), description: '' });
    }
  }
  return jobs;
}

/**
 * Fallback when title/company patterns miss: long experience section lines as descriptions.
 * @param {string} text
 * @param {{ maxLines?: number, maxSectionLen?: number, minLineLen?: number }} [options]
 * @returns {string[]}
 */
function extractWorkExperienceDescriptionLinesFromText(text, options = {}) {
  const { maxLines = 4, maxSectionLen = 1000, minLineLen = 15 } = options;
  const expText = extractExperienceSectionText(text, maxSectionLen);
  if (!expText) return [];
  const body = expText.replace(/(?:Work\s+)?Experience\s*/i, '');
  return body
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > minLineLen)
    .slice(0, maxLines);
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

  // Skills section heuristic — only when an explicit Skills section header exists.
  const skillsContent = extractSkillsSectionContent(t);
  if (skillsContent) {
    extracted.skills = parseSkillsFromSectionContent(skillsContent);
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

  extracted.workExperience = extractWorkExperienceJobsFromText(t);
  extracted.education = extractEducationInstitutionsFromText(t);


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

/**
 * @param {string} filePath
 * @returns {Promise<{ text: string, source: string }>}
 */
async function parseDocumentToTextWithMeta(filePath) {
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
      const {
        normalizePdfPlainText,
        isPdfTextLayerSufficient,
        extractPdfTextViaPdfJs,
        loadPdfJsDocument,
        destroyPdfJsDocument,
      } = require('./pdfTextExtraction');

      const pdf = await runStageIfCvPipeline('pdf_text_layer', { memory: true }, async () => pdfParse(buf));
      let text = normalizePdfPlainText(pdf.text || '');
      let source = isPdfTextLayerSufficient(text) ? 'pdf_text_layer' : 'unknown';
      let pdfDocument = null;

      try {
        if (!isPdfTextLayerSufficient(text)) {
          text = await runStageIfCvPipeline('pdf_js_text_layer', { memory: true }, async () => {
            pdfDocument = await loadPdfJsDocument(buf);
            const pdfJsText = await extractPdfTextViaPdfJs(buf, { pdfDocument });
            return normalizePdfPlainText(pdfJsText);
          });
          if (isPdfTextLayerSufficient(text)) {
            source = 'pdf_js';
          }
        }

        if (!isPdfTextLayerSufficient(text)) {
          if (!pdfDocument) {
            pdfDocument = await loadPdfJsDocument(buf);
          }
          const { extractPdfTextViaOcr } = require('./pdfImageOcr');
          text = await runStageIfCvPipeline('pdf_ocr_total', { memory: true }, async () =>
            extractPdfTextViaOcr(buf, { pdfDocument })
          );
          source = 'pdf_ocr';
        }
      } finally {
        await destroyPdfJsDocument(pdfDocument);
      }

      return { text: text || '', source };
    }

    if (treatAsImage) {
      const { extractImageTextViaOcr } = require('./pdfImageOcr');
      const text = await runStageIfCvPipeline('image_ocr_total', { memory: true }, async () =>
        extractImageTextViaOcr(buf)
      );
      return { text: text || '', source: 'image_ocr' };
    }

    if (treatAsDocx && mammoth) {
      const text = await runStageIfCvPipeline('docx_extract_text', {}, async () => {
        const res = await mammoth.extractRawText({ buffer: buf });
        return res.value || '';
      });
      return { text: text || '', source: 'docx' };
    }

    if (treatAsDoc && WordExtractor) {
      const text = await runStageIfCvPipeline('doc_extract_text', {}, async () => {
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(buf);
        return extracted.getBody() || '';
      });
      return { text: text || '', source: 'doc' };
    }

    if (treatAsDoc) {
      return { text: '', source: 'doc_unsupported' };
    }

    if (treatAsTxt) {
      return { text: buf.toString('utf8'), source: 'txt' };
    }

    return { text: '', source: 'unknown' };
  });
}

async function parseDocumentToText(filePath) {
  const { text } = await parseDocumentToTextWithMeta(filePath);
  return text;
}

function mergeDimensionRawItems(existingDimension, incomingItems = []) {
  const existing = getRawItems(existingDimension);
  const merged = uniqStrings([...existing, ...incomingItems]);

  if (existingDimension && typeof existingDimension === 'object' && !Array.isArray(existingDimension)) {
    return {
      ...existingDimension,
      raw_items: merged,
    };
  }
  if (Array.isArray(existingDimension)) {
    return merged;
  }
  if (merged.length === 0) {
    return { raw_items: [], summary_text: '' };
  }
  return { raw_items: merged, summary_text: '' };
}

function mapExtractedToSimulationInputs(extracted, baseInputs) {
  const out = JSON.parse(JSON.stringify(baseInputs || {}));

  const currentStructured = out.structuredUserInfo && typeof out.structuredUserInfo === 'object'
    ? out.structuredUserInfo
    : {};

  // Preserve narrative dimensions (domains, skillDomains, summary_text, etc.); merge skills via raw_items.
  out.structuredUserInfo = {
    ...currentStructured,
    skills: mergeDimensionRawItems(currentStructured.skills, extracted.skills || []),
  };

  return out;
}

module.exports = {
  parseDocumentToText,
  parseDocumentToTextWithMeta,
  extractFromTextHeuristics,
  mapExtractedToSimulationInputs,
  looksLikeSkillCandidate,
  filterHeuristicSkillNames,
  filterHeuristicSkillObjects,
  extractSkillsSectionContent,
  parseSkillsFromSectionContent,
  extractEducationInstitutionsFromText,
  extractWorkExperienceJobsFromText,
  extractWorkExperienceDescriptionLinesFromText,
};

