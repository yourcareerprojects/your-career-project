jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
  },
}));

jest.mock('../services/documents/pdfImageOcr', () => ({
  extractPdfTextViaOcr: jest.fn(),
  extractImageTextViaOcr: jest.fn(),
}));

const { promises: fs } = require('fs');
const { extractImageTextViaOcr } = require('../services/documents/pdfImageOcr');
const { parseDocumentToText } = require('../services/documents/documentProfileEnrichment');
const { validateDocumentBuffer } = require('../middleware/persistValidatedDocumentUpload');

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

  test('rejects PNG uploads when content is not actually PNG', () => {
    const fakePngFile = {
      originalname: 'resume.png',
      mimetype: 'image/png',
      buffer: Buffer.from('not-a-real-png'),
    };

    expect(() => validateDocumentBuffer(fakePngFile)).toThrow(/JPG, JPEG, and PNG/);
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
