const User = require('../../models/User');
const { isCvDocumentType } = require('../../../constants/documentTypes');
const { parseDocumentToText, extractFromTextHeuristics, mapExtractedToSimulationInputs } = require('./documentProfileEnrichment');

function pickLatestCvDoc(profile) {
  const docs = profile && profile.documents ? profile.documents : [];
  const candidates = docs.filter((d) => !d.isArchived && isCvDocumentType(d.type));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => new Date(b.uploadDate || 0) - new Date(a.uploadDate || 0))[0];
}

function docIdString(doc) {
  if (!doc) return '';
  // Mongoose subdoc _id
  // eslint-disable-next-line no-underscore-dangle
  return String(doc._id || '');
}

/**
 * Returns inputs merged with document-derived enrichment.
 * If no docs or parsing fails, returns baseInputs unchanged.
 */
async function getEnrichedSimulationInputs({ userId, baseInputs, force = false, cacheOnly = false }) {
  const user = await User.findById(userId);
  if (!user) return { inputs: baseInputs, enrichment: null, cacheMiss: false };

  const doc = pickLatestCvDoc(user.profile);
  if (!doc || !doc.path) {
    return { inputs: baseInputs, enrichment: null, cacheMiss: false };
  }

  const docId = docIdString(doc);
  const cache = user.profile.careerSimulationInputs?.documentEnrichment;
  const cacheHasSameDoc = cache && Array.isArray(cache.sourceDocumentIds) && cache.sourceDocumentIds.includes(docId);
  const cacheFresh = cache && cache.lastParsedAt && (Date.now() - new Date(cache.lastParsedAt).getTime()) < (7 * 24 * 3600 * 1000);

  let enrichment = cacheHasSameDoc && cacheFresh ? cache : null;

  if ((!enrichment || force) && !cacheOnly) {
    let text = '';
    try {
      text = await parseDocumentToText(doc.path);
    } catch (e) {
      text = '';
    }
    const { extracted, status } = extractFromTextHeuristics(text);

    enrichment = {
      status,
      message: status === 'failed' ? 'No extractable text found.' : 'Extracted profile signals from document.',
      extractedSkills: extracted.skills || [],
      extractedWorkExperience: extracted.workExperience || [],
      extractedEducation: extracted.education || [],
      extractedCertifications: extracted.certifications || [],
      extractedProjects: extracted.projects || [],
      sourceDocumentIds: docId ? [docId] : [],
      lastParsedAt: new Date()
    };

    // Persist cache but do not overwrite manually edited inputs.
    if (!user.profile.careerSimulationInputs) user.profile.careerSimulationInputs = {};
    user.profile.careerSimulationInputs.documentEnrichment = enrichment;
    await user.save();
  }

  if (!enrichment) {
    return { inputs: baseInputs, enrichment: null, cacheMiss: true };
  }

  const mergedInputs = mapExtractedToSimulationInputs(
    {
      skills: enrichment.extractedSkills,
      workExperience: enrichment.extractedWorkExperience,
      education: enrichment.extractedEducation,
      certifications: enrichment.extractedCertifications,
      projects: enrichment.extractedProjects
    },
    baseInputs
  );

  return { inputs: mergedInputs, enrichment, cacheMiss: false };
}

module.exports = {
  getEnrichedSimulationInputs
};

