import type { MicronutrientTotals, SummarySource } from "../types.js";

export type DailySummaryPatch = {
  caloriesLogged?: number;
  proteinLogged?: number;
  mealsLogged?: number;
  workoutMinutes?: number;
  steps?: number;
  sleepHours?: number;
  hydrationMl?: number;
  activeEnergyKcal?: number;
  sodiumMg?: number;
  micronutrients?: MicronutrientTotals;
  faceScanDone?: boolean;
  bodyScanDone?: boolean;
  faceOverallScore?: number;
  bodyPostureScore?: number;
  bodyDefinitionScore?: number;
  bodyFatRangeEstimate?: string;
  nutritionSignalLabel?: string;
  nutritionSuggestion?: string;
};

const FITMACRO_FIELDS = [
  "caloriesLogged",
  "proteinLogged",
  "mealsLogged",
  "activeEnergyKcal",
  "workoutMinutes",
  "steps",
  "sodiumMg",
  "micronutrients",
] as const;
const FITFACE_FIELDS = [
  "workoutMinutes",
  "steps",
  "sleepHours",
  "hydrationMl",
  "faceScanDone",
  "bodyScanDone",
  "faceOverallScore",
  "bodyPostureScore",
  "bodyDefinitionScore",
  "bodyFatRangeEstimate",
  "nutritionSignalLabel",
  "nutritionSuggestion",
] as const;

export function sanitizeDailySummaryPatch(
  source: SummarySource,
  patch: DailySummaryPatch
): DailySummaryPatch {
  const allowed: readonly (keyof DailySummaryPatch)[] =
    source === "fitmacro" ? FITMACRO_FIELDS : FITFACE_FIELDS;
  const out: Record<string, number | boolean | string | MicronutrientTotals | undefined> = {};

  for (const key of allowed) {
    const value = patch[key];
    if (value !== undefined) out[key] = value;
  }

  return out as DailySummaryPatch;
}
