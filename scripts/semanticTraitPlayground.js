#!/usr/bin/env node
/**
 * semanticTraitPlayground.js
 *
 * CLI playground for validating semantic identity trait matching before production integration.
 * Does not modify the identity engine.
 *
 * Usage:
 *   npm run playground:semantic-traits
 *   npm run playground:semantic-traits -- --examples
 *   npm run playground:semantic-traits -- --example=reflection_helping
 *   npm run playground:semantic-traits -- "I love mentoring teams and strategic planning"
 *   npm run playground:semantic-traits -- --text="..." --threshold=0.35 --top=15
 *
 * Options:
 *   --examples              Run all built-in representative test cases
 *   --example=<id>          Run one built-in example by id
 *   --text=<string>         Match arbitrary text (alternative to positional arg)
 *   --file=<path>           Read text from a file
 *   --threshold=<number>    Minimum cosine similarity (default: 0)
 *   --top=<number>          Number of traits to show (default: 10)
 *   --list-examples         List example ids and labels
 *
 * Prerequisites:
 *   OPENAI_API_KEY in .env
 *   npm run build:identity-trait-embeddings (committed embeddings file)
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  matchTraitsSemantically,
  getSemanticMatcherMetadata,
  DEFAULT_TOP_K,
} = require('../src/server/services/careerIdentity/semanticTraitMatcher');
const {
  listPlaygroundExamples,
  getPlaygroundExample,
} = require('../src/server/services/careerIdentity/semanticTraitPlaygroundExamples');
function parseArgs(argv) {
  const flags = {
    examples: false,
    listExamples: false,
    exampleId: null,
    text: null,
    file: null,
    threshold: 0,
    top: DEFAULT_TOP_K,
    positionalText: null,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--examples') flags.examples = true;
    else if (arg === '--list-examples') flags.listExamples = true;
    else if (arg.startsWith('--example=')) flags.exampleId = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--text=')) flags.text = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--file=')) flags.file = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--threshold=')) {
      flags.threshold = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--top=')) {
      flags.top = parseInt(arg.split('=')[1], 10);
    } else if (!arg.startsWith('-')) {
      flags.positionalText = flags.positionalText ? `${flags.positionalText} ${arg}` : arg;
    }
  }

  if (!Number.isFinite(flags.threshold)) flags.threshold = 0;
  if (!Number.isFinite(flags.top) || flags.top < 1) flags.top = DEFAULT_TOP_K;

  return flags;
}

function printUsage() {
  console.log(`Semantic Trait Matching Playground

Usage:
  node scripts/semanticTraitPlayground.js [text]
  node scripts/semanticTraitPlayground.js --examples [--threshold=0.35] [--top=10]
  node scripts/semanticTraitPlayground.js --example=<id>
  node scripts/semanticTraitPlayground.js --text="..."

Options:
  --examples, --example=<id>, --list-examples
  --text=<string>, --file=<path>
  --threshold=<number>   Min cosine similarity filter (default 0)
  --top=<number>         Max traits to show (default ${DEFAULT_TOP_K})
`);
}

function formatScore(similarity) {
  return similarity.toFixed(4);
}

function printMatches(label, text, matches, options) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(label);
  console.log(`${'─'.repeat(72)}`);
  console.log(`Input (${text.length} chars):`);
  console.log(text.length > 220 ? `${text.slice(0, 220)}…` : text);
  console.log(`${'─'.repeat(72)}`);
  console.log(
    `Semantic matches (threshold ≥ ${options.threshold}, top ${options.top}):`
  );

  if (matches.length === 0) {
    console.log('  (no traits above threshold — try lowering --threshold)');
  } else {
    matches.forEach((match, index) => {
      const marker = match.similarity >= options.threshold ? ' ' : '?';
      console.log(
        `  ${String(index + 1).padStart(2, ' ')}.${marker} ` +
          `[${formatScore(match.similarity)}] ${match.traitId} — ${match.name.en} ` +
          `(${match.category})`
      );
    });
  }
}

async function runExample(example, options) {
  const matches = await matchTraitsSemantically(example.text, {
    topK: options.top,
    minSimilarity: options.threshold,
  });
  printMatches(
    `${example.label} [${example.sourceType}] (id: ${example.id})`,
    example.text,
    matches,
    options
  );
}

async function runText(text, label, options) {
  const matches = await matchTraitsSemantically(text, {
    topK: options.top,
    minSimilarity: options.threshold,
  });
  printMatches(label, text, matches, options);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    printUsage();
    return;
  }

  if (flags.listExamples) {
    console.log('Built-in playground examples:\n');
    for (const ex of listPlaygroundExamples()) {
      console.log(`  ${ex.id.padEnd(28)} ${ex.label}`);
    }
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY must be set in .env');
    process.exit(1);
  }

  const meta = getSemanticMatcherMetadata();
  console.log('Semantic Trait Playground');
  console.log(`  Model:            ${meta.embeddingModel}`);
  console.log(`  Trait embeddings: ${meta.traitEmbeddings.embeddedTraitCount} traits`);
  console.log(`  Threshold:        ${flags.threshold}`);
  console.log(`  Top K:            ${flags.top}`);

  const options = {
    threshold: flags.threshold,
    top: flags.top,
  };

  if (flags.examples) {
    for (const example of listPlaygroundExamples()) {
      await runExample(example, options);
    }
    console.log(`\n${'='.repeat(72)}`);
    console.log(`Ran ${listPlaygroundExamples().length} examples.`);
    console.log('Tip: try --threshold=0.30 or --threshold=0.35 to filter weaker matches.');
    return;
  }

  if (flags.exampleId) {
    const example = getPlaygroundExample(flags.exampleId);
    if (!example) {
      console.error(`Unknown example id: ${flags.exampleId}`);
      console.error('Use --list-examples to see available ids.');
      process.exit(1);
    }
    await runExample(example, options);
    return;
  }

  let text = flags.text || flags.positionalText;
  if (flags.file) {
    const filePath = path.resolve(flags.file);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    text = fs.readFileSync(filePath, 'utf8');
  }

  if (!text || !String(text).trim()) {
    printUsage();
    console.log('\nNo input text provided. Running built-in examples...\n');
    for (const example of listPlaygroundExamples()) {
      await runExample(example, options);
    }
    return;
  }

  await runText(String(text).trim(), 'Custom input', options);
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
