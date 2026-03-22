import type { SummarySource } from "../types.js";

export type DailySummaryPatch = {
  caloriesLogged?: number;
  proteinLogged?: number;
  mealsLogged?: number;
  workoutMinutes?: number;
  steps?: number;
  sleepHours?: number;
  hydrationMl?: number;
  sodiumMg?: number;
  faceScanDone?: boolean;
  bodyScanDone?: boolean;
};

const FITMACRO_FIELDS = ["caloriesLogged", "proteinLogged", "mealsLogged", "sodiumMg"] as const;
const FITFACE_FIELDS = [
  "workoutMinutes",
  "steps",
  "sleepHours",
  "hydrationMl",
  "faceScanDone",
  "bodyScanDone",
] as const;

export function sanitizeDailySummaryPatch(
  source: SummarySource,
  patch: DailySummaryPatch
): DailySummaryPatch {
  const allowed: readonly (keyof DailySummaryPatch)[] =
    source === "fitmacro" ? FITMACRO_FIELDS : FITFACE_FIELDS;
  const out: Record<string, number | boolean | undefined> = {};

  for (const key of allowed) {
    const value = patch[key];
    if (value !== undefined) out[key] = value;
  }

  return out as DailySummaryPatch;
}
