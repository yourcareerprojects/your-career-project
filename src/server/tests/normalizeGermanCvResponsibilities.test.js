const {
  normalizeGermanCvResponsibilityBullet,
  normalizeGermanCvResponsibilityList,
  looksGerman,
} = require('../../constants/normalizeGermanCvResponsibilities');

describe('normalizeGermanCvResponsibilities', () => {
  test('looksGerman detects German text', () => {
    expect(looksGerman('Leitung von Projekten')).toBe(true);
    expect(looksGerman('Led cross-functional teams')).toBe(false);
  });

  test('rewrites English -ing starters to German nominal style', () => {
    expect(normalizeGermanCvResponsibilityBullet(
      'Leading cross-funktionale Teams in agilen Projekten'
    )).toBe('Leitung von cross-funktionale Teams in agilen Projekten');
  });

  test('rewrites English past starters to German nominal style', () => {
    expect(normalizeGermanCvResponsibilityBullet(
      'Led product development across multiple stakeholder groups'
    )).toBe('Leitung von product development across multiple stakeholder groups');
  });

  test('rewrites Präteritum starters to nominal style', () => {
    expect(normalizeGermanCvResponsibilityBullet(
      'leitete wöchentliche Team-Stand-ups und Sprintplanung'
    )).toBe('Leitung von wöchentliche Team-Stand-ups und Sprintplanung');
  });

  test('rewrites Perfekt patterns', () => {
    expect(normalizeGermanCvResponsibilityBullet(
      'habe Budgetplanung für mehrere Abteilungen geleitet'
    )).toBe('Leitung von Budgetplanung für mehrere Abteilungen');
  });

  test('rewrites war verantwortlich für', () => {
    expect(normalizeGermanCvResponsibilityBullet(
      'war verantwortlich für die Produkt-Roadmap'
    )).toBe('Verantwortung für die Produkt-Roadmap');
  });

  test('normalizeGermanCvResponsibilityList leaves English when not forced', () => {
    expect(normalizeGermanCvResponsibilityList(['Led teams'], { force: false })).toEqual(['Led teams']);
  });

  test('normalizeGermanCvResponsibilityList normalizes all items when forced', () => {
    expect(normalizeGermanCvResponsibilityList(
      ['leitete Projekte', 'Led teams'],
      { force: true }
    )).toEqual([
      'Leitung von Projekte',
      'Leitung von teams',
    ]);
  });
});
