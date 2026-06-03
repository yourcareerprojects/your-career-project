const {
  createCvExtractionState,
  completeHeuristics,
  markLayer,
  resetCvExtractionStateForTests,
  CV_HEURISTICS_COMPLETED,
} = require('../services/cv/cvExtractionStateManager');

describe('cvExtractionStateManager', () => {
  afterEach(() => {
    resetCvExtractionStateForTests();
  });

  test('emits CV_HEURISTICS_COMPLETED when heuristics layer completes', async () => {
    const jobId = 'job-test-1';
    createCvExtractionState(jobId);
    const events = [];
    const { onCvExtractionEvent } = require('../services/cv/cvExtractionFanOut');
    onCvExtractionEvent(CV_HEURISTICS_COMPLETED, (state) => events.push(state.jobId));

    await completeHeuristics(jobId, { profile: { name: 'Test' } });

    expect(events).toEqual([jobId]);
    const state = require('../services/cv/cvExtractionStateManager').getCvExtractionState(jobId);
    expect(state.status.heuristics).toBe('done');
  });

  test('markLayer is idempotent once terminal', async () => {
    const jobId = 'job-test-2';
    createCvExtractionState(jobId);
    await markLayer(jobId, 'identity', 'done', {
      userIdentity: { workEnjoyment: { bullets: ['Solving problems'], confidence: 0.9, evidence: [] } },
    });
    await markLayer(jobId, 'identity', 'failed', null);
    const state = require('../services/cv/cvExtractionStateManager').getCvExtractionState(jobId);
    expect(state.status.identity).toBe('done');
  });
});
