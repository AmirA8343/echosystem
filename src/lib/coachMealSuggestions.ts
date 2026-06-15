export type CoachMealSuggestion = {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

const suggestions: CoachMealSuggestion[] = [
  { name: "Greek yogurt berry bowl", calories: 260, protein: 27, carbs: 28, fat: 4 },
  { name: "Cottage cheese and berries", calories: 240, protein: 28, carbs: 20, fat: 5 },
  { name: "Turkey and avocado wrap", calories: 360, protein: 32, carbs: 34, fat: 11 },
  { name: "Tuna and whole-grain crackers", calories: 310, protein: 34, carbs: 26, fat: 8 },
  { name: "Chicken and egg snack box", calories: 390, protein: 42, carbs: 20, fat: 15 },
  { name: "Tofu edamame bowl", calories: 350, protein: 30, carbs: 32, fat: 13 },
  { name: "Chicken rice vegetable bowl", calories: 520, protein: 48, carbs: 55, fat: 12 },
];

export function getCoachMealSuggestion(
  proteinGap: number,
  preferredProtein: number
): CoachMealSuggestion {
  const gap = Math.max(0, Math.round(proteinGap));
  const desiredProtein = Math.max(20, Math.min(gap || 20, Math.round(preferredProtein)));

  return suggestions
    .map((suggestion) => ({
      suggestion,
      score:
        Math.abs(suggestion.protein - desiredProtein) +
        (suggestion.protein > gap + 10 ? suggestion.protein - gap : 0) +
        (desiredProtein <= 35 && suggestion.calories > 400 ? 6 : 0),
    }))
    .sort((a, b) => a.score - b.score)[0].suggestion;
}

