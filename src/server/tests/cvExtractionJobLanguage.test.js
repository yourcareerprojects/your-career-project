const mongoose = require('mongoose');
const CvExtractionJob = require('../models/CvExtractionJob');
const User = require('../models/User');
const { createExtractionJob } = require('../services/documents/cvExtractionJobService');
const {
  resolveJobSnapshotLanguage,
  resolveJobLanguageFromDocument,
  normalizeCvJobLanguage,
} = require('../services/documents/cvExtractionJobLanguage');

describe('cvExtractionJobLanguage', () => {
  test('resolveJobSnapshotLanguage prefers request lang over user language', () => {
    expect(
      resolveJobSnapshotLanguage({ requestLang: 'de', userLanguage: 'en' })
    ).toBe('de');
  });

  test('resolveJobSnapshotLanguage falls back to user language', () => {
    expect(resolveJobSnapshotLanguage({ userLanguage: 'de' })).toBe('de');
  });

  test('resolveJobSnapshotLanguage defaults to en', () => {
    expect(resolveJobSnapshotLanguage({})).toBe('en');
  });

  test('normalizeCvJobLanguage clamps unsupported locales to en', () => {
    expect(normalizeCvJobLanguage('fr')).toBe('en');
    expect(normalizeCvJobLanguage('de-DE')).toBe('de');
  });

  test('resolveJobLanguageFromDocument uses job snapshot only', () => {
    expect(resolveJobLanguageFromDocument({ language: 'de' })).toBe('de');
    expect(resolveJobLanguageFromDocument({ language: 'en' })).toBe('en');
    expect(resolveJobLanguageFromDocument({})).toBe('en');
    expect(resolveJobLanguageFromDocument(null)).toBe('en');
  });
});

describe('createExtractionJob language snapshot', () => {
  let userId;

  beforeEach(async () => {
    const user = await User.create({
      email: `lang-job-${Date.now()}@example.com`,
      password: 'Test123!@#',
      language: 'en',
    });
    userId = user._id;
  });

  test('persists language=de when passed at creation', async () => {
    const docId = new mongoose.Types.ObjectId();
    const job = await createExtractionJob(docId, userId, 'de');
    expect(job.language).toBe('de');
    const loaded = await CvExtractionJob.findOne({ jobId: job.jobId }).lean();
    expect(loaded.language).toBe('de');
  });

  test('changing user.language after creation does not change stored job language', async () => {
    const docId = new mongoose.Types.ObjectId();
    const job = await createExtractionJob(docId, userId, 'de');
    await User.findByIdAndUpdate(userId, { language: 'en' });
    const loaded = await CvExtractionJob.findOne({ jobId: job.jobId }).lean();
    expect(loaded.language).toBe('de');
    expect(resolveJobLanguageFromDocument(loaded)).toBe('de');
  });

  test('legacy job without language field resolves to en', async () => {
    const legacy = { status: 'queued', stage: 'upload' };
    expect(resolveJobLanguageFromDocument(legacy)).toBe('en');
  });

  test('requeued job document retains original language field', async () => {
    const docId = new mongoose.Types.ObjectId();
    const job = await createExtractionJob(docId, userId, 'de');
    await CvExtractionJob.updateOne(
      { jobId: job.jobId },
      { $set: { status: 'queued', stage: 'upload' } }
    );
    const reloaded = await CvExtractionJob.findOne({ jobId: job.jobId }).lean();
    expect(reloaded.language).toBe('de');
    expect(resolveJobLanguageFromDocument(reloaded)).toBe('de');
  });
});
