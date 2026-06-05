jest.mock('../services/embedding/embeddingService', () => {
  const l2Normalize = (vec) => {
    if (!vec || vec.length === 0) return vec;
    let norm = 0;
    for (let i = 0; i < vec.length; i += 1) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vec.length; i += 1) vec[i] /= norm;
    return vec;
  };
  const weightedFusionMulti = (vectors, weights, dims = 3) => {
    const out = new Float32Array(dims);
    for (let i = 0; i < vectors.length; i += 1) {
      const v = vectors[i];
      const w = Number(weights[i] || 0);
      if (!v) continue;
      for (let j = 0; j < dims; j += 1) out[j] += w * (v[j] || 0);
    }
    return l2Normalize(out);
  };
  const weightedFusion = (a, b, { w1 = 0.6, w2 = 0.4 } = {}) => {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 1) out[i] = w1 * a[i] + w2 * b[i];
    return l2Normalize(out);
  };

  return {
    EMBEDDING_DIMS: 3,
    l2Normalize,
    weightedFusion,
    weightedFusionMulti,
    embedText: jest.fn(async (text) => {
      if (String(text).includes('finance') && String(text).includes('healthcare')) return new Float32Array([1, 0, 0]);
      return new Float32Array([0.3, 0.3, 0.3]);
    }),
    embedTextSafe: jest.fn(async (text) => {
      const s = String(text).toLowerCase();
      if (s.includes('finance') && s.includes('healthcare')) return new Float32Array([1, 0, 0]);
      return new Float32Array([0.3, 0.3, 0.3]);
    }),
    embedTextBatch: jest.fn(async (texts) => texts.map((_, idx) => {
      if (idx === 0) return new Float32Array([0, 1, 0]);
      if (idx === 1) return new Float32Array([0, 0, 1]);
      return new Float32Array([1, 0, 0]);
    })),
    embedTextBatchSafe: jest.fn(async (texts) => texts.map((_, idx) => {
      if (idx === 0) return new Float32Array([0, 1, 0]);
      if (idx === 1) return new Float32Array([0, 0, 1]);
      return new Float32Array([1, 0, 0]);
    })),
  };
});

jest.mock('../services/ai/normalizeForEmbedding', () => ({
  normalizeForEmbedding: jest.fn(async (input) => {
    const flat = Array.isArray(input) ? input.join('\n') : String(input || '');
    return flat.trim();
  }),
}));

jest.mock('../services/embedding/userIdentityEmbeddingTextService', () => ({
  resolveUserIdentityEmbeddingText: jest.fn(async () => 'identity'),
  FALLBACK_IDENTITY_TEXT: 'fallback',
  buildUserIdentityTextLegacy: jest.fn(() => 'legacy'),
  answersFromFlatUserProfile: jest.fn(() => ({})),
}));

const {
  buildUserCategoryTexts,
  buildOccupationGroupUserVector,
} = require('../services/embedding/userProfileVectorBuilder');
const { embedTextSafe } = require('../services/embedding/embeddingService');
const { normalizeForEmbedding } = require('../services/ai/normalizeForEmbedding');

describe('userProfileVectorBuilder field mapping', () => {
  beforeEach(() => {
    normalizeForEmbedding.mockImplementation(async (input) => {
      const flat = Array.isArray(input) ? input.join('\n') : String(input || '');
      return flat.trim();
    });
    const embedImpl = async (text) => {
      const s = String(text).toLowerCase();
      if (s.includes('finance') && s.includes('healthcare')) return new Float32Array([1, 0, 0]);
      return new Float32Array([0.3, 0.3, 0.3]);
    };
    embedTextSafe.mockImplementation(embedImpl);
  });

  test('buildUserCategoryTexts uses requested profile field mapping', () => {
    const userProfile = {
      userSkillDomains: ['Marketing', 'AI'],
      userCareerPreferences: {
        domains: ['Finance', 'Healthcare'],
      },
      userWorkExperience: [
        {
          keyResponsibilities: [
            'Lead cross-functional delivery',
            'lead cross-functional delivery',
            'Own roadmap prioritization',
          ],
        },
      ],
      userSkills: ['Roadmapping', 'Data Analysis'],
      userSkillsInDevelopment: ['Data analysis', 'Coaching'],
    };

    const result = buildUserCategoryTexts(userProfile);

    expect(result.skill_domains).toBe('marketing\nai');
    expect(result.occupation_group).toBe('finance\nhealthcare');
    expect(result.responsibilities).toBe('lead cross functional delivery\nown roadmap prioritization');
    expect(result.required_skills).toBe('roadmapping\ndata analysis');
    expect(result.optional_skills).toBe('roadmapping\ndata analysis\ncoaching');
  });

  test('buildOccupationGroupUserVector embeds domain text only', async () => {
    const userProfile = {
      userCareerPreferences: {
        domains: ['Finance', 'Healthcare'],
      },
    };

    const vec = await buildOccupationGroupUserVector(userProfile);

    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(3);
    expect(embedTextSafe).toHaveBeenCalled();
  });

  test('buildOccupationGroupUserVector returns zero vector when domains are empty', async () => {
    const userProfile = {
      userCareerPreferences: {
        domains: [],
      },
    };

    const vec = await buildOccupationGroupUserVector(userProfile);
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(3);
    expect([...vec]).toEqual([0, 0, 0]);
    expect(embedTextSafe).not.toHaveBeenCalled();
  });
});
