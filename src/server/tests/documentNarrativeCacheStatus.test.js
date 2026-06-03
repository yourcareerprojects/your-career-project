const mongoose = require('mongoose');
const User = require('../models/User');
const documentController = require('../controllers/documentController');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('documentController.getDocumentNarrativeCacheStatus', () => {
  test('returns readiness and inFlight without throwing when body is present', async () => {
    const docId = new mongoose.Types.ObjectId();
    const user = await User.create({
      email: 'narrative-cache-status@example.com',
      password: 'password123!',
      profile: {
        documents: [
          {
            _id: docId,
            type: 'resume',
            name: 'cv.pdf',
            extractedProfileData: {
              userIdentity: { workEnjoyMost: 'Building products' },
              structuredUserInfo: { skills: [{ name: 'JavaScript' }] },
            },
          },
        ],
      },
    });

    const req = {
      user: { userId: String(user._id) },
      params: { documentId: String(docId) },
      language: 'en',
      body: {
        userIdentity: { workEnjoyMost: 'Building products' },
        structuredUserInfo: { skills: [{ name: 'JavaScript' }] },
        acceptedFields: {},
      },
    };
    const res = mockRes();

    await documentController.getDocumentNarrativeCacheStatus(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('ready');
    expect(res.body).toHaveProperty('fingerprintMatches');
    expect(res.body).toHaveProperty('inFlight');
    expect(res.body.inFlight).toBe(false);
  });

  test('GET without body still returns inFlight without server error', async () => {
    const docId = new mongoose.Types.ObjectId();
    const user = await User.create({
      email: 'narrative-cache-status-get@example.com',
      password: 'password123!',
      profile: {
        documents: [
          {
            _id: docId,
            type: 'resume',
            extractedProfileData: { userIdentity: {}, structuredUserInfo: {} },
          },
        ],
      },
    });

    const req = {
      user: { userId: String(user._id) },
      params: { documentId: String(docId) },
      language: 'en',
    };
    const res = mockRes();

    await documentController.getDocumentNarrativeCacheStatus(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).not.toBe('Error reading narrative cache status');
    expect(res.body.inFlight).toBe(false);
  });
});
