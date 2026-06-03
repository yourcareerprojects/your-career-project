/**
 * Non-display work after CV review-save (CSI recalc, etc.).
 */

const User = require('../../models/User');

/**
 * @param {string} userId
 * @param {{ editorId?: string, changes?: object }} [options]
 */
function schedulePostProfileReviewSaveWork(userId, options = {}) {
  if (!userId) return;
  const editorId = options.editorId || userId;
  const changes = options.changes || { recalculatedFromProfileReview: true };

  void (async () => {
    try {
      const { calculateCareerSimulationInputs } = require('../../controllers/profileController')
        .__careerSimulationDepsForEngine;
      const user = await User.findById(userId);
      if (!user) return;

      const computed = await calculateCareerSimulationInputs(user.profile);
      const defaultEnrichment = {
        status: 'none',
        message: '',
        extractedSkills: [],
        extractedWorkExperience: [],
        extractedEducation: [],
        extractedCertifications: [],
        extractedProjects: [],
        sourceDocumentIds: [],
        lastParsedAt: null,
      };
      if (!user.profile.careerSimulationInputs) {
        user.profile.careerSimulationInputs = { documentEnrichment: defaultEnrichment };
      }
      const csi = user.profile.careerSimulationInputs;
      if (!csi.documentEnrichment || typeof csi.documentEnrichment !== 'object') {
        csi.documentEnrichment = defaultEnrichment;
      }
      csi.structuredUserInfo = computed.structuredUserInfo;
      csi.userIdentity = computed.userIdentity;
      csi.seniority = computed.seniority;
      csi.lastCalculated = new Date();
      csi.isManuallyEdited = csi.isManuallyEdited || false;
      if (Array.isArray(csi.editHistory)) {
        csi.editHistory.push({ editedAt: new Date(), editor: editorId, changes });
      } else {
        csi.editHistory = [];
      }
      user.markModified('profile.careerSimulationInputs');
      await user.save();
    } catch (e) {
      console.warn('schedulePostProfileReviewSaveWork failed (non-fatal):', e?.message || e);
    }
  })();
}

module.exports = {
  schedulePostProfileReviewSaveWork,
};
