/**
 * Thematic groupings for the industry picker dialog (order preserved in UI).
 * Every {@link INDUSTRY_TAXONOMY} id must appear exactly once.
 */
const INDUSTRY_SECTOR_GROUPS = [
  {
    key: 'healthLife',
    ids: [
      'healthcare',
      'animals_veterinary',
      'pharmaceuticals',
    ],
  },
  {
    key: 'sciences',
    ids: [
      'natural_sciences',
      'environmental_science',
    ],
  },
  {
    key: 'technology',
    ids: [
      'software',
      'artificial_intelligence',
      'telecommunications',
    ],
  },
  {
    key: 'financeBusiness',
    ids: [
      'finance',
      'economy',
      'insurance',
      'legal_services',
      'real_estate',
    ],
  },
  {
    key: 'industryManufacturing',
    ids: [
      'manufacturing',
      'mining_metals',
      'energy',
      'sustainability',
    ],
  },
  {
    key: 'buildingTrades',
    ids: [
      'construction',
      'architecture',
      'skilled_trades',
      'electrical_trades',
      'plumbing_hvac',
      'metalworking',
      'woodworking_carpentry',
      'cleaning_facility_services',
    ],
  },
  {
    key: 'mobility',
    ids: [
      'automotive',
      'aerospace',
      'mobility_logistics',
    ],
  },
  {
    key: 'agricultureFood',
    ids: [
      'agriculture',
      'food_beverage',
      'gardening_landscaping',
    ],
  },
  {
    key: 'retailHospitality',
    ids: [
      'retail',
      'ecommerce',
      'hospitality',
      'tourism_travel',
      'fashion_apparel',
      'beauty_personal_care',
    ],
  },
  {
    key: 'mediaCulture',
    ids: [
      'media_entertainment',
      'marketing',
      'culture',
      'sports',
    ],
  },
  {
    key: 'educationSocial',
    ids: [
      'education',
      'social_language_sciences',
      'social_work',
      'nonprofit',
    ],
  },
  {
    key: 'publicDefense',
    ids: [
      'public_sector',
      'defense_security',
    ],
  },
];

function listGroupedIndustryOptions(allOptions = []) {
  const byId = new Map(allOptions.map((option) => [option.id, option]));
  return INDUSTRY_SECTOR_GROUPS.map((group) => ({
    key: group.key,
    options: group.ids
      .map((id) => byId.get(id))
      .filter(Boolean),
  })).filter((group) => group.options.length > 0);
}

module.exports = {
  INDUSTRY_SECTOR_GROUPS,
  listGroupedIndustryOptions,
};
