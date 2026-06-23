import type { CoachPushNudge } from "../types.js";

type SourceApp = "fitmacro" | "fitface";

const numberOrZero = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const destinationFor = (sourceApp: SourceApp) =>
  sourceApp === "fitmacro" ? "coach_hub" : "daily_tracking";

export function buildDailyMorningReview(input: {
  sourceApp: SourceApp;
  profile: Record<string, unknown> | null;
  today: Record<string, unknown> | null;
  yesterday: Record<string, unknown> | null;
}): CoachPushNudge {
  const destinationKey = destinationFor(input.sourceApp);
  const summary = input.yesterday;

  if (!summary) {
    return {
      type: "daily_morning_review",
      title: "Today's coach plan",
      body: "Yesterday did not have enough synced data for a full review. Start today with water, a protein-rich meal, and one planned movement block.",
      recommendedApp: input.sourceApp,
      destinationKey,
    };
  }

  const sleepHours =
    numberOrZero(input.today?.sleep_hours) || numberOrZero(summary.sleep_hours);
  const hydrationMl = numberOrZero(summary.hydration_ml);
  const steps = numberOrZero(summary.steps);
  const caloriesLogged = numberOrZero(summary.calories_logged);
  const proteinLogged = numberOrZero(summary.protein_logged);
  const mealsLogged = numberOrZero(summary.meals_logged);
  const workoutMinutes = numberOrZero(summary.workout_minutes);
  const calorieTarget = numberOrZero(input.profile?.calorie_target);
  const proteinTarget = numberOrZero(input.profile?.protein_target);

  const facts: string[] = [];
  if (input.sourceApp === "fitmacro") {
    if (proteinLogged > 0) facts.push(`${Math.round(proteinLogged)}g protein`);
    if (caloriesLogged > 0) facts.push(`${Math.round(caloriesLogged)} kcal logged`);
    if (hydrationMl > 0) facts.push(`${Math.round(hydrationMl)} ml hydration`);
  } else {
    if (steps > 0) facts.push(`${Math.round(steps)} steps`);
    if (hydrationMl > 0) facts.push(`${Math.round(hydrationMl)} ml hydration`);
    if (workoutMinutes > 0) facts.push(`${Math.round(workoutMinutes)} active minutes`);
  }

  const sleepPrefix = sleepHours > 0 ? `Last night: ${sleepHours.toFixed(1)}h sleep. ` : "";
  const dayPrefix = facts.length > 0 ? `Yesterday: ${facts.slice(0, 2).join(", ")}. ` : "";
  let action: string;

  if (sleepHours > 0 && sleepHours < 6.5) {
    action = "Make today recovery-first: hydrate early, keep meals regular, and choose lighter training.";
  } else if (hydrationMl > 0 && hydrationMl < 1400) {
    action = "Start with water and spread hydration through the day instead of trying to catch up tonight.";
  } else if (
    input.sourceApp === "fitmacro" &&
    proteinTarget > 0 &&
    proteinLogged > 0 &&
    proteinLogged < proteinTarget * 0.75
  ) {
    action = "Put a clear protein source in breakfast and lunch so the evening does not carry the full target.";
  } else if (steps > 0 && steps < 7000 && workoutMinutes < 20) {
    action = "Schedule a short walk or movement session early so activity is not left until late evening.";
  } else if (
    input.sourceApp === "fitmacro" &&
    calorieTarget > 0 &&
    mealsLogged >= 2 &&
    caloriesLogged > 0 &&
    caloriesLogged < calorieTarget * 0.7
  ) {
    action = "Keep meals regular and complete today's logging so the coach can judge intake more accurately.";
  } else if (facts.length === 0 && sleepHours <= 0) {
    action = "Add sleep, meals, hydration, or movement today so tomorrow's coaching can use a complete picture.";
  } else {
    action = "Keep the strongest parts consistent today and complete one planned meal, hydration, or movement action early.";
  }

  return {
    type: "daily_morning_review",
    title: "Your plan for today",
    body: `${sleepPrefix}${dayPrefix}${action}`,
    recommendedApp: input.sourceApp,
    destinationKey,
  };
}
