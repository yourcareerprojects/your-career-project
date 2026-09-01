/**
 * Split role description text into display paragraphs.
 * Prefers blank-line / newline breaks; otherwise batches sentences in groups of three.
 */
export function splitDescriptionIntoParagraphs(text) {
  const normalizedText = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalizedText) return [];

  const lineParagraphs = normalizedText
    .split(/\n\s*\n|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (lineParagraphs.length > 1) return lineParagraphs;

  const sentences = normalizedText.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!sentences || sentences.length <= 2) return [normalizedText];

  const paragraphs = [];
  const sentenceBatchSize = 3;
  for (let i = 0; i < sentences.length; i += sentenceBatchSize) {
    paragraphs.push(sentences.slice(i, i + sentenceBatchSize).join(' ').trim());
  }
  return paragraphs.filter(Boolean);
}

/**
 * Return the first sentence of a description (or the full text if no sentence boundary).
 * @param {unknown} text
 * @returns {string}
 */
export function extractFirstSentence(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  const sentences = normalized.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!sentences || !sentences.length) return normalized;
  return sentences[0].trim();
}
