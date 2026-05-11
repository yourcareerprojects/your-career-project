const { resolveRequestLanguage } = require('../utils/languageResolution');

module.exports = function languageResolutionMiddleware(req, _res, next) {
  req.language = resolveRequestLanguage(req, { defaultLanguage: 'de' });
  req.resolvedLanguage = req.language;
  next();
};
