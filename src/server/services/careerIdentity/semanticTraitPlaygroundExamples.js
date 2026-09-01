/**
 * Representative inputs for the semantic trait matching playground.
 * Mirrors real evidence sources: reflections, CV text, saved careers, simulation feedback.
 */

/** @typedef {{ id: string, label: string, sourceType: string, text: string }} SemanticTraitPlaygroundExample */

/** @type {SemanticTraitPlaygroundExample[]} */
const SEMANTIC_TRAIT_PLAYGROUND_EXAMPLES = [
  {
    id: 'reflection_helping',
    label: 'Career reflection — helping others at work',
    sourceType: 'reflection',
    text:
      'What I enjoy most is supporting colleagues and patients through difficult moments. ' +
      'I feel energized when my work directly improves someone else\'s day, especially in caring, ' +
      'empathetic team settings where we listen and collaborate closely.',
  },
  {
    id: 'reflection_analytical',
    label: 'Career reflection — data and problem solving',
    sourceType: 'reflection',
    text:
      'I love breaking complex problems into parts, analyzing data, spotting patterns, and ' +
      'building careful logical arguments. Research, statistics, and debugging tricky systems ' +
      'are where I do my best thinking.',
  },
  {
    id: 'cv_nursing',
    label: 'CV snippet — nursing and patient care',
    sourceType: 'cv',
    text:
      'Registered nurse with five years in acute care. Patient assessment, wound care, medication ' +
      'administration, and family communication. Volunteered in community health outreach. ' +
      'Strong empathy, reliability under emergency pressure, and teamwork on busy wards.',
  },
  {
    id: 'cv_software',
    label: 'CV snippet — software engineering',
    sourceType: 'cv',
    text:
      'Senior software engineer building distributed systems and APIs. Python, cloud infrastructure, ' +
      'code reviews, mentoring junior developers, and iterative delivery in agile sprints. ' +
      'Interested in technology, continuous learning, and solving complex technical problems.',
  },
  {
    id: 'saved_career_ux',
    label: 'Saved career — UX / visual design',
    sourceType: 'career',
    text:
      'UX Designer. Create user-centered interfaces, wireframes, visual layouts, and prototypes. ' +
      'Collaborate with product and engineering. Storytelling through design, creativity, ' +
      'and communicating ideas visually to stakeholders.',
  },
  {
    id: 'saved_career_trades',
    label: 'Saved career — skilled trades / hands-on',
    sourceType: 'career',
    text:
      'Carpenter and workshop technician. Hands-on building, fixing structures, working outdoors ' +
      'on site, precision measuring, and practical problem solving with tools in a physical environment.',
  },
  {
    id: 'simulation_positive_leadership',
    label: 'Simulation feedback — positive leadership role',
    sourceType: 'simulation',
    text:
      'Operations Manager — coordinate teams, set direction, take responsibility for outcomes, ' +
      'mentor staff, resolve conflicts, and plan long-term strategy. User rated this role as a strong fit.',
  },
  {
    id: 'reflection_german_balance',
    label: 'Career reflection (German) — work-life balance',
    sourceType: 'reflection',
    text:
      'Mir ist wichtig, eine gesunde Work-Life-Balance zu haben, mit flexiblen Arbeitszeiten und ' +
      'einem nachhaltigen Tempo. Ich arbeite gern selbstständig im Homeoffice, brauche aber auch ' +
      'Zeit für Familie und Erholung.',
  },
  {
    id: 'simulation_sustainability',
    label: 'Simulation feedback — sustainability impact',
    sourceType: 'simulation',
    text:
      'Environmental consultant working on climate policy, renewable energy projects, and social ' +
      'responsibility. Making an impact for society, stewardship of resources, and long-term planning.',
  },
  {
    id: 'reflection_finance',
    label: 'Career reflection — finance and strategy',
    sourceType: 'reflection',
    text:
      'I am drawn to markets, investment analysis, budgeting, and how organizations grow competitively. ' +
      'Quantitative thinking, risk assessment, and business strategy discussions motivate me.',
  },
];

function getPlaygroundExample(id) {
  const key = String(id || '').trim();
  return SEMANTIC_TRAIT_PLAYGROUND_EXAMPLES.find((ex) => ex.id === key) || null;
}

function listPlaygroundExamples() {
  return SEMANTIC_TRAIT_PLAYGROUND_EXAMPLES.slice();
}

module.exports = {
  SEMANTIC_TRAIT_PLAYGROUND_EXAMPLES,
  getPlaygroundExample,
  listPlaygroundExamples,
};
