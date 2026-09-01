/**
 * Occupation → industry domain classification (AI).
 * @module services/occupationDomainClassification
 */

module.exports = {
  ...require('./domainClassificationDb'),
  ...require('./domainClassificationLlmClient'),
  ...require('./domainClassificationPrompt'),
  ...require('./domainClassificationValidation'),
  ...require('./domainClassificationService'),
};
