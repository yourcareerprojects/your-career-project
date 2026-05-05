const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const profileRoutes = require('../routes/profile');
const languageResolutionMiddleware = require('../middleware/languageResolution');
const User = require('../models/User');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', languageResolutionMiddleware);
  app.use('/api/profile', profileRoutes);
  return app;
}

function createTokenForUser(user) {
  return jwt.sign(
    { userId: user._id.toString(), tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_SECRET
  );
}

describe('POST /api/profile/saved-career-steps/bulk-delete', () => {
  it('removes all matching saved career steps atomically and returns counts', async () => {
    const user = await User.create({
      name: 'Bulk Delete Tester',
      email: 'bulk-delete@example.com',
      password: 'Test123!@#',
      emailVerified: true,
      accountStatus: {
        isVerified: true,
        isActive: true,
      },
      savedCareerSteps: [
        {
          stepId: 'step-a',
          title: { en: 'Role A', de: 'Rolle A' },
          description: { en: 'Desc A', de: 'Beschr A' },
        },
        {
          stepId: 'step-b',
          title: { en: 'Role B', de: 'Rolle B' },
          description: { en: 'Desc B', de: 'Beschr B' },
        },
        {
          stepId: 'step-c',
          title: { en: 'Role C', de: 'Rolle C' },
          description: { en: 'Desc C', de: 'Beschr C' },
        },
      ],
    });
    const token = createTokenForUser(user);
    const app = buildTestApp();

    const res = await request(app)
      .post('/api/profile/saved-career-steps/bulk-delete?lang=en')
      .set('Authorization', `Bearer ${token}`)
      .send({ stepIds: ['step-a', 'step-c', 'missing-step'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.requestedCount).toBe(3);
    expect(res.body.removedCount).toBe(2);
    expect(res.body.notFoundStepIds).toEqual(['missing-step']);
    expect(Array.isArray(res.body.savedCareerSteps)).toBe(true);
    expect(res.body.savedCareerSteps).toHaveLength(1);
    expect(res.body.savedCareerSteps[0].stepId).toBe('step-b');

    const refreshed = await User.findById(user._id).lean();
    expect(refreshed.savedCareerSteps.map((s) => s.stepId)).toEqual(['step-b']);
  });

  it('returns 400 when stepIds payload is empty', async () => {
    const user = await User.create({
      name: 'Bulk Delete Validator',
      email: 'bulk-delete-validator@example.com',
      password: 'Test123!@#',
      emailVerified: true,
      accountStatus: {
        isVerified: true,
        isActive: true,
      },
      savedCareerSteps: [
        {
          stepId: 'step-z',
          title: { en: 'Role Z', de: 'Rolle Z' },
        },
      ],
    });
    const token = createTokenForUser(user);
    const app = buildTestApp();

    const res = await request(app)
      .post('/api/profile/saved-career-steps/bulk-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ stepIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('stepIds must be a non-empty array');
  });
});
