const request = require('supertest');
const app = require('../app');
const CareerPath = require('../models/CareerPath');
const Skill = require('../models/Skill');
const CareerPathSkill = require('../models/CareerPathSkill');

describe('Occupations search endpoint', () => {
  test('matches by ESCO altTitles synonym and returns canonical title', async () => {
    await CareerPath.create({
      escoId: 'http://data.europa.eu/esco/occupation/test-1',
      title: { en: 'technical director', de: null },
      altTitles: ['head of technical', 'technical manager'],
      hiddenTitles: ['tech dir'],
      description: { en: 'Test description', de: null },
      requiredSkills: [],
      requiredSkillUris: [],
      requiredSkillKeys: [],
      importedFrom: 'test',
      source: 'ESCO',
      sourceVersion: 'test',
    });

    const res = await request(app)
      .get('/api/occupations/search')
      .query({ q: 'head of technical', limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);

    const hit = res.body.results.find(r => r.escoId === 'http://data.europa.eu/esco/occupation/test-1');
    expect(hit).toBeDefined();
    expect(hit).toHaveProperty('title', 'technical director');
    expect(hit).toHaveProperty('domain', 'UNASSIGNED');
    expect(hit).toHaveProperty('matchedBy', 'altTitles');
    expect(hit).toHaveProperty('matchedValue', 'head of technical');
  });

  test('matches by canonical title when query matches title', async () => {
    await CareerPath.create({
      escoId: 'http://data.europa.eu/esco/occupation/test-2',
      title: { en: 'data analyst', de: null },
      altTitles: ['data insights specialist'],
      description: { en: 'Test description', de: null },
      requiredSkills: [],
      requiredSkillUris: [],
      requiredSkillKeys: [],
      importedFrom: 'test',
      source: 'ESCO',
      sourceVersion: 'test',
    });

    const res = await request(app)
      .get('/api/occupations/search')
      .query({ q: 'analyst', limit: 10 });

    expect(res.status).toBe(200);
    const hit = res.body.results.find(r => r.escoId === 'http://data.europa.eu/esco/occupation/test-2');
    expect(hit).toBeDefined();
    expect(hit).toHaveProperty('matchedBy', 'title');
  });

  test('orders title matches before alt-title matches, each group alphabetically', async () => {
    await CareerPath.create([
      {
        escoId: 'http://data.europa.eu/esco/occupation/order-alt-zebra',
        title: { en: 'zebra keeper', de: null },
        altTitles: ['animal handler'],
        description: { en: 'Alt match Z', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
      {
        escoId: 'http://data.europa.eu/esco/occupation/order-title-marine',
        title: { en: 'marine animal specialist', de: null },
        altTitles: [],
        description: { en: 'Title match M', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
      {
        escoId: 'http://data.europa.eu/esco/occupation/order-alt-apple',
        title: { en: 'apple picker', de: null },
        altTitles: ['animal caretaker'],
        description: { en: 'Alt match A', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
      {
        escoId: 'http://data.europa.eu/esco/occupation/order-title-animal',
        title: { en: 'animal trainer', de: null },
        altTitles: [],
        description: { en: 'Title match A', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
    ]);

    const res = await request(app)
      .get('/api/occupations/search')
      .query({ q: 'animal', limit: 20 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const relevant = (res.body.results || []).filter((r) =>
      [
        'http://data.europa.eu/esco/occupation/order-title-animal',
        'http://data.europa.eu/esco/occupation/order-title-marine',
        'http://data.europa.eu/esco/occupation/order-alt-apple',
        'http://data.europa.eu/esco/occupation/order-alt-zebra',
      ].includes(r.escoId)
    );

    expect(relevant.map((r) => r.escoId)).toEqual([
      'http://data.europa.eu/esco/occupation/order-title-animal',
      'http://data.europa.eu/esco/occupation/order-title-marine',
      'http://data.europa.eu/esco/occupation/order-alt-apple',
      'http://data.europa.eu/esco/occupation/order-alt-zebra',
    ]);
    expect(relevant.map((r) => r.matchedBy)).toEqual([
      'title',
      'title',
      'altTitles',
      'altTitles',
    ]);
  });

  test('ranks word-boundary title matches above mid-token substring title matches', async () => {
    await CareerPath.create([
      {
        escoId: 'http://data.europa.eu/esco/occupation/order-weak-montierer',
        title: { en: 'control panel assembler', de: 'Montierer*in für Steuerungstechnik' },
        altTitles: [],
        altTitlesDe: [],
        description: { en: 'Weak substring', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
      {
        escoId: 'http://data.europa.eu/esco/occupation/order-strong-fachkraft',
        title: {
          en: 'aquatic animal health professional',
          de: 'Fachkraft für die Gesundheit aquatischer Tiere',
        },
        altTitles: [],
        altTitlesDe: [],
        description: { en: 'Strong word match', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
      {
        escoId: 'http://data.europa.eu/esco/occupation/order-strong-tierpfleger',
        title: { en: 'animal care worker', de: 'Tierpfleger*in' },
        altTitles: [],
        altTitlesDe: [],
        description: { en: 'Starts with query', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
    ]);

    const res = await request(app)
      .get('/api/occupations/search')
      .query({ q: 'Tier', lang: 'de', limit: 20 });

    expect(res.status).toBe(200);
    const relevant = (res.body.results || []).filter((r) =>
      [
        'http://data.europa.eu/esco/occupation/order-strong-tierpfleger',
        'http://data.europa.eu/esco/occupation/order-strong-fachkraft',
        'http://data.europa.eu/esco/occupation/order-weak-montierer',
      ].includes(r.escoId)
    );

    expect(relevant.map((r) => r.escoId)).toEqual([
      'http://data.europa.eu/esco/occupation/order-strong-fachkraft',
      'http://data.europa.eu/esco/occupation/order-strong-tierpfleger',
      'http://data.europa.eu/esco/occupation/order-weak-montierer',
    ]);
    expect(relevant.every((r) => r.matchedBy === 'title')).toBe(true);
  });

  test('returns empty results for too-short queries', async () => {
    const res = await request(app)
      .get('/api/occupations/search')
      .query({ q: 'a', limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.results).toEqual([]);
  });

  test('filters search results by domain', async () => {
    await CareerPath.create([
      {
        escoId: 'http://data.europa.eu/esco/occupation/domain-sw-1',
        title: { en: 'software developer', de: null },
        domain: 'Software',
        description: { en: 'Builds software', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
      {
        escoId: 'http://data.europa.eu/esco/occupation/domain-hc-1',
        title: { en: 'software support nurse', de: null },
        domain: 'Healthcare',
        description: { en: 'Clinical role with software tools', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
    ]);

    const res = await request(app)
      .get('/api/occupations/search')
      .query({ q: 'software', domain: 'Software', limit: 20 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = (res.body.results || []).map((r) => r.escoId);
    expect(ids).toContain('http://data.europa.eu/esco/occupation/domain-sw-1');
    expect(ids).not.toContain('http://data.europa.eu/esco/occupation/domain-hc-1');
    const hit = res.body.results.find(
      (r) => r.escoId === 'http://data.europa.eu/esco/occupation/domain-sw-1'
    );
    expect(hit.domain).toBe('Software');
  });

  test('matches legacy natural-science domains when filtering Natural Sciences', async () => {
    await CareerPath.collection.insertMany([
      {
        escoId: 'http://data.europa.eu/esco/occupation/domain-bio-1',
        title: { en: 'research biologist', de: null },
        domain: 'Biology',
        description: { en: 'Studies organisms', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
      {
        escoId: 'http://data.europa.eu/esco/occupation/domain-phys-1',
        title: { en: 'applied physicist', de: null },
        domain: 'Physics',
        description: { en: 'Studies matter', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
      {
        escoId: 'http://data.europa.eu/esco/occupation/domain-sw-ns-1',
        title: { en: 'software engineer', de: null },
        domain: 'Software',
        description: { en: 'Builds software', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
    ]);

    const res = await request(app)
      .get('/api/occupations/search')
      .query({ domain: 'Natural Sciences' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = (res.body.results || []).map((r) => r.escoId);
    expect(ids).toContain('http://data.europa.eu/esco/occupation/domain-bio-1');
    expect(ids).toContain('http://data.europa.eu/esco/occupation/domain-phys-1');
    expect(ids).not.toContain('http://data.europa.eu/esco/occupation/domain-sw-ns-1');
  });

  test('lists occupations by domain without text query', async () => {
    await CareerPath.create({
      escoId: 'http://data.europa.eu/esco/occupation/domain-only-1',
      title: { en: 'cardiologist', de: null },
      domain: 'Healthcare',
      description: { en: 'Treats heart conditions', de: null },
      importedFrom: 'test',
      source: 'ESCO',
      sourceVersion: 'test',
    });

    const res = await request(app)
      .get('/api/occupations/search')
      .query({ domain: 'Healthcare', limit: 20 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const hit = res.body.results.find(
      (r) => r.escoId === 'http://data.europa.eu/esco/occupation/domain-only-1'
    );
    expect(hit).toBeDefined();
    expect(hit.domain).toBe('Healthcare');
  });

  test('returns all occupations for a domain-only browse without limit', async () => {
    const docs = Array.from({ length: 25 }, (_, index) => ({
      escoId: `http://data.europa.eu/esco/occupation/food-${index + 1}`,
      title: { en: `food role ${String(index + 1).padStart(2, '0')}`, de: null },
      domain: 'Food & Beverage',
      description: { en: 'Food role test', de: null },
      importedFrom: 'test',
      source: 'ESCO',
      sourceVersion: 'test',
    }));
    await CareerPath.create(docs);

    const res = await request(app)
      .get('/api/occupations/search')
      .query({ domain: 'Food & Beverage' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.results).toHaveLength(25);
    expect(res.body.results[0]).toHaveProperty('title', 'food role 01');
    expect(res.body.results[24]).toHaveProperty('title', 'food role 25');
  });

  test('rejects invalid domain filter', async () => {
    const res = await request(app)
      .get('/api/occupations/search')
      .query({ q: 'manager', domain: 'NotARealDomain', limit: 10 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('omits simulationExcluded roles from search results', async () => {
    await CareerPath.create([
      {
        escoId: 'http://data.europa.eu/esco/occupation/excluded-search-1',
        title: { en: 'excluded widget specialist', de: null },
        description: { en: 'Should not appear in search', de: null },
        simulationExcluded: true,
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
      {
        escoId: 'http://data.europa.eu/esco/occupation/eligible-search-1',
        title: { en: 'eligible widget specialist', de: null },
        description: { en: 'Should appear in search', de: null },
        importedFrom: 'test',
        source: 'ESCO',
        sourceVersion: 'test',
      },
    ]);

    const res = await request(app)
      .get('/api/occupations/search')
      .query({ q: 'widget specialist', limit: 20 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = (res.body.results || []).map((r) => r.escoId);
    expect(ids).toContain('http://data.europa.eu/esco/occupation/eligible-search-1');
    expect(ids).not.toContain('http://data.europa.eu/esco/occupation/excluded-search-1');
  });

  test('lookup returns 404 for simulationExcluded roles', async () => {
    await CareerPath.create({
      escoId: 'http://data.europa.eu/esco/occupation/excluded-lookup-1',
      title: { en: 'excluded lookup role', de: null },
      description: { en: 'Should not be lookupable', de: null },
      simulationExcluded: true,
      importedFrom: 'test',
      source: 'ESCO',
      sourceVersion: 'test',
    });

    const res = await request(app)
      .get('/api/occupations/lookup')
      .query({ escoId: 'http://data.europa.eu/esco/occupation/excluded-lookup-1' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('lookup returns strict localized skill contract and language switch', async () => {
    const careerPath = await CareerPath.create({
      escoId: 'http://data.europa.eu/esco/occupation/test-lookup-1',
      title: { en: 'project manager', de: null },
      description: { en: 'Coordinates projects', de: null },
      requiredSkills: ['communication'],
      requiredSkillUris: [],
      requiredSkillKeys: ['communication'],
      skillModel: {
        core_skills: ['communication'],
        optional_skills: ['stakeholder management'],
      },
      skillDomains: {
        skill_domains: [
          {
            domain: { en: 'Communication', de: 'Kommunikation' },
            importance: 'core',
            mapped_items: ['communication'],
          },
        ],
      },
      importedFrom: 'test',
      source: 'ESCO',
      sourceVersion: 'test',
    });

    const communication = await Skill.create({
      key: 'communication',
      label: { en: 'Communication', de: 'Kommunikation' },
    });
    const stakeholder = await Skill.create({
      key: 'stakeholder_management',
      label: { en: 'Stakeholder Management', de: 'Stakeholder-Management' },
    });
    await CareerPathSkill.create([
      { careerPathId: careerPath._id, skillId: communication._id, type: 'required', order_index: 0 },
      { careerPathId: careerPath._id, skillId: stakeholder._id, type: 'optional', order_index: 0 },
    ]);

    const deRes = await request(app)
      .get('/api/occupations/lookup')
      .query({ escoId: careerPath.escoId, lang: 'de' });
    expect(deRes.status).toBe(200);
    const deOcc = deRes.body.occupation;
    expect(deOcc.domain).toBe('UNASSIGNED');
    expect(Array.isArray(deOcc.requiredSkills)).toBe(true);
    expect(Array.isArray(deOcc.optionalSkills)).toBe(true);
    expect(Array.isArray(deOcc.skillDomains)).toBe(true);
    expect(deOcc.requiredSkills[0]).toMatchObject({ key: 'communication', label: 'Kommunikation' });
    expect(deOcc.optionalSkills[0]).toMatchObject({ key: 'stakeholder_management', label: 'Stakeholder-Management' });
    for (const item of deOcc.requiredSkills) {
      expect(typeof item).toBe('object');
      expect(typeof item.key).toBe('string');
      expect(typeof item.label).toBe('string');
    }
    for (const item of deOcc.optionalSkills) {
      expect(typeof item).toBe('object');
      expect(typeof item.key).toBe('string');
      expect(typeof item.label).toBe('string');
    }
    for (const domain of deOcc.skillDomains) {
      expect(typeof domain).toBe('object');
      expect(typeof domain.label).toBe('string');
      expect(Array.isArray(domain.items)).toBe(true);
      for (const item of domain.items) {
        expect(typeof item).toBe('object');
        expect(typeof item.key).toBe('string');
        expect(typeof item.label).toBe('string');
      }
    }

    const enRes = await request(app)
      .get('/api/occupations/lookup')
      .query({ escoId: careerPath.escoId, lang: 'en' });
    expect(enRes.status).toBe(200);
    const enOcc = enRes.body.occupation;
    expect(enOcc.requiredSkills[0]).toMatchObject({ key: 'communication', label: 'Communication' });
    expect(enOcc.optionalSkills[0]).toMatchObject({ key: 'stakeholder_management', label: 'Stakeholder Management' });
    expect(enOcc.requiredSkills[0].label).not.toBe(deOcc.requiredSkills[0].label);
  });
});
