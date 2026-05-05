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

  test('returns empty results for too-short queries', async () => {
    const res = await request(app)
      .get('/api/occupations/search')
      .query({ q: 'a', limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.results).toEqual([]);
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
