jest.mock('word-extractor', () => class MockWordExtractor {
  extract() {
    return Promise.resolve({
      getBody: () => 'Jane Doe\nProduct Manager\nSkills: Stakeholder Management',
    });
  }
});

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('legacy .doc parsing', () => {
  let parseDocumentToTextWithMeta;

  beforeAll(() => {
    jest.resetModules();
    ({ parseDocumentToTextWithMeta } = require('../services/documents/documentProfileEnrichment'));
  });

  test('extracts plain text from OLE .doc files via word-extractor', async () => {
    const oleHeader = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
      0x00, 0x00, 0x00, 0x00,
    ]);
    const tmpPath = path.join(os.tmpdir(), `cv-${Date.now()}.doc`);
    await fs.promises.writeFile(tmpPath, oleHeader);
    try {
      const result = await parseDocumentToTextWithMeta(tmpPath);
      expect(result.source).toBe('doc');
      expect(result.text).toContain('Jane Doe');
      expect(result.text).toContain('Product Manager');
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  });
});
