const languageResolutionMiddleware = require('../middleware/languageResolution');

describe('languageResolutionMiddleware', () => {
  test('uses explicit query lang when provided', () => {
    const req = { query: { lang: 'de' }, body: {}, headers: {} };
    const next = jest.fn();

    languageResolutionMiddleware(req, {}, next);

    expect(req.language).toBe('de');
    expect(req.resolvedLanguage).toBe('de');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('falls back to Accept-Language header when no explicit lang exists', () => {
    const req = { query: {}, body: {}, headers: { 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' } };
    const next = jest.fn();

    languageResolutionMiddleware(req, {}, next);

    expect(req.language).toBe('de');
    expect(req.resolvedLanguage).toBe('de');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('defaults to German when request has no language hints', () => {
    const req = { query: {}, body: {}, headers: {} };
    const next = jest.fn();

    languageResolutionMiddleware(req, {}, next);

    expect(req.language).toBe('de');
    expect(req.resolvedLanguage).toBe('de');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
