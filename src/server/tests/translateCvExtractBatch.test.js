const { translateCvExtractBatch } = require('../services/ai/translateText');

describe('translateCvExtractBatch', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  test('returns empty map for no items', async () => {
    const out = await translateCvExtractBatch([], 'en');
    expect(out.size).toBe(0);
    expect(global.fetch).toBe(originalFetch);
  });

  test('parses structured translations from one response', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                translations: {
                  'identity.workEnjoyMost': 'Produkte bauen',
                  'structured.skillDomains.0': 'Führung',
                },
              }),
            },
          },
        ],
      }),
    });

    const out = await translateCvExtractBatch(
      [
        { id: 'identity.workEnjoyMost', text: 'Build products' },
        { id: 'structured.skillDomains.0', text: 'Leadership' },
      ],
      'en'
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(out.get('identity.workEnjoyMost')).toBe('Produkte bauen');
    expect(out.get('structured.skillDomains.0')).toBe('Führung');
  });
});
