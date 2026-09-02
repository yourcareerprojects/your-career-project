const {
  buildRoleFitRequestKey,
  clearRoleFitExplanationCache,
  collectEvaluationRolesForPrefetch,
  ensureRoleFitExplanation,
  getRoleFitExplanationEntry,
  prefetchRoleFitExplanations,
  setRoleFitExplanationPoster,
} = require('../utils/roleFitExplanationClient');
const {
  deriveSimulationWizardStep,
  shouldHoldWizardOnLoadingForRoleFit,
  NEXT_WIZARD_LOADING_STEP,
  NEXT_WIZARD_FIRST_ROLE_STEP,
} = require('../utils/simulationWizardSteps');
const { createInitialEvaluationFlow } = require('../utils/simulationRoleRanking');

describe('role-fit evaluation prefetch', () => {
  beforeEach(() => {
    clearRoleFitExplanationCache();
    setRoleFitExplanationPoster(null);
  });

  afterEach(() => {
    clearRoleFitExplanationCache();
    setRoleFitExplanationPoster(null);
  });

  it('builds a stable request key from esco + scope + language', () => {
    const role = { escoId: 'e1', id: 'role-a', title: 'Analyst' };
    expect(buildRoleFitRequestKey(role, 'sim-1', 'de-DE')).toBe('esco:e1::sim-1::de');
    expect(buildRoleFitRequestKey({ ...role, extra: true }, 'sim-1', 'de')).toBe(
      'esco:e1::sim-1::de'
    );
  });

  it('collects unevaluated next-step roles before outside-the-box roles', () => {
    const flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'n1', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
        { stepId: 'n2', escoId: 'e2', title: 'B', hybridScoreNextRole: 0.8 },
      ],
      outsideTheBox: [
        { stepId: 'o1', escoId: 'e3', title: 'C', hybridScoreOutOfTheBox: 0.4 },
      ],
    });
    flow.roles = flow.roles.map((role) => (
      role.escoId === 'e1' ? { ...role, userEvaluation: 'keep' } : role
    ));
    const roles = collectEvaluationRolesForPrefetch(flow);
    expect(roles.map((role) => role.escoId)).toEqual(['e2', 'e3']);
  });

  it('holds the wizard loading step only for a fresh next-role evaluation', () => {
    const fresh = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [{ stepId: 'n1', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 }],
      outsideTheBox: [],
    });
    expect(shouldHoldWizardOnLoadingForRoleFit(fresh)).toBe(true);

    const started = {
      ...fresh,
      roles: fresh.roles.map((role, index) => (
        index === 0 ? { ...role, userEvaluation: 'keep' } : role
      )),
    };
    expect(shouldHoldWizardOnLoadingForRoleFit(started)).toBe(false);

    expect(
      deriveSimulationWizardStep({
        simLoading: false,
        evaluationFlow: fresh,
        holdOnLoadingStep: true,
      }).step
    ).toBe(NEXT_WIZARD_LOADING_STEP);
    expect(
      deriveSimulationWizardStep({
        simLoading: false,
        evaluationFlow: fresh,
        holdOnLoadingStep: false,
      }).step
    ).toBe(NEXT_WIZARD_FIRST_ROLE_STEP);
  });

  it('dedupes in-flight fetches and prefetches roles in queue order', async () => {
    const order = [];
    setRoleFitExplanationPoster(async ({ role }) => {
      order.push(role.escoId);
      return { success: true, bullets: [`Your fit for ${role.escoId}`] };
    });

    const a = { escoId: 'e1', id: 'a', title: 'A' };
    const b = { escoId: 'e2', id: 'b', title: 'B' };
    const first = ensureRoleFitExplanation({ role: a, simulationScopeId: 'sim-1', language: 'en' });
    const again = ensureRoleFitExplanation({ role: a, simulationScopeId: 'sim-1', language: 'en' });
    await Promise.all([first, again]);
    expect(order).toEqual(['e1']);

    await prefetchRoleFitExplanations({
      roles: [a, b],
      simulationScopeId: 'sim-1',
      language: 'en',
    });
    expect(order).toEqual(['e1', 'e2']);
    expect(getRoleFitExplanationEntry(buildRoleFitRequestKey(b, 'sim-1', 'en'))).toEqual({
      status: 'ready',
      bullets: ['Your fit for e2'],
    });
  });
});
