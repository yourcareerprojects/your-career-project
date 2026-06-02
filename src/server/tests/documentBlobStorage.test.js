const { normalizeBlobDataToBuffer } = require('../services/documents/documentBlobStorage');

describe('documentBlobStorage', () => {
  test('normalizeBlobDataToBuffer returns Buffer as-is', () => {
    const input = Buffer.from('abc');
    const out = normalizeBlobDataToBuffer(input);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.equals(input)).toBe(true);
  });

  test('normalizeBlobDataToBuffer converts Uint8Array', () => {
    const input = new Uint8Array([97, 98, 99]);
    const out = normalizeBlobDataToBuffer(input);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString('utf8')).toBe('abc');
  });

  test('normalizeBlobDataToBuffer converts BSON-like Binary value()', () => {
    const input = {
      value: () => new Uint8Array([97, 98, 99]),
    };
    const out = normalizeBlobDataToBuffer(input);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString('utf8')).toBe('abc');
  });
});
