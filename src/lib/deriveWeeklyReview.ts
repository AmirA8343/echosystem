import { deriveCoachDecision } from "./deriveCoachDecision.js";
import { summarizeCoachEvents } from "./summarizeCoachEvents.js";
import type {
  CoachBriefConfidence,
  CoachEvent,
  EcosystemDailySummary,
  EcosystemProfile,
  EcosystemWeeklyReview,
  WeeklyTargetAdjustment,
} from "../types.js";

type HabitScore = {
  label: string;
  ratio: number;
};

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deriveWeeklyTargetAdjustment(
  profile: EcosystemProfile | null,
  summaries: EcosystemDailySummary[],
  events: CoachEvent[]
): WeeklyTargetAdjustment {
  const followThrough = summarizeCoachEvents(events);
  const calorieTarget = Number(profile?.calorieTarget ?? 0);
  const proteinTarget = Number(profile?.proteinTarget ?? 0);
  const loggedNutritionDays = summaries.filter((summary) => Number(summary.mealsLogged ?? 0) > 0);
  const loggedCalories = loggedNutritionDays
    .map((summary) => Number(summary.caloriesLogged ?? 0))
    .filter((value) => value > 0);
  const loggedProtein = loggedNutritionDays
    .map((summary) => Number(summary.proteinLogged ?? 0))
    .filter((value) => value > 0);
  const recoveryDays = summaries.filter((summary) => {
    const sleepHours = Number(summary.sleepHours ?? 0);
    const hydrationMl = Number(summary.hydrationMl ?? 0);
    return sleepHours >= 7 || hydrationMl >= 2200;
  }).length;
  const scanDays = summaries.filter((summary) => Boolean(summary.faceScanDone) || Boolean(summary.bodyScanDone)).length;
  const avgCalories = average(loggedCalories);
  const avgProtein = average(loggedProtein);

  const confidence: CoachBriefConfidence =
    loggedNutritionDays.length >= 5 && recoveryDays >= 3 && followThrough.adherence === "strong"
      ? "high"
      : loggedNutritionDays.length >= 3 && (recoveryDays >= 1 || scanDays >= 1 || followThrough.adherence === "mixed")
        ? "medium"
        : "low";

  if (!calorieTarget || !proteinTarget) {
    return {
      confidence: "low",
      calorieChange: 0,
      proteinChange: 0,
      shouldAdjust: false,
      reason: "Weekly targets cannot adapt until calorie and protein targets are synced from FitMacro.",
      nextCheckInDays: 7,
    };
  }

  if (confidence === "low") {
    return {
      confidence,
      calorieChange: 0,
      proteinChange: 0,
      shouldAdjust: false,
      reason: "Keep targets stable this week; the coach needs more logged meals, recovery data, and follow-through before changing goals.",
      nextCheckInDays: 7,
    };
  }

  if (followThrough.adherence === "low") {
    return {
      confidence,
      calorieChange: 0,
      proteinChange: 0,
      shouldAdjust: false,
      reason: "Targets are not the bottleneck yet. Complete more suggested actions before changing calories.",
      nextCheckInDays: 7,
    };
  }

  if (profile?.goal === "muscle_gain" && avgProtein !== null && avgProtein < proteinTarget * 0.85) {
    return {
      confidence,
      calorieChange: 0,
      proteinChange: 10,
      shouldAdjust: true,
      reason: "Protein averaged below target on logged days, so raise the protein target before increasing calories.",
      nextCheckInDays: 7,
    };
  }

  if (profile?.goal === "fat_loss" && avgCalories !== null && avgCalories > calorieTarget * 1.08) {
    return {
      confidence,
      calorieChange: 0,
      proteinChange: 0,
      shouldAdjust: false,
      reason: "Logged calories averaged above target; improve adherence before lowering the calorie target.",
      nextCheckInDays: 7,
    };
  }

  if (profile?.goal === "fat_loss" && confidence === "high" && recoveryDays >= 4) {
    return {
      confidence,
      calorieChange: -100,
      proteinChange: 0,
      shouldAdjust: true,
      reason: "Recovery and follow-through are strong enough for a small weekly deficit push.",
      nextCheckInDays: 7,
    };
  }

  if (profile?.goal === "muscle_gain" && confidence === "high" && avgCalories !== null && avgCalories >= calorieTarget * 0.95) {
    return {
      confidence,
      calorieChange: 100,
      proteinChange: 0,
      shouldAdjust: true,
      reason: "Logging and recovery are stable, so a small lean-gain calorie increase is reasonable.",
      nextCheckInDays: 7,
    };
  }

  return {
    confidence,
    calorieChange: 0,
    proteinChange: 0,
    shouldAdjust: false,
    reason: "Current weekly targets look appropriate; keep collecting data before changing goals.",
    nextCheckInDays: 7,
  };
}

export function deriveWeeklyReview(
  profile: EcosystemProfile | null,
  summaries: EcosystemDailySummary[],
  events: CoachEvent[] = []
): EcosystemWeeklyReview | null {
  if (!summaries.length) return null;

  const proteinTarget = Number(profile?.proteinTarget ?? 0);

  const nutritionDays = summaries.filter((summary) => {
    const proteinLogged = Number(summary.proteinLogged ?? 0);
    const mealsLogged = Number(summary.mealsLogged ?? 0);
    if (proteinTarget > 0) {
      return proteinLogged >= proteinTarget * 0.85;
    }
    return mealsLogged >= 3;
  }).length;

  const movementDays = summaries.filter((summary) => {
    const workoutMinutes = Number(summary.workoutMinutes ?? 0);
    const steps = Number(summary.steps ?? 0);
    return workoutMinutes >= 20 || steps >= 7000;
  }).length;

  const recoveryDays = summaries.filter((summary) => {
    const sleepHours = Number(summary.sleepHours ?? 0);
    const hydrationMl = Number(summary.hydrationMl ?? 0);
    return sleepHours >= 7 || hydrationMl >= 2200;
  }).length;

  const scanDays = summaries.filter(
    (summary) => Boolean(summary.faceScanDone) || Boolean(summary.bodyScanDone)
  ).length;

  const habitScores: HabitScore[] = [
    { label: "Nutrition adherence held up best this week.", ratio: nutritionDays / summaries.length },
    { label: "Movement consistency was your strongest habit this week.", ratio: movementDays / summaries.length },
    { label: "Recovery basics were the most stable habit this week.", ratio: recoveryDays / summaries.length },
    { label: "Visual tracking cadence stayed active this week.", ratio: scanDays / summaries.length },
  ];

  const sortedScores = [...habitScores].sort((left, right) => right.ratio - left.ratio);
  const bestHabit = sortedScores[0]?.label ?? "No habit pattern is clear yet.";
  const weakestHabitScore = sortedScores[sortedScores.length - 1];

  const weakestHabit =
    weakestHabitScore?.ratio === habitScores[3]?.ratio
      ? "Scan cadence was weakest. Keep face or body tracking active."
      : weakestHabitScore?.ratio === habitScores[2]?.ratio
        ? "Recovery consistency slipped this week."
        : weakestHabitScore?.ratio === habitScores[1]?.ratio
          ? "Movement consistency was the weakest habit this week."
          : "Nutrition adherence was the weakest habit this week.";

  const decisionScores = summaries
    .map((summary) => deriveCoachDecision(profile, summary).consistencyScore)
    .filter((value): value is number => typeof value === "number");
  const averageConsistency = average(decisionScores);

  const weeklyMomentum =
    averageConsistency === null
      ? "steady"
      : averageConsistency >= 75
        ? "building"
        : averageConsistency >= 55
          ? "steady"
          : "slipping";

  const nextWeekFocus =
    weakestHabitScore?.ratio === habitScores[0]?.ratio
      ? "Tighten protein and meal completion earlier in the day."
      : weakestHabitScore?.ratio === habitScores[1]?.ratio
        ? "Add one short daily walk or training block to keep circulation high."
        : weakestHabitScore?.ratio === habitScores[2]?.ratio
          ? "Protect sleep and hydration before chasing harder training."
          : "Refresh face or body scans on schedule so the coach can track visible change.";

  return {
    bestHabit,
    weakestHabit,
    weeklyMomentum,
    nextWeekFocus,
    targetAdjustment: deriveWeeklyTargetAdjustment(profile, summaries, events),
  };
}
