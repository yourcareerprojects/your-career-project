jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    promises: {
      readFile: jest.fn(),
      mkdir: jest.fn(),
      writeFile: jest.fn(),
      open: actual.promises.open,
      unlink: actual.promises.unlink,
    copyFile: jest.fn(),
      rename: actual.promises.rename,
    },
  };
});

jest.mock('../services/documents/pdfImageOcr', () => ({
  extractPdfTextViaOcr: jest.fn(),
  extractImageTextViaOcr: jest.fn(),
}));

const { promises: fs } = require('fs');
const { extractImageTextViaOcr } = require('../services/documents/pdfImageOcr');
const { parseDocumentToText } = require('../services/documents/documentProfileEnrichment');
const {
  validateDocumentBuffer,
  readValidationSnippet,
  moveUploadedFile,
} = require('../middleware/persistValidatedDocumentUpload');
const os = require('os');
const path = require('path');

describe('document image upload support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('accepts PNG uploads with a valid signature', () => {
    const pngFile = {
      originalname: 'resume.png',
      mimetype: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    };

    expect(validateDocumentBuffer(pngFile)).toBe('.png');
  });

  test('accepts JPEG uploads with a valid signature', () => {
    const jpegFile = {
      originalname: 'resume.jpeg',
      mimetype: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
    };

    expect(validateDocumentBuffer(jpegFile)).toBe('.jpeg');
  });

  test('readValidationSnippet reads file prefix without loading entire file', async () => {
    const realFs = jest.requireActual('fs').promises;
    const payload = Buffer.alloc(64 * 1024, 0x41);
    payload[0] = 0x89;
    payload[1] = 0x50;
    payload[2] = 0x4e;
    payload[3] = 0x47;
    payload[4] = 0x0d;
    payload[5] = 0x0a;
    payload[6] = 0x1a;
    payload[7] = 0x0a;
    const tmpPath = path.join(os.tmpdir(), `cv-snippet-${Date.now()}.png`);
    await realFs.writeFile(tmpPath, payload);
    try {
      const snippet = await readValidationSnippet(tmpPath);
      expect(snippet.length).toBeLessThanOrEqual(512 * 1024);
      expect(validateDocumentBuffer({
        originalname: 'big.png',
        mimetype: 'image/png',
        buffer: snippet,
      })).toBe('.png');
    } finally {
      await realFs.unlink(tmpPath).catch(() => {});
    }
  });

  test('rejects PNG uploads when content is not actually PNG', () => {
    const fakePngFile = {
      originalname: 'resume.png',
      mimetype: 'image/png',
      buffer: Buffer.from('not-a-real-png'),
    };

    expect(() => validateDocumentBuffer(fakePngFile)).toThrow(/JPG, JPEG, and PNG/);
  });

  test('moveUploadedFile falls back to copy+unlink on EXDEV', async () => {
    const renameSpy = jest.spyOn(fs, 'rename').mockRejectedValueOnce({ code: 'EXDEV' });
    const copySpy = jest.spyOn(fs, 'copyFile').mockResolvedValueOnce();
    const unlinkSpy = jest.spyOn(fs, 'unlink').mockResolvedValueOnce();

    await moveUploadedFile('/tmp/in.pdf', '/uploads/out.pdf');

    expect(renameSpy).toHaveBeenCalledWith('/tmp/in.pdf', '/uploads/out.pdf');
    expect(copySpy).toHaveBeenCalledWith('/tmp/in.pdf', '/uploads/out.pdf');
    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/in.pdf');
  });

  test('runs OCR for image CV uploads', async () => {
    const imageBytes = Buffer.from('image-bytes');
    fs.readFile.mockResolvedValue(imageBytes);
    extractImageTextViaOcr.mockResolvedValue('Jane Doe');

    const text = await parseDocumentToText('C:/tmp/resume.png');

    expect(fs.readFile).toHaveBeenCalledWith('C:/tmp/resume.png');
    expect(extractImageTextViaOcr).toHaveBeenCalledWith(imageBytes);
    expect(text).toBe('Jane Doe');
  });
});
