import type { MicronutrientTotals } from "../types.js";

type NutrientKey = keyof MicronutrientTotals;

type NutrientDefinition = {
  key: NutrientKey;
  label: string;
  target: (profile: Record<string, unknown> | null) => number;
  foods: string;
};

export type MicronutrientCoachSuggestion = {
  nutrientKey: NutrientKey;
  nutrientLabel: string;
  confidence: "medium" | "high";
  loggedDays: number;
  averageTargetRatio: number;
  title: string;
  body: string;
};

const profileNumber = (
  profile: Record<string, unknown> | null,
  camelKey: string,
  snakeKey: string
): number => {
  const value = Number(profile?.[camelKey] ?? profile?.[snakeKey] ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const profileSex = (profile: Record<string, unknown> | null): "male" | "female" | null => {
  const value = profile?.sex;
  return value === "male" || value === "female" ? value : null;
};

const nutrientDefinitions: NutrientDefinition[] = [
  {
    key: "fiberG",
    label: "fiber",
    target: (profile) => (profileSex(profile) === "male" ? 38 : 25),
    foods: "beans, lentils, berries, oats, or vegetables",
  },
  {
    key: "potassiumMg",
    label: "potassium",
    target: () => 3500,
    foods: "potatoes, beans, yogurt, bananas, or leafy greens",
  },
  {
    key: "calciumMg",
    label: "calcium",
    target: (profile) => (profileNumber(profile, "age", "age") > 50 ? 1200 : 1000),
    foods: "yogurt, milk, calcium-set tofu, sardines, or fortified foods",
  },
  {
    key: "ironMg",
    label: "iron",
    target: (profile) =>
      profileSex(profile) === "female" && profileNumber(profile, "age", "age") <= 50
        ? 18
        : 8,
    foods: "lentils, lean meat, beans, spinach, or fortified grains",
  },
  {
    key: "magnesiumMg",
    label: "magnesium",
    target: (profile) => (profileSex(profile) === "male" ? 420 : 320),
    foods: "pumpkin seeds, almonds, beans, whole grains, or leafy greens",
  },
  {
    key: "zincMg",
    label: "zinc",
    target: (profile) => (profileSex(profile) === "male" ? 11 : 8),
    foods: "seafood, lean meat, beans, pumpkin seeds, or dairy",
  },
  {
    key: "vitaminAMcg",
    label: "vitamin A",
    target: (profile) => (profileSex(profile) === "male" ? 900 : 700),
    foods: "sweet potato, carrots, spinach, eggs, or dairy",
  },
  {
    key: "vitaminCMg",
    label: "vitamin C",
    target: (profile) => (profileSex(profile) === "male" ? 90 : 75),
    foods: "bell peppers, citrus, kiwi, berries, or broccoli",
  },
  {
    key: "vitaminDMcg",
    label: "vitamin D",
    target: () => 15,
    foods: "salmon, eggs, or vitamin-D-fortified foods",
  },
  {
    key: "vitaminEMg",
    label: "vitamin E",
    target: () => 15,
    foods: "almonds, sunflower seeds, avocado, or olive oil",
  },
  {
    key: "vitaminKMcg",
    label: "vitamin K",
    target: (profile) => (profileSex(profile) === "male" ? 120 : 90),
    foods: "kale, spinach, broccoli, or Brussels sprouts",
  },
  {
    key: "vitaminB12Mcg",
    label: "vitamin B12",
    target: () => 2.4,
    foods: "fish, eggs, dairy, meat, or fortified foods",
  },
];

const summaryNumber = (
  summary: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): number => {
  const value = Number(summary[camelKey] ?? summary[snakeKey] ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const readMicronutrients = (
  summary: Record<string, unknown>
): MicronutrientTotals | null => {
  const value = summary.micronutrients;
  return value && typeof value === "object"
    ? (value as MicronutrientTotals)
    : null;
};

export const isMicronutrientCoachingEnabled = (): boolean =>
  process.env.MICRONUTRIENT_COACHING_ENABLED === "true";

export function deriveMicronutrientCoachSuggestion(input: {
  summaries: Record<string, unknown>[];
  profile: Record<string, unknown> | null;
}): MicronutrientCoachSuggestion | null {
  if (!isMicronutrientCoachingEnabled()) return null;

  const eligibleDays = input.summaries.slice(0, 7).filter((summary) => {
    const meals = summaryNumber(summary, "mealsLogged", "meals_logged");
    const calories = summaryNumber(summary, "caloriesLogged", "calories_logged");
    return meals >= 2 && calories >= 800 && readMicronutrients(summary) !== null;
  });
  if (eligibleDays.length < 3) return null;

  const candidates = nutrientDefinitions.flatMap((definition) => {
    const values = eligibleDays
      .map((summary) => Number(readMicronutrients(summary)?.[definition.key] ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (values.length < 3) return [];

    const target = definition.target(input.profile);
    if (!Number.isFinite(target) || target <= 0) return [];
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const ratio = average / target;
    if (ratio >= 0.65) return [];

    return [{ definition, ratio, loggedDays: values.length }];
  });
  const candidate = candidates.sort((left, right) => left.ratio - right.ratio)[0];
  if (!candidate) return null;

  const confidence =
    eligibleDays.length >= 5 && candidate.loggedDays >= 5 ? "high" : "medium";
  return {
    nutrientKey: candidate.definition.key,
    nutrientLabel: candidate.definition.label,
    confidence,
    loggedDays: candidate.loggedDays,
    averageTargetRatio: Number(candidate.ratio.toFixed(2)),
    title: `${candidate.definition.label} food check`,
    body: `Your logged ${candidate.definition.label} has trended below the food-based reference on well-logged days. Add ${candidate.definition.foods}. Food logs are estimates, not a diagnosis.`,
  };
}
