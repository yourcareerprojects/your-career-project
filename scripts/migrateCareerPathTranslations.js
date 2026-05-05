#!/usr/bin/env node
/**
 * @deprecated Legacy translation table sync was removed. Titles live on CareerPath as embedded i18n.
 * Use: npm run migrate:embedded-i18n
 */
require('dotenv').config();

console.error(
  '[migrateCareerPathTranslations] REMOVED: careerpathtranslations sync is obsolete. ' +
  'Run `npm run migrate:embedded-i18n` and use embedded { title: { en, de } } on CareerPath.',
);
process.exit(1);
