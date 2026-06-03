/**
 * Retry User.save() on Mongoose VersionError when parallel post-extraction tasks update the same user.
 */

const User = require('../../models/User');

const DEFAULT_MAX_ATTEMPTS = 6;

/**
 * @param {import('mongoose').Document} user
 * @param {{ maxAttempts?: number }} [options]
 */
async function saveUserWithVersionRetry(user, options = {}) {
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : DEFAULT_MAX_ATTEMPTS;
  let attempt = 0;
  let current = user;

  while (attempt < maxAttempts) {
    try {
      await current.save();
      return current;
    } catch (err) {
      if (err?.name !== 'VersionError' || attempt >= maxAttempts - 1) {
        throw err;
      }
      const reloaded = await User.findById(current._id);
      if (!reloaded) throw err;
      const snapshot = current.toObject();
      reloaded.set(snapshot);
      if (current.isModified()) {
        for (const path of current.modifiedPaths()) {
          reloaded.markModified(path);
        }
      }
      current = reloaded;
      attempt += 1;
    }
  }
  return current;
}

/**
 * Load user + embedded document, apply mutator, save with version retry.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} documentId
 * @param {(user: import('mongoose').Document, doc: import('mongoose').Document) => void} mutator
 * @param {{ maxAttempts?: number }} [options]
 */
async function updateUserDocumentWithVersionRetry(userId, documentId, mutator, options = {}) {
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const user = await User.findById(userId);
    if (!user) return { ok: false, reason: 'user_not_found' };
    const doc = user.profile?.documents?.id(documentId);
    if (!doc) return { ok: false, reason: 'document_not_found' };

    mutator(user, doc);
    if (user.isModified('profile.documents')) {
      user.markModified('profile.documents');
    }
    if (user.isModified('profile.cvExtractLocalization')) {
      user.markModified('profile.cvExtractLocalization');
    }

    try {
      await user.save();
      return { ok: true, user, doc };
    } catch (err) {
      if (err?.name !== 'VersionError' || attempt >= maxAttempts - 1) {
        throw err;
      }
    }
  }

  return { ok: false, reason: 'version_retry_exhausted' };
}

module.exports = {
  saveUserWithVersionRetry,
  updateUserDocumentWithVersionRetry,
};
