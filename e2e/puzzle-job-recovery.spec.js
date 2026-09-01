const { test, expect } = require('@playwright/test');

test.describe('puzzle-job recovery flow', () => {
  test('restores unsaved results after detail back-navigation and hard reload', async ({ page }) => {
    const simulationId = 'sim-recovery-1';
    const roleStepId = 'sim-recovery-1-next-0';
    const role = {
      stepId: roleStepId,
      id: roleStepId,
      title: { en: 'Recovery Role', de: 'Wiederherstellungsrolle' },
      description: { en: 'Keeps showing up after refresh.', de: 'Bleibt nach dem Aktualisieren sichtbar.' },
      category: 'nextSteps',
      escoId: 'esco:recovery-role',
      userEvaluation: 'keep',
      matchScore: 0.82,
      simulationId,
    };

    const results = {
      simulationId,
      nextSteps: [role],
      outsideTheBox: [],
      outsideComfortZone: [],
      furtherAdvice: [],
      resources: [],
      evaluationFlow: {
        simulationId,
        nextSteps: [role],
        outsideTheBox: [],
        roles: [role],
        hasStarted: { nextSteps: true, outsideTheBox: true },
        phases: { nextSteps: 'ranked', outsideTheBox: 'ranked' },
        ranked: {
          nextSteps: [
            {
              id: 'ranked-recovery-1',
              finalRank: 1,
              userEvaluation: 'keep',
              step: role,
              title: role.title,
              matchScore: role.matchScore,
            },
          ],
          outsideTheBox: [],
        },
        hasSeenRanking: { nextSteps: true, outsideTheBox: true },
      },
    };

    let lastSimulationCalls = 0;
    const localizedRoleTitle = /Recovery Role|Wiederherstellungsrolle/;
    const localizedBackToResults = /back to results|zurück zu ergebnissen/i;

    await page.addInitScript(({ seededResults, seededSimulationId, seededRoleStepId }) => {
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('i18nextLng', 'en');
      window.EventSource = undefined;

      const metadata = {
        simulationDate: '2026-08-04T09:31:00.000Z',
        profileCompletion: 100,
        timestamp: '2026-08-04T09:31:00.000Z',
      };

      sessionStorage.setItem(
        'currentSimulationResults',
        JSON.stringify({
          results: seededResults,
          metadata,
          state: 'modified',
        })
      );
      sessionStorage.setItem('currentSimulationState', 'modified');
      sessionStorage.setItem('currentSimResults', JSON.stringify(seededResults));
      sessionStorage.setItem(
        'currentUnsavedResults',
        JSON.stringify({
          results: seededResults,
          date: metadata.simulationDate,
        })
      );
      sessionStorage.setItem(
        'currentResultDetails',
        JSON.stringify({
          ...seededResults.nextSteps[0],
          resultId: seededRoleStepId,
          createdAt: metadata.simulationDate,
        })
      );
      sessionStorage.setItem(
        'currentStepDetails',
        JSON.stringify({
          ...seededResults.nextSteps[0],
          stepId: seededRoleStepId,
          createdAt: metadata.simulationDate,
        })
      );
      sessionStorage.removeItem('currentSimulationId');
    }, { seededResults: results, seededSimulationId: simulationId, seededRoleStepId: roleStepId });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'u1', email: 'e2e@example.com', emailVerified: true, isVerified: true },
        }),
      });
    });

    await page.route('**/api/profile/completion', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ completion: { overall: 100 } }),
      });
    });

    await page.route('**/api/profile/simulation/last**', async (route) => {
      lastSimulationCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, results: null }),
      });
    });

    await page.route('**/api/profile/simulation/saved**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, savedSimulations: [] }),
      });
    });

    await page.route('**/api/profile', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/profile/simulation/') || url.includes('/api/profile/completion')) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: {} }),
      });
    });

    await page.route('**/api/career-identity**', async (route) => {
      const url = route.request().url();
      if (url.includes('/exploration/latest')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, session: null, hasUnreadExploration: false }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          profile: {
            explorationProgress: {
              phase: 'idle',
              progressPercent: 0,
              activityPending: false,
            },
            explorationNotification: {
              hasUnreadExploration: false,
            },
          },
        }),
      });
    });

    await page.route('**/api/occupations/lookup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          occupation: {
            title: 'Recovery Role',
            description: 'Keeps showing up after refresh.',
            requiredSkills: [],
            optionalSkills: [],
            altTitles: [],
            hiddenTitles: [],
          },
        }),
      });
    });

    await page.goto('/puzzle-job');

    await expect(page).toHaveURL(/\/puzzle-job$/);
    await expect(page.getByText(localizedRoleTitle)).toBeVisible();

    await page.goto(`/simulation/result/${encodeURIComponent(roleStepId)}`);
    await expect(page).toHaveURL(new RegExp(`/simulation/result/${roleStepId}$`));
    await expect(page.getByRole('heading', { name: localizedRoleTitle })).toBeVisible();

    await page.getByLabel(localizedBackToResults).click();
    await expect(page).toHaveURL(/\/puzzle-job$/);
    await expect(page.getByText(localizedRoleTitle)).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/puzzle-job$/);
    await expect(page.getByText(localizedRoleTitle)).toBeVisible();

    expect(lastSimulationCalls).toBe(0);
  });
});
