const {
  parseInterestTopicsFromText,
  formatInterestTopicsAsText,
  parseTopicsIndustriesFromText,
} = require('../utils/topicsIndustriesText');

describe('topicsIndustriesParse', () => {
  test('preserves more than five interest topics from the identity field', () => {
    const topics = [
      'Space exploration',
      'Systems thinking',
      'Climate tech',
      'Open source',
      'Product design',
      'Behavioral science',
      'Public policy',
    ];
    const stored = formatInterestTopicsAsText(topics);
    expect(parseInterestTopicsFromText(stored)).toEqual(topics);
  });

  test('keeps only the topics block from legacy dual-block storage', () => {
    const text = 'Robotics\nBiotech\n\nHealthcare\nAutomotive';
    expect(parseInterestTopicsFromText(text)).toEqual(['Robotics', 'Biotech']);
    expect(parseTopicsIndustriesFromText(text)).toEqual({
      interestTopics: ['Robotics', 'Biotech'],
      industries: ['Healthcare', 'Automotive'],
    });
  });
});
