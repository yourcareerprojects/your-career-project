const { buildMessages } = require('../prompts/interpretCvToProfile');

describe('interpretCvToProfile.buildMessages', () => {
  test('English document locale includes concise professional wording guidance', () => {
    const messages = buildMessages('Jane Doe Senior Engineer', 'en');
    const systemContent = messages[0].content;
    const userContent = messages[1].content;
    expect(systemContent.toLowerCase()).toContain('comparable across locales');
    expect(systemContent).toMatch(/Requested document output locale:\s+en/i);
    expect(userContent).toContain(' clichés ');
  });

  test('German document locale does not inject English-only cliché line', () => {
    const messages = buildMessages('Lebenslauf', 'de');
    expect(messages[1].content).not.toContain(' clichés ');
    expect(messages[0].content).toMatch(/Requested document output locale:\s+de/i);
  });
});
