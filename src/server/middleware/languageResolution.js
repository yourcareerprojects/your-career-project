const { resolveRequestLanguage } = require('../utils/languageResolution');

module.exports = function languageResolutionMiddleware(req, _res, next) {
  req.language = resolveRequestLanguage(req, { defaultLanguage: 'en' });
  req.resolvedLanguage = req.language;
  next();
};
