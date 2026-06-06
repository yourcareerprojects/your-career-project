const CvExtractionJob = require('../models/CvExtractionJob');
const User = require('../models/User');
const {
  createExtractionJob,
  cancelActiveCvExtractionJobsForDocument,
} = require('../services/documents/cvExtractionJobService');
const { getRateLimitService, resetRateLimitServiceForTests } = require('../services/rateLimit/RateLimitService');

describe('cancelActiveCvExtractionJobsForDocument', () => {
  beforeEach(() => {
    resetRateLimitServiceForTests();
  });

  test('marks queued jobs failed so they no longer count toward upload concurrency', async () => {
    const user = await User.create({
      name: 'Cancel Job Tester',
      email: `cancel-job-${Date.now()}@example.com`,
      password: 'Test123!@#',
      emailVerified: true,
      profile: {
        documents: [{
          type: 'cv',
          name: 'cv.pdf',
          path: '/tmp/cv.pdf',
          uploadDate: new Date(),
        }],
      },
    });

    const documentId = user.profile.documents[0]._id;
    const job = await createExtractionJob(documentId, user._id, 'en');
    expect(job.status).toBe('queued');

    const activeBefore = await getRateLimitService().countActiveExtractionJobs(user._id);
    expect(activeBefore).toBe(1);

    const cancelled = await cancelActiveCvExtractionJobsForDocument(documentId);
    expect(cancelled).toBe(1);

    const stored = await CvExtractionJob.findOne({ jobId: job.jobId }).lean();
    expect(stored.status).toBe('failed');

    const activeAfter = await getRateLimitService().countActiveExtractionJobs(user._id);
    expect(activeAfter).toBe(0);
  });
});
