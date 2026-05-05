const { generateStepId, slugifyTitle, mapPrioritizedListCategoryToStepCategory } = require('../utils/stepId');

describe('stepId utils', () => {
  test('slugifyTitle creates url-safe slug and truncates', () => {
    const slug = slugifyTitle('Senior Software Engineer (R&D) / Platform!!!');
    // Note: the slugger can produce double hyphens when punctuation is removed.
    expect(slug).toBe('senior-software-engineer-rd--platform');
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  test('generateStepId is deterministic', () => {
    const a = generateStepId('UX Designer', 'sim-123', 'outsideTheBox', 4);
    const b = generateStepId('UX Designer', 'sim-123', 'outsideTheBox', 4);
    expect(a).toBe(b);
    // Category casing is preserved (matches existing client behavior)
    expect(a).toBe('ux-designer-sim-123-outsideTheBox-4');
  });

  test('mapPrioritizedListCategoryToStepCategory maps list keys to display keys', () => {
    expect(mapPrioritizedListCategoryToStepCategory('nextCareerRoles')).toBe('nextSteps');
    expect(mapPrioritizedListCategoryToStepCategory('outsideTheBoxRoles')).toBe('outsideTheBox');
    expect(mapPrioritizedListCategoryToStepCategory('customCategory')).toBe('customCategory');
  });
});

