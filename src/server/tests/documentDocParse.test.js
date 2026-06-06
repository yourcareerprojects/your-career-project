jest.mock('word-extractor', () => class MockWordExtractor {
  extract() {
    return Promise.resolve({
      getBody: () => '',
      getTextboxes: () => 'Jane Doe\nProduct Manager',
      getHeaders: () => 'Skills: Stakeholder Management',
      getFootnotes: () => '',
      getEndnotes: () => '',
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
      expect(result.text).toContain('Stakeholder Management');
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  });

  test('routes zip-backed word files to docx parser even when extension is .doc', async () => {
    jest.resetModules();
    jest.doMock('mammoth', () => ({
      extractRawText: jest.fn().mockResolvedValue({ value: 'Zip-backed CV body' }),
    }));
    jest.doMock('word-extractor', () => class MockWordExtractor {
      extract() {
        return Promise.reject(new Error('should not parse zip as OLE'));
      }
    });
    const { parseDocumentToTextWithMeta: parseWithZipDoc } = require('../services/documents/documentProfileEnrichment');
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const tmpPath = path.join(os.tmpdir(), `cv-${Date.now()}.doc`);
    await fs.promises.writeFile(tmpPath, zipHeader);
    try {
      const result = await parseWithZipDoc(tmpPath);
      expect(result.source).toBe('docx');
      expect(result.text).toContain('Zip-backed CV body');
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  });
});
