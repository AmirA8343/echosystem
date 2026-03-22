import type {
  CoachPrimaryAction,
  EcosystemDailySummary,
  EcosystemProfile,
} from "../types.js";

type CoachDecision = {
  primaryAction: CoachPrimaryAction | null;
  winsToday: string[];
  missingToday: string[];
  consistencyScore: number | null;
  antiAgingFocus: string | null;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export function deriveCoachDecision(
  profile: EcosystemProfile | null,
  today: EcosystemDailySummary | null
): CoachDecision {
  if (!today) {
    return {
      primaryAction: null,
      winsToday: [],
      missingToday: [],
      consistencyScore: null,
      antiAgingFocus: null,
    };
  }

  const proteinTarget = Number(profile?.proteinTarget ?? 0);
  const calorieTarget = Number(profile?.calorieTarget ?? 0);
  const proteinLogged = Number(today.proteinLogged ?? 0);
  const caloriesLogged = Number(today.caloriesLogged ?? 0);
  const mealsLogged = Number(today.mealsLogged ?? 0);
  const workoutMinutes = Number(today.workoutMinutes ?? 0);
  const steps = Number(today.steps ?? 0);
  const sleepHours = Number(today.sleepHours ?? 0);
  const hydrationMl = Number(today.hydrationMl ?? 0);
  const sodiumMg = Number(today.sodiumMg ?? 0);
  const faceScanDone = Boolean(today.faceScanDone);
  const bodyScanDone = Boolean(today.bodyScanDone);
  const primaryFocus = profile?.primaryFocus ?? null;

  const winsToday: string[] = [];
  const missingToday: string[] = [];

  if (proteinTarget > 0 && proteinLogged >= proteinTarget) {
    winsToday.push(`Protein target reached at ${Math.round(proteinLogged)}g.`);
  } else if (proteinTarget > 0 && proteinLogged < proteinTarget) {
    missingToday.push(`Protein is short by ${Math.max(0, Math.round(proteinTarget - proteinLogged))}g.`);
  }

  if (calorieTarget > 0 && caloriesLogged > 0) {
    const calorieDiff = Math.abs(caloriesLogged - calorieTarget);
    if (calorieDiff <= Math.max(150, calorieTarget * 0.08)) {
      winsToday.push(`Calories are on track at ${Math.round(caloriesLogged)} kcal.`);
    } else {
      missingToday.push(
        caloriesLogged > calorieTarget
          ? `Calories are ${Math.round(caloriesLogged - calorieTarget)} kcal over target.`
          : `Calories are ${Math.round(calorieTarget - caloriesLogged)} kcal under target.`
      );
    }
  }

  if (mealsLogged >= 3) {
    winsToday.push(`${mealsLogged} meals logged today.`);
  } else if (mealsLogged > 0) {
    missingToday.push(`Only ${mealsLogged} meal${mealsLogged === 1 ? "" : "s"} logged so far.`);
  } else {
    missingToday.push("No meals logged yet.");
  }

  if (workoutMinutes >= 30) {
    winsToday.push(`${workoutMinutes} workout minutes completed.`);
  } else if (workoutMinutes > 0) {
    missingToday.push(`Only ${workoutMinutes} workout minutes logged.`);
  }

  if (steps >= 8000) {
    winsToday.push(`${steps.toLocaleString()} steps supports circulation and recovery.`);
  } else {
    missingToday.push(`Steps are low at ${steps.toLocaleString()}.`);
  }

  if (sleepHours >= 7) {
    winsToday.push(`${sleepHours.toFixed(1)}h sleep supports recovery.`);
  } else if (sleepHours > 0) {
    missingToday.push(`Sleep is low at ${sleepHours.toFixed(1)}h.`);
  }

  if (hydrationMl >= 2500) {
    winsToday.push(`Hydration is strong at ${hydrationMl.toLocaleString()} ml.`);
  } else if (hydrationMl > 0) {
    missingToday.push(`Hydration is behind at ${hydrationMl.toLocaleString()} ml.`);
  }

  if (sodiumMg > 2300) {
    missingToday.push(`Sodium is elevated at ${Math.round(sodiumMg)} mg.`);
  }

  if (faceScanDone || bodyScanDone) {
    winsToday.push(
      `${faceScanDone && bodyScanDone ? "Face and body scans" : faceScanDone ? "Face scan" : "Body scan"} completed.`
    );
  } else {
    missingToday.push("No FitFace scan completed yet.");
  }

  const scoreParts: number[] = [];
  if (proteinTarget > 0) {
    scoreParts.push(clamp((proteinLogged / proteinTarget) * 100, 0, 100));
  }
  if (calorieTarget > 0 && caloriesLogged > 0) {
    const calorieScore = 100 - clamp((Math.abs(caloriesLogged - calorieTarget) / calorieTarget) * 150, 0, 100);
    scoreParts.push(calorieScore);
  }
  scoreParts.push(clamp(Math.max(workoutMinutes / 45, steps / 8000) * 100, 0, 100));
  if (sleepHours > 0) scoreParts.push(clamp((sleepHours / 8) * 100, 0, 100));
  if (hydrationMl > 0) scoreParts.push(clamp((hydrationMl / 2500) * 100, 0, 100));
  scoreParts.push(faceScanDone || bodyScanDone ? 100 : 0);

  const consistencyScore = scoreParts.length
    ? Math.round(scoreParts.reduce((sum, value) => sum + value, 0) / scoreParts.length)
    : null;

  let antiAgingFocus: string | null = null;
  if (primaryFocus === "looks" && !faceScanDone && !bodyScanDone) {
    antiAgingFocus = "Visible progress tracking and routine precision";
  } else if (sleepHours > 0 && sleepHours < 7) antiAgingFocus = "Sleep depth and recovery rhythm";
  else if (hydrationMl > 0 && hydrationMl < 2000) antiAgingFocus = "Hydration and water retention control";
  else if (proteinTarget > 0 && proteinLogged < proteinTarget) antiAgingFocus = "Protein support for body composition and skin";
  else if (primaryFocus === "longevity") antiAgingFocus = "Recovery rhythm and low-stress consistency";
  else if (workoutMinutes < 20 && steps < 6000) antiAgingFocus = "Daily movement and circulation";
  else antiAgingFocus = "Consistency across nutrition, recovery, and movement";

  let primaryAction: CoachPrimaryAction | null = null;
  if (proteinTarget > 0 && proteinLogged < proteinTarget * 0.8) {
    primaryAction = {
      title: "Close your protein gap",
      detail: `Open FitMacro and add ${Math.max(0, Math.round(proteinTarget - proteinLogged))}g protein to support recovery and lean-body goals.`,
      recommendedApp: "fitmacro",
      ctaLabel: "Open FitMacro",
      routeHint: "nutrition",
      destinationKey: "meal_plan",
      destinationLabel: "Meal Plan",
    };
  } else if (mealsLogged < 2) {
    primaryAction = {
      title: "Log your next meal",
      detail: "Open FitMacro and finish nutrition logging before the day slips off target.",
      recommendedApp: "fitmacro",
      ctaLabel: "Open FitMacro",
      routeHint: "nutrition",
      destinationKey: "meal_history",
      destinationLabel: "Meal History",
    };
  } else if (primaryFocus === "looks" && !faceScanDone && !bodyScanDone) {
    primaryAction = {
      title: "Refresh your visual baseline",
      detail: "Open FitFace AI and run a face or body scan so appearance-focused coaching stays current.",
      recommendedApp: "fitface",
      ctaLabel: "Open FitFace AI",
      routeHint: "scan",
      destinationKey: "ai_health_coach",
      destinationLabel: "AI Health Coach",
    };
  } else if (sleepHours > 0 && sleepHours < 7) {
    primaryAction = {
      title: "Recover harder tonight",
      detail: `Open FitFace AI and prioritize sleep recovery after only ${sleepHours.toFixed(1)} hours.`,
      recommendedApp: "fitface",
      ctaLabel: "Open FitFace AI",
      routeHint: "recovery",
      destinationKey: "daily_tracking",
      destinationLabel: "Daily Tracking",
    };
  } else if (hydrationMl > 0 && hydrationMl < 2000) {
    primaryAction = {
      title: "Finish hydration and movement",
      detail: "Open FitFace AI and finish hydration plus a short walk to reduce fatigue and puffiness.",
      recommendedApp: "fitface",
      ctaLabel: "Open FitFace AI",
      routeHint: "recovery",
      destinationKey: "daily_tracking",
      destinationLabel: "Daily Tracking",
    };
  } else if (workoutMinutes < 20 && steps < 6000) {
    primaryAction = {
      title: "Get movement on the board",
      detail: "Open FitFace AI and complete today’s session or a short walk block.",
      recommendedApp: "fitface",
      ctaLabel: "Open FitFace AI",
      routeHint: "training",
      destinationKey: "body_workout",
      destinationLabel: "Body Workout",
    };
  } else if (!faceScanDone && !bodyScanDone) {
    primaryAction = {
      title: "Refresh your visual baseline",
      detail: "Open FitFace AI and run a face or body scan to keep progress tracking honest.",
      recommendedApp: "fitface",
      ctaLabel: "Open FitFace AI",
      routeHint: "scan",
      destinationKey: "ai_health_coach",
      destinationLabel: "AI Health Coach",
    };
  } else {
    primaryAction = {
      title: "Keep the ecosystem streak alive",
      detail: "Both apps are aligned today. Check in once more tonight and keep consistency high.",
      recommendedApp: "either",
      ctaLabel: "Stay Consistent",
      routeHint: "consistency",
      destinationKey: "home",
      destinationLabel: "Home",
    };
  }

  return {
    primaryAction,
    winsToday: winsToday.slice(0, 3),
    missingToday: missingToday.slice(0, 3),
    consistencyScore,
    antiAgingFocus,
  };
}
