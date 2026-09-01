/** Category → accent colors for Career Puzzle pieces (MUI sx friendly). */
export const PUZZLE_CATEGORY_COLORS = {
  school: { bg: '#FFFFFF', border: '#4F46E5', accent: '#4F46E5' },
  apprenticeship: { bg: '#FFFFFF', border: '#EA580C', accent: '#EA580C' },
  university: { bg: '#FFFFFF', border: '#7C3AED', accent: '#7C3AED' },
  further_education: { bg: '#FFFFFF', border: '#4338CA', accent: '#4338CA' },
  occupation: { bg: '#FFFFFF', border: '#16A34A', accent: '#16A34A' },
};

export function getCategoryColors(category) {
  return (
    PUZZLE_CATEGORY_COLORS[category] || {
      bg: '#FFFFFF',
      border: '#475569',
      accent: '#475569',
    }
  );
}
