const { aiTaskConfig } = require('./aiTaskConfig');
const { aiToneConfig } = require('./aiToneConfig');
const { translateStructured } = require('./translateStructured');
const { validateAIOutput } = require('./validateAIOutput');
const { cachedTranslate } = require('./translationCache');

async function runPrompt(task, input, options, runner) {
  if (typeof runner !== 'function') {
    throw new Error(`No runner configured for task "${task}"`);
  }
  return runner({ task, input, ...options });
}

async function generateAI({ task, input, lang = 'en', sourceLang = 'en', additionalLangs = [], runner }) {
  const strategy = aiTaskConfig[task] || aiTaskConfig.default;
  const tone = aiToneConfig[task] || aiToneConfig.default;
  const source = String(sourceLang || 'en').toLowerCase().split('-')[0] || 'en';
  const canonicalRaw = await runPrompt(task, input, { lang: source, tone }, runner);
  const canonical = validateAIOutput(task, canonicalRaw);

  let localized = {};
  const requested = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  const desiredLangs = [...new Set([requested, ...(Array.isArray(additionalLangs) ? additionalLangs : [])]
    .map((v) => String(v || '').toLowerCase().split('-')[0] || 'en')
    .filter((v) => v && v !== source))];
  for (const targetLang of desiredLangs) {
    try {
      if (strategy === 'translate') {
        const translated = await cachedTranslate(
          canonical,
          targetLang,
          () => translateStructured(canonical, targetLang)
        );
        const validatedTranslated = validateAIOutput(task, translated);
        if (validatedTranslated !== null && validatedTranslated !== undefined) {
          localized[targetLang] = validatedTranslated;
        }
        if (process.env.AI_DEBUG_LOCALIZATION === '1') {
          console.debug(`[generateAI] task=${task} strategy=translate lang=${targetLang}`);
        }
      } else if (strategy === 'generate') {
        const generated = await runPrompt(task, input, { lang: targetLang, tone }, runner);
        const validatedGenerated = validateAIOutput(task, generated);
        if (validatedGenerated !== null && validatedGenerated !== undefined) {
          localized[targetLang] = validatedGenerated;
        }
        if (process.env.AI_DEBUG_LOCALIZATION === '1') {
          console.debug(`[generateAI] task=${task} strategy=generate lang=${targetLang}`);
        }
      }
    } catch (err) {
      if (process.env.AI_DEBUG_LOCALIZATION === '1') {
        console.debug(`[generateAI] task=${task} localization_failed lang=${targetLang} error=${err?.message || 'unknown'}`);
      }
    }
  }

  return {
    canonical,
    canonicalLanguage: source,
    localized,
  };
}

module.exports = {
  generateAI,
};
