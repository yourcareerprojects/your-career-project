#!/usr/bin/env node
/**
 * Legacy: inserted placeholder DE rows into `skilltranslations`.
 * Set `Skill.label.de` (or null) on the skill document when you add a German string.
 */
require('dotenv').config();
console.error(
  '[translateSkills] REMOVED: use embedded `Skill.label` { en, de } instead of skilltranslations.',
);
process.exit(1);
