/**
 * Trait pattern definitions for role-fit explanations (language-neutral matching).
 * Copy for anchors/sentences lives in roleFitExplanationCopy.js.
 */
export const ROLE_FIT_TRAIT_DEFINITIONS = [
  {
    id: 'complexity',
    dimension: 'cognitive',
    pattern: /(complex|messy|chaos|intricate|problem|komplex|verworren)/,
    roleFit: ['strategy', 'analysis', 'operations', 'problem-solving'],
  },
  {
    id: 'systems-thinking',
    dimension: 'cognitive',
    pattern:
      /(system think|systems think|interdepend|ecosystem|architecture mindset|whole system|plattform|integration)/,
    roleFit: ['analysis', 'strategy', 'planning', 'problem-solving', 'execution'],
  },
  {
    id: 'detail',
    dimension: 'cognitive',
    pattern: /(detail|accuracy|thorough|careful|precision|granular|qualit|genau|sorgfaelt|sorgfält)/,
    roleFit: ['analysis', 'operations', 'compliance', 'research'],
  },
  {
    id: 'ownership',
    dimension: 'execution',
    pattern: /(ownership|initiative|accountab|eigenverantwort|verantwortung|take charge|own the outcome)/,
    roleFit: ['leadership', 'execution', 'delivery', 'operations'],
  },
  {
    id: 'momentum',
    dimension: 'execution',
    pattern: /(momentum|ship it|deliver|execute|move forward|umsetzen|vorantreiben|ergebnisorientiert)/,
    roleFit: ['execution', 'delivery', 'operations', 'planning'],
  },
  {
    id: 'reliability',
    dimension: 'execution',
    pattern: /(reliab|dependable|consistent delivery|steady|follow through|verlässlich|beständig)/,
    roleFit: ['execution', 'delivery', 'operations', 'planning'],
  },
  {
    id: 'communication',
    dimension: 'communication',
    pattern:
      /(communicat|present|explain|storytelling|listen actively|writing clearly|kommun|gespraech|gespräch)/,
    roleFit: ['sales', 'partnership', 'customer', 'product', 'coordination', 'communication'],
  },
  {
    id: 'clarity',
    dimension: 'communication',
    pattern: /(clarity|plain language|simple language|make it clear|verständlich|klar formulieren)/,
    roleFit: ['analysis', 'strategy', 'planning', 'operations', 'communication'],
  },
  {
    id: 'adaptability',
    dimension: 'adaptation',
    pattern: /(adapt|flexib|pivot|context shift|anpass|wendig)/,
    roleFit: ['problem-solving', 'execution', 'operations', 'strategy'],
  },
  {
    id: 'grounded',
    dimension: 'adaptation',
    pattern: /(grounded|pragmatic|down to earth|realistic|sachlich|nüchtern)/,
    roleFit: ['execution', 'planning', 'problem-solving', 'operations', 'strategy', 'analysis'],
  },
  {
    id: 'collaboration',
    dimension: 'interaction',
    pattern: /(collaborat|co.create|team player|cross.team|together we|gemeinsam|zusammenarbeit)/,
    roleFit: ['coordination', 'operations', 'product', 'execution', 'leadership', 'communication'],
  },
  {
    id: 'influence',
    dimension: 'interaction',
    pattern: /(influenc|persuad|convince|buy.in|alignment|stakeholder buy|wirkung|überzeugen)/,
    roleFit: ['leadership', 'coordination', 'sales', 'strategy', 'communication', 'partnership'],
  },
  {
    id: 'stakeholder-awareness',
    dimension: 'interaction',
    pattern: /(stakeholder|client|customer|sponsor|partner|multi.party|schnittstelle|ansprechpartner)/,
    roleFit: ['sales', 'partnership', 'customer', 'coordination', 'communication', 'product', 'leadership'],
  },
  {
    id: 'decisiveness',
    dimension: 'decision',
    pattern: /(decisive|make the call|call it|choose|commit to a path|entscheidungsfreude|entscheidungsstärke)/,
    roleFit: ['leadership', 'execution', 'strategy', 'planning', 'operations'],
  },
  {
    id: 'judgment',
    dimension: 'decision',
    pattern: /(judgment|judgement|sound judgment|taste|sense for risk|Urteil|Bewertung)/,
    roleFit: ['strategy', 'analysis', 'problem-solving', 'planning', 'leadership'],
  },
  {
    id: 'prioritization',
    dimension: 'decision',
    pattern: /(priorit|sequencing|tradeoff|trade.off|focus on what matters|rangfolge|wichtigste zuerst)/,
    roleFit: ['planning', 'operations', 'execution', 'strategy', 'analysis', 'leadership'],
  },
  {
    id: 'long-term-thinking',
    dimension: 'strategic',
    pattern: /(long.term|longterm|years out|future state|roadmap thinking|nachhaltig|langfrist)/,
    roleFit: ['strategy', 'planning', 'analysis', 'leadership'],
  },
  {
    id: 'big-picture-thinking',
    dimension: 'strategic',
    pattern: /(big picture|holistic|overview|forest not trees|gesamtbild|ganzheitlich)/,
    roleFit: ['strategy', 'planning', 'problem-solving', 'analysis', 'leadership'],
  },
  {
    id: 'ambiguity-tolerance',
    dimension: 'ambiguity',
    pattern: /(ambiguity|uncertain|unknowns|fuzzy|unclear requirements|unklar|vage)/,
    roleFit: ['strategy', 'analysis', 'problem-solving', 'operations', 'planning'],
  },
  {
    id: 'structured-thinking-uncertainty',
    dimension: 'ambiguity',
    pattern:
      /(frame the problem|reframe|structure.*uncertain|uncertain.*plan|organize.*unknown|rahmen|struktur.*unklar)/,
    roleFit: ['planning', 'operations', 'strategy', 'analysis', 'problem-solving', 'execution'],
  },
];

export const ROLE_FIT_FALLBACK_TRAIT_DEFINITIONS = [
  {
    id: 'steady-execution',
    dimension: 'execution',
    roleFit: ['execution', 'delivery', 'operations', 'planning', 'leadership'],
  },
  {
    id: 'clear-thinking-under-uncertainty',
    dimension: 'ambiguity',
    roleFit: ['strategy', 'analysis', 'problem-solving', 'planning', 'operations'],
  },
  {
    id: 'consistent-follow-through',
    dimension: 'execution',
    roleFit: ['execution', 'delivery', 'operations', 'planning', 'coordination', 'leadership'],
  },
  {
    id: 'flexible-problem-solving',
    dimension: 'adaptation',
    roleFit: ['problem-solving', 'execution', 'strategy', 'analysis', 'operations', 'planning'],
  },
];
