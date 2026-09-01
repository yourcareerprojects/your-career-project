/**
 * Unit tests for identity trait embedding infrastructure (text builder + store loader).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildTraitEmbeddingText,
  hashTraitEmbeddingText,
  buildTraitEmbeddingTextMap,
} = require('../services/careerIdentity/traitEmbeddingText');

const {
  __setEmbeddingsFileForTests,
  resetTraitEmbeddingsCache,
  getTraitEmbedding,
  getAllTraitEmbeddings,
  getTraitEmbeddingIndex,
  warmTraitEmbeddingsCache,
  isTraitEmbeddingsAvailable,
  getTraitEmbeddingsMetadata,
  getTraitEmbeddingsFilePath,
  EMBEDDING_MODEL,
  STORE_VERSION,
} = require('../services/careerIdentity/traitEmbeddingsStore');

const { listTraitDefinitions } = require('../../constants/identityTraitCatalog');
const { EMBEDDING_DIMS } = require('../services/embedding/embeddingService');

describe('traitEmbeddingText', () => {
  it('builds deterministic text from all trait fields', () => {
    const trait = listTraitDefinitions()[0];
    const text = buildTraitEmbeddingText(trait);

    expect(text).toContain(`Trait: ${trait.id}`);
    expect(text).toContain(`Category: ${trait.category}`);
    expect(text).toContain(trait.name.en);
    expect(text).toContain(trait.name.de);
    expect(text).toContain(trait.description.en);
    expect(text).toContain(trait.description.de);
    expect(text).toContain('Keywords:');
    expect(text).toContain(trait.keywords[0]);
  });

  it('produces stable hashes for unchanged text', () => {
    const trait = listTraitDefinitions()[0];
    const text = buildTraitEmbeddingText(trait);
    expect(hashTraitEmbeddingText(text)).toBe(hashTraitEmbeddingText(text));
  });

  it('covers every catalog trait', () => {
    const map = buildTraitEmbeddingTextMap();
    expect(map.size).toBe(listTraitDefinitions().length);
    for (const trait of listTraitDefinitions()) {
      expect(map.has(trait.id)).toBe(true);
      expect(map.get(trait.id).text.length).toBeGreaterThan(0);
    }
  });
});

describe('traitEmbeddingsStore', () => {
  let tempDir;
  let tempFile;

  beforeEach(() => {
    resetTraitEmbeddingsCache();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-embeddings-'));
    tempFile = path.join(tempDir, 'identityTraitEmbeddings.json');
    __setEmbeddingsFileForTests(tempFile);
  });

  afterEach(() => {
    __setEmbeddingsFileForTests(null);
    resetTraitEmbeddingsCache();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reports unavailable when embeddings file is missing', () => {
    expect(isTraitEmbeddingsAvailable()).toBe(false);
    expect(getTraitEmbeddingsMetadata().available).toBe(false);
  });

  it('loads vectors from a valid embeddings file', () => {
    const trait = listTraitDefinitions()[0];
    const embedding = Array.from({ length: EMBEDDING_DIMS }, (_, i) => (i === 0 ? 1 : 0));

    fs.writeFileSync(
      tempFile,
      JSON.stringify({
        version: STORE_VERSION,
        model: EMBEDDING_MODEL,
        dims: EMBEDDING_DIMS,
        builtAt: '2026-01-01T00:00:00.000Z',
        catalogTraitCount: 1,
        traits: {
          [trait.id]: {
            textHash: 'abc',
            embedding,
          },
        },
      }),
      'utf8'
    );

    resetTraitEmbeddingsCache();
    expect(isTraitEmbeddingsAvailable()).toBe(true);

    const vec = getTraitEmbedding(trait.id);
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(EMBEDDING_DIMS);
    expect(vec[0]).toBe(1);

    const all = getAllTraitEmbeddings();
    expect(all.size).toBe(1);
    expect(getAllTraitEmbeddings()).toBe(all);
    const index = getTraitEmbeddingIndex();
    expect(index.traitIds).toEqual([trait.id]);
    expect(index.vectors[0]).toBe(vec);
    expect(getTraitEmbeddingsFilePath()).toBe(tempFile);
    expect(getTraitEmbeddingsMetadata().contentSignature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('loads committed embeddings when present', () => {
    const committedPath = path.join(
      __dirname,
      '../../constants/identityTraitEmbeddings.json'
    );
    if (!fs.existsSync(committedPath)) {
      return;
    }

    __setEmbeddingsFileForTests(committedPath);
    resetTraitEmbeddingsCache();

    expect(isTraitEmbeddingsAvailable()).toBe(true);

    const meta = getTraitEmbeddingsMetadata();
    expect(meta.model).toBe(EMBEDDING_MODEL);
    expect(meta.dims).toBe(EMBEDDING_DIMS);
    expect(meta.embeddedTraitCount).toBe(listTraitDefinitions().length);

    const firstTrait = listTraitDefinitions()[0];
    const vec = getTraitEmbedding(firstTrait.id);
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(EMBEDDING_DIMS);

    const all = getAllTraitEmbeddings();
    expect(all.size).toBe(listTraitDefinitions().length);
    expect(warmTraitEmbeddingsCache()).toBe(true);
    expect(getTraitEmbeddingIndex().traitIds.length).toBe(listTraitDefinitions().length);
  });
});
