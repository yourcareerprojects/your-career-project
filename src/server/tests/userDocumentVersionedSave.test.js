const mongoose = require('mongoose');
const User = require('../models/User');
const { updateUserDocumentWithVersionRetry } = require('../services/documents/userDocumentVersionedSave');

describe('userDocumentVersionedSave', () => {
  test('updateUserDocumentWithVersionRetry succeeds after VersionError', async () => {
    const created = await User.create({
      email: `version-retry-${Date.now()}@example.com`,
      password: 'password123!',
      profile: {
        documents: [{
          type: 'cv',
          extractionStatus: 'completed',
          localizationStatus: 'pending',
          extractedProfileData: { userIdentity: {}, structuredUserInfo: {} },
        }],
      },
    });

    const docId = created.profile.documents[0]._id;
    const userId = created._id;

    const first = await User.findById(userId);
    first.profile.documents.id(docId).localizationStatus = 'complete';
    await first.save();

    const stale = await User.findById(userId);
    stale.__v -= 1;

    const result = await updateUserDocumentWithVersionRetry(userId, docId, (_user, doc) => {
      doc.localizationStatus = 'complete';
    });

    expect(result.ok).toBe(true);
    const fresh = await User.findById(userId);
    expect(fresh.profile.documents.id(docId).localizationStatus).toBe('complete');
  });
});
