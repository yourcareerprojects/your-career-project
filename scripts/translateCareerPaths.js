#!/usr/bin/env node
/**
 * Legacy: projected EN rows from `careerpathtranslations` into DE placeholders.
 * Set `CareerPath.title` / `description` embedded i18n instead.
 */
require('dotenv').config();
console.error(
  '[translateCareerPaths] REMOVED: use embedded `CareerPath` title/description { en, de } instead.',
);
process.exit(1);
