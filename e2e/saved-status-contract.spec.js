const { test, expect } = require('@playwright/test');

test.describe('saved-status contract', () => {
  test('saved out-of-the-box role stays saved across list/ranking/detail/reload', async ({ page }) => {
    const simulationIdA = 'sim-a-111';
    const simulationIdB = 'sim-b-222';
    const roleStepId = 'object-object-sim-b-222-outsideTheBox-0';

    const savedStep = {
      stepId: 'object-object-sim-a-111-outsideTheBox-0',
      title: { en: 'UX Strategist', de: 'UX Stratege' },
      description: { en: 'Design user-centered product strategy.', de: 'Entwerfe nutzerzentrierte Produktstrategie.' },
      category: 'outsideTheBox',
      simulationResultId: simulationIdA,
      careerPathId: 'cluster-ux-001',
      escoId: 'esco:cluster-ux',
      savedKey: 'cluster:cluster-ux-001',
      savedAt: new Date().toISOString(),
      userEvaluation: 'keep',
    };

    const outOfTheBoxRole = {
      stepId: roleStepId,
      id: roleStepId,
      title: { en: 'UX Strategist', de: 'UX Stratege' },
      description: 'Design user-centered product strategy.',
      category: 'outsideSimulationBox',
      careerPathId: 'cluster-ux-001',
      escoId: 'esco:cluster-ux-other',
      userEvaluation: 'keep',
    };

    const simulationLastPayload = {
      results: {
        simulationId: simulationIdB,
        nextSteps: [],
        outsideTheBox: [outOfTheBoxRole],
        furtherAdvice: [],
        evaluationFlow: {
          simulationId: simulationIdB,
          nextSteps: [],
          outsideTheBox: [outOfTheBoxRole],
          hasStarted: { nextSteps: true, outsideTheBox: true },
          phases: { nextSteps: 'eval', outsideTheBox: 'eval' },
          ranked: { nextSteps: null, outsideTheBox: null },
        },
      },
      date: new Date().toISOString(),
    };

    const savedSimulationPayload = {
      success: true,
      simulation: {
        id: simulationIdA,
        _id: simulationIdA,
        name: 'Saved Simulation A',
        timestamp: new Date().toISOString(),
        results: {
          nextSteps: [],
          outsideTheBox: [
            {
              ...outOfTheBoxRole,
              stepId: 'object-object-sim-a-111-outsideSimulationBox-0',
              id: 'object-object-sim-a-111-outsideSimulationBox-0',
            },
          ],
          furtherAdvice: [],
          evaluationFlow: {
            simulationId: simulationIdA,
            nextSteps: [],
            outsideTheBox: [
              {
                ...outOfTheBoxRole,
                stepId: 'object-object-sim-a-111-outsideSimulationBox-0',
                id: 'object-object-sim-a-111-outsideSimulationBox-0',
              },
            ],
            hasStarted: { nextSteps: true, outsideTheBox: true },
            phases: { nextSteps: 'eval', outsideTheBox: 'ranked' },
            ranked: {
              nextSteps: null,
              outsideTheBox: [
                {
                  id: 'ranked-outbox-1',
                  finalRank: 1,
                  userEvaluation: 'keep',
                  step: {
                    ...outOfTheBoxRole,
                    stepId: 'object-object-sim-a-111-outsideSimulationBox-0',
                    id: 'object-object-sim-a-111-outsideSimulationBox-0',
                  },
                  title: { en: 'UX Strategist', de: 'UX Stratege' },
                },
              ],
            },
          },
        },
      },
    };

    await page.addInitScript(() => {
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('i18nextLng', 'en');
      sessionStorage.setItem(
        'currentStepDetails',
        JSON.stringify({
          stepId: 'object-object-sim-b-222-outsideTheBox-0',
          title: { en: 'UX Strategist', de: 'UX Stratege' },
          description: 'Design user-centered product strategy.',
          category: 'outsideSimulationBox',
          careerPathId: 'cluster-ux-001',
          simulationId: 'sim-b-222',
        })
      );
    });

    await page.route('**/api/auth/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 'u1', email: 'e2e@example.com', emailVerified: true } }),
      });
    });

    await page.route('**/api/profile/completion', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ completion: { overall: 100 } }),
      });
    });

    await page.route('**/api/profile/saved-career-steps**', async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, savedCareerSteps: [savedStep] }),
        });
        return;
      }
      await route.fallback();
    });

    await page.route('**/api/profile/simulation/last**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(simulationLastPayload),
      });
    });

    await page.route(`**/api/profile/simulation/saved/${simulationIdA}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(savedSimulationPayload),
      });
    });

    await page.route('**/api/profile', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/profile/simulation/')) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: {} }),
      });
    });

    await page.route('**/api/occupations/lookup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, occupation: {} }),
      });
    });

    // new simulation list: saved badge must be visible
    await page.goto('/simulation/results');
    await expect(
      page.getByTestId(`simulation-list-save-toggle-${roleStepId}`)
    ).toContainText(/saved/i);

    // saved simulation ranking: saved badge must be visible
    await page.goto(`/saved-simulation/${simulationIdA}`);
    await expect(
      page.getByTestId('simulation-ranking-save-toggle-object-object-sim-a-111-outsideSimulationBox-0')
    ).toContainText(/saved/i);

    // detail page from fresh simulation
    await page.goto(`/simulation/result/${encodeURIComponent(roleStepId)}`);
    await expect(page.getByTestId('simulation-detail-save-toggle')).toHaveAccessibleName(/remove|saved/i);

    // saved simulation detail + hard reload must still show saved
    const savedDetailPath =
      `/saved-simulation/${simulationIdA}/career-step/object-object-sim-a-111-outsideSimulationBox-0`;
    await page.goto(savedDetailPath);
    await expect(page.getByTestId('saved-simulation-detail-save-toggle')).toHaveAccessibleName(/remove|saved/i);
    await page.reload();
    await expect(page.getByTestId('saved-simulation-detail-save-toggle')).toHaveAccessibleName(/remove|saved/i);
  });

  test('saved next-step role stays saved across list/ranking/detail/reload', async ({ page }) => {
    const simulationIdA = 'sim-a-next-111';
    const simulationIdB = 'sim-b-next-222';
    const roleStepId = 'object-object-sim-b-next-222-nextSteps-0';

    const savedStep = {
      stepId: 'object-object-sim-a-next-111-nextSteps-0',
      title: { en: 'Product Manager', de: 'Produktmanager' },
      description: { en: 'Drive product strategy and execution.', de: 'Verantworte Produktstrategie und Umsetzung.' },
      category: 'nextSteps',
      simulationResultId: simulationIdA,
      careerPathId: 'cluster-pm-001',
      escoId: 'esco:cluster-pm',
      savedKey: 'cluster:cluster-pm-001',
      savedAt: new Date().toISOString(),
      userEvaluation: 'keep',
    };

    const nextStepRole = {
      stepId: roleStepId,
      id: roleStepId,
      title: { en: 'Product Manager', de: 'Produktmanager' },
      description: 'Drive product strategy and execution.',
      category: 'nextSteps',
      careerPathId: 'cluster-pm-001',
      escoId: 'esco:cluster-pm-other',
      userEvaluation: 'keep',
    };

    const simulationLastPayload = {
      results: {
        simulationId: simulationIdB,
        nextSteps: [nextStepRole],
        outsideTheBox: [],
        furtherAdvice: [],
        evaluationFlow: {
          simulationId: simulationIdB,
          nextSteps: [nextStepRole],
          outsideTheBox: [],
          hasStarted: { nextSteps: true, outsideTheBox: true },
          phases: { nextSteps: 'eval', outsideTheBox: 'eval' },
          ranked: { nextSteps: null, outsideTheBox: null },
        },
      },
      date: new Date().toISOString(),
    };

    const savedSimulationPayload = {
      success: true,
      simulation: {
        id: simulationIdA,
        _id: simulationIdA,
        name: 'Saved Simulation Next',
        timestamp: new Date().toISOString(),
        results: {
          nextSteps: [
            {
              ...nextStepRole,
              stepId: 'object-object-sim-a-next-111-nextSteps-0',
              id: 'object-object-sim-a-next-111-nextSteps-0',
            },
          ],
          outsideTheBox: [],
          furtherAdvice: [],
          evaluationFlow: {
            simulationId: simulationIdA,
            nextSteps: [
              {
                ...nextStepRole,
                stepId: 'object-object-sim-a-next-111-nextSteps-0',
                id: 'object-object-sim-a-next-111-nextSteps-0',
              },
            ],
            outsideTheBox: [],
            hasStarted: { nextSteps: true, outsideTheBox: true },
            phases: { nextSteps: 'ranked', outsideTheBox: 'eval' },
            ranked: {
              nextSteps: [
                {
                  id: 'ranked-next-1',
                  finalRank: 1,
                  userEvaluation: 'keep',
                  step: {
                    ...nextStepRole,
                    stepId: 'object-object-sim-a-next-111-nextSteps-0',
                    id: 'object-object-sim-a-next-111-nextSteps-0',
                  },
                  title: { en: 'Product Manager', de: 'Produktmanager' },
                },
              ],
              outsideTheBox: null,
            },
          },
        },
      },
    };

    await page.addInitScript(() => {
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('i18nextLng', 'en');
      sessionStorage.setItem(
        'currentStepDetails',
        JSON.stringify({
          stepId: 'object-object-sim-b-next-222-nextSteps-0',
          title: { en: 'Product Manager', de: 'Produktmanager' },
          description: 'Drive product strategy and execution.',
          category: 'nextSteps',
          careerPathId: 'cluster-pm-001',
          simulationId: 'sim-b-next-222',
        })
      );
    });

    await page.route('**/api/auth/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 'u1', email: 'e2e@example.com', emailVerified: true } }),
      });
    });

    await page.route('**/api/profile/completion', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ completion: { overall: 100 } }),
      });
    });

    await page.route('**/api/profile/saved-career-steps**', async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, savedCareerSteps: [savedStep] }),
        });
        return;
      }
      await route.fallback();
    });

    await page.route('**/api/profile/simulation/last**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(simulationLastPayload),
      });
    });

    await page.route(`**/api/profile/simulation/saved/${simulationIdA}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(savedSimulationPayload),
      });
    });

    await page.route('**/api/profile', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/profile/simulation/')) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: {} }),
      });
    });

    await page.route('**/api/occupations/lookup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, occupation: {} }),
      });
    });

    await page.goto('/simulation/results');
    await expect(
      page.getByTestId(`simulation-list-save-toggle-${roleStepId}`)
    ).toContainText(/saved/i);

    await page.goto(`/saved-simulation/${simulationIdA}`);
    await expect(
      page.getByTestId('simulation-ranking-save-toggle-object-object-sim-a-next-111-nextSteps-0')
    ).toContainText(/saved/i);

    await page.goto(`/simulation/result/${encodeURIComponent(roleStepId)}`);
    await expect(page.getByTestId('simulation-detail-save-toggle')).toHaveAccessibleName(/remove|saved/i);

    const savedDetailPath =
      `/saved-simulation/${simulationIdA}/career-step/object-object-sim-a-next-111-nextSteps-0`;
    await page.goto(savedDetailPath);
    await expect(page.getByTestId('saved-simulation-detail-save-toggle')).toHaveAccessibleName(/remove|saved/i);
    await page.reload();
    await expect(page.getByTestId('saved-simulation-detail-save-toggle')).toHaveAccessibleName(/remove|saved/i);
  });
});

