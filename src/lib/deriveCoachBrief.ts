import type {
  CoachBrief,
  CoachBriefAdjustment,
  CoachBriefConfidence,
  CoachFollowThroughSummary,
  CoachBriefMacroTargets,
  CoachBriefRecoveryState,
  CoachBriefSuggestion,
  CoachEvent,
  EcosystemDailySummary,
  EcosystemProfile,
} from "../types.js";
import { summarizeCoachEvents } from "./summarizeCoachEvents.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundToNearest(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest;
}

function deriveConfidence(profile: EcosystemProfile | null, summaries: EcosystemDailySummary[]): CoachBriefConfidence {
  const nutritionDays = summaries.filter((summary) => Number(summary.mealsLogged ?? 0) > 0).length;
  const recoveryDays = summaries.filter((summary) => {
    return Number(summary.sleepHours ?? 0) > 0 || Number(summary.hydrationMl ?? 0) > 0;
  }).length;
  const scanDays = summaries.filter((summary) => Boolean(summary.faceScanDone) || Boolean(summary.bodyScanDone)).length;
  const hasTargets = Boolean(profile?.calorieTarget || profile?.proteinTarget);

  if (hasTargets && nutritionDays >= 5 && recoveryDays >= 3) return "high";
  if (hasTargets && nutritionDays >= 2 && (recoveryDays >= 1 || scanDays >= 1)) return "medium";
  return "low";
}

function strengthenConfidence(
  confidence: CoachBriefConfidence,
  followThrough: CoachFollowThroughSummary
): CoachBriefConfidence {
  if (confidence === "low" && (followThrough.mealsLogged >= 3 || followThrough.scansCompleted >= 1)) return "medium";
  if (confidence === "medium" && followThrough.mealsLogged >= 6 && followThrough.scansCompleted >= 1) return "high";
  return confidence;
}

function deriveRecoveryState(today: EcosystemDailySummary | null): CoachBriefRecoveryState {
  if (!today) return "unknown";

  const sleepHours = Number(today.sleepHours ?? 0);
  const hydrationMl = Number(today.hydrationMl ?? 0);
  const sodiumMg = Number(today.sodiumMg ?? 0);
  const faceScore = Number(today.faceOverallScore ?? 0);
  const bodyPosture = Number(today.bodyPostureScore ?? 0);

  if (sleepHours > 0 && sleepHours < 6) return "low_sleep";
  if ((faceScore > 0 && faceScore < 65) || (bodyPosture > 0 && bodyPosture < 60)) return "under_recovered";
  if (hydrationMl > 0 && hydrationMl < 1800) return "hydration_low";
  if (sodiumMg > 2300) return "sodium_high";
  if (sleepHours >= 7 || hydrationMl >= 2200 || Number(today.steps ?? 0) >= 7000) return "ready";
  return "unknown";
}

function deriveTargetMacros(profile: EcosystemProfile | null, calorieAdjustment: number): CoachBriefMacroTargets {
  const baseCalories = finiteNumber(profile?.calorieTarget) ?? null;
  const baseProtein = finiteNumber(profile?.proteinTarget) ?? null;
  const calories = baseCalories ? Math.max(1200, roundToNearest(baseCalories + calorieAdjustment, 25)) : null;
  const protein = baseProtein ? Math.max(50, Math.round(baseProtein)) : null;

  if (!calories || !protein) {
    return { calories, protein, carbs: null, fat: null };
  }

  const fat = Math.round(clamp(calories * 0.28 / 9, 45, 100));
  const proteinCalories = protein * 4;
  const fatCalories = fat * 9;
  const carbs = Math.max(60, Math.round((calories - proteinCalories - fatCalories) / 4));

  return { calories, protein, carbs, fat };
}

function deriveAdjustment(
  profile: EcosystemProfile | null,
  summaries: EcosystemDailySummary[],
  today: EcosystemDailySummary | null,
  recoveryState: CoachBriefRecoveryState,
  confidence: CoachBriefConfidence,
  followThrough: CoachFollowThroughSummary
): CoachBriefAdjustment {
  const calorieTarget = Number(profile?.calorieTarget ?? 0);
  const proteinTarget = Number(profile?.proteinTarget ?? 0);
  const recentCalories = summaries
    .map((summary) => Number(summary.caloriesLogged ?? 0))
    .filter((value) => value > 0);
  const recentProtein = summaries
    .map((summary) => Number(summary.proteinLogged ?? 0))
    .filter((value) => value > 0);
  const avgCalories = average(recentCalories);
  const avgProtein = average(recentProtein);
  const sleepHours = Number(today?.sleepHours ?? 0);

  if (!calorieTarget && !proteinTarget) {
    return {
      calorieChange: 0,
      proteinChange: 0,
      reason: "Targets are missing, so the coach is staying conservative.",
      shouldChangeGoal: false,
    };
  }

  if (recoveryState === "low_sleep") {
    return {
      calorieChange: profile?.goal === "fat_loss" ? 100 : 0,
      proteinChange: 0,
      reason: `Sleep is low${sleepHours > 0 ? ` at ${sleepHours.toFixed(1)}h` : ""}; avoid pushing the deficit harder today.`,
      shouldChangeGoal: false,
    };
  }

  if (confidence === "low") {
    return {
      calorieChange: 0,
      proteinChange: 0,
      reason: "Not enough synced history yet to safely adjust calories.",
      shouldChangeGoal: false,
    };
  }

  if (followThrough.adherence === "low" && followThrough.viewedBriefs > 0) {
    return {
      calorieChange: 0,
      proteinChange: 0,
      reason: "Follow-through is still low, so the coach is keeping targets stable and focusing on one completed action first.",
      shouldChangeGoal: false,
    };
  }

  if (profile?.goal === "fat_loss" && avgCalories && calorieTarget > 0 && avgCalories > calorieTarget * 1.08) {
    return {
      calorieChange: 0,
      proteinChange: 0,
      reason: "Recent intake is already above target, so execution matters more than lowering calories.",
      shouldChangeGoal: false,
    };
  }

  if (profile?.goal === "muscle_gain" && avgProtein && proteinTarget > 0 && avgProtein < proteinTarget * 0.85) {
    return {
      calorieChange: 0,
      proteinChange: 10,
      reason: "Protein has been under target; improve protein before adding more calories.",
      shouldChangeGoal: false,
    };
  }

  if (profile?.goal === "fat_loss" && confidence === "high" && recoveryState === "ready") {
    return {
      calorieChange: -100,
      proteinChange: 0,
      reason: "Recovery looks stable and logging confidence is high, so a small deficit push is reasonable.",
      shouldChangeGoal: false,
    };
  }

  return {
    calorieChange: 0,
    proteinChange: 0,
    reason: "Current targets look reasonable for today.",
    shouldChangeGoal: false,
  };
}

function deriveFoodSuggestion(
  profile: EcosystemProfile | null,
  today: EcosystemDailySummary | null,
  targets: CoachBriefMacroTargets,
  recoveryState: CoachBriefRecoveryState
): CoachBriefSuggestion {
  const proteinLeft =
    targets.protein && today?.proteinLogged !== null && today?.proteinLogged !== undefined
      ? Math.max(0, Math.round(targets.protein - Number(today.proteinLogged)))
      : null;

  if (recoveryState === "low_sleep") {
    return {
      title: "Recovery meal, not a crash diet",
      detail: "Choose a protein-forward meal with slow carbs: eggs or Greek yogurt with oats and fruit, or chicken/rice/vegetables.",
      reason: "Low sleep raises hunger and lowers training readiness, so today needs steady fuel and high protein.",
    };
  }

  if (recoveryState === "sodium_high") {
    return {
      title: "Lower-sodium reset",
      detail: "Keep the next meal simple: lean protein, potatoes or rice, fruit, and water. Avoid salty sauces and late packaged food.",
      reason: "Higher sodium can mask progress through water retention and puffiness.",
    };
  }

  if (proteinLeft !== null && proteinLeft >= 35) {
    return {
      title: "Close the protein gap",
      detail: `Add about ${proteinLeft}g protein today using lean meat, fish, eggs, Greek yogurt, tofu, or a whey shake.`,
      reason: "Protein is the most useful nutrition lever for body composition and recovery.",
    };
  }

  if (profile?.goal === "muscle_gain") {
    return {
      title: "Lean-gain support",
      detail: "Pair protein with carbs around training: rice, oats, potatoes, fruit, or bread with a lean protein source.",
      reason: "Muscle gain needs training fuel and enough protein, not just higher calories.",
    };
  }

  return {
    title: "Stay on-plan",
    detail: "Build the next meal around protein, colorful produce, and one controlled carb or fat source.",
    reason: "A simple balanced meal keeps the day on track without overcorrecting.",
  };
}

function deriveTrainingSuggestion(
  today: EcosystemDailySummary | null,
  recoveryState: CoachBriefRecoveryState
): CoachBriefSuggestion {
  const workoutMinutes = Number(today?.workoutMinutes ?? 0);
  const steps = Number(today?.steps ?? 0);

  if (recoveryState === "low_sleep" || recoveryState === "under_recovered") {
    return {
      title: "Keep training light",
      detail: "Use walking, mobility, or an easy pump session. Avoid max effort work today.",
      reason: "Recovery is limited, so consistency beats intensity.",
    };
  }

  if (workoutMinutes < 20 && steps < 6000) {
    return {
      title: "Move before the day closes",
      detail: "Do a 20-30 minute walk or a short body session.",
      reason: "Low movement weakens calorie control, circulation, and recovery.",
    };
  }

  return {
    title: "Training is available",
    detail: "If energy is normal, complete the planned body session. If not, keep a brisk walk as the minimum.",
    reason: "Your recovery signals do not require backing off today.",
  };
}

function buildEvidence(
  today: EcosystemDailySummary | null,
  targets: CoachBriefMacroTargets,
  confidence: CoachBriefConfidence,
  followThrough: CoachFollowThroughSummary
): string[] {
  if (!today) return ["No daily summary is available yet."];

  const evidence = [
    `Confidence: ${confidence}.`,
    targets.calories ? `Calorie target today: ${targets.calories} kcal.` : "Calorie target is missing.",
    targets.protein ? `Protein target today: ${targets.protein}g.` : "Protein target is missing.",
  ];
  evidence.push(`Follow-through: ${followThrough.adherence}.`);

  const sleepHours = Number(today.sleepHours ?? 0);
  const caloriesLogged = Number(today.caloriesLogged ?? 0);
  const proteinLogged = Number(today.proteinLogged ?? 0);
  const steps = Number(today.steps ?? 0);
  if (sleepHours > 0) evidence.push(`Sleep synced: ${sleepHours.toFixed(1)}h.`);
  if (caloriesLogged > 0) evidence.push(`Calories logged: ${Math.round(caloriesLogged)} kcal.`);
  if (proteinLogged > 0) evidence.push(`Protein logged: ${Math.round(proteinLogged)}g.`);
  if (steps > 0) evidence.push(`Steps synced: ${steps.toLocaleString()}.`);
  if (today.faceScanDone || today.bodyScanDone) evidence.push("Visual scan data is present today.");

  return evidence.slice(0, 7);
}

function buildCoachMessage(
  recoveryState: CoachBriefRecoveryState,
  targets: CoachBriefMacroTargets,
  adjustment: CoachBriefAdjustment,
  foodSuggestion: CoachBriefSuggestion,
  trainingSuggestion: CoachBriefSuggestion,
  followThrough: CoachFollowThroughSummary
): string {
  const targetText =
    targets.calories && targets.protein
      ? `Aim for about ${targets.calories} kcal and ${targets.protein}g protein today.`
      : "Keep today structured around protein, hydration, and honest tracking.";

  if (recoveryState === "low_sleep") {
    return `You slept short, so today is not the day to punish yourself with a harder deficit. ${targetText} ${foodSuggestion.detail} ${trainingSuggestion.detail}`;
  }

  if (recoveryState === "sodium_high") {
    return `Water retention may be hiding progress today. ${targetText} Keep sodium lower in the next meal, hydrate steadily, and avoid judging your body from one salty day.`;
  }

  if (followThrough.adherence === "low" && followThrough.viewedBriefs > 0) {
    return `${targetText} Keep the goal simple today: complete one coach action, preferably logging your next meal or opening the suggested plan. ${foodSuggestion.detail}`;
  }

  return `${targetText} ${adjustment.reason} ${foodSuggestion.detail} ${trainingSuggestion.detail}`;
}

export function deriveCoachBrief(
  ecosystemUserId: string,
  profile: EcosystemProfile | null,
  summaries: EcosystemDailySummary[],
  events: CoachEvent[] = [],
  todayDate?: string
): CoachBrief {
  const today = todayDate
    ? summaries.find((summary) => summary.date === todayDate) ?? null
    : summaries[0] ?? null;
  const followThrough = summarizeCoachEvents(events);
  const confidence = strengthenConfidence(deriveConfidence(profile, summaries), followThrough);
  const recoveryState = deriveRecoveryState(today);
  const adjustment = deriveAdjustment(profile, summaries, today, recoveryState, confidence, followThrough);
  const targets = deriveTargetMacros(profile, adjustment.calorieChange);
  const adjustedTargets = {
    ...targets,
    protein: targets.protein ? targets.protein + adjustment.proteinChange : targets.protein,
  };
  const foodSuggestion = deriveFoodSuggestion(profile, today, adjustedTargets, recoveryState);
  const trainingSuggestion = deriveTrainingSuggestion(today, recoveryState);
  const cautions: string[] = [];

  if (confidence === "low") {
    cautions.push("The coach needs more synced days before making aggressive calorie changes.");
  }
  if (!profile?.calorieTarget || !profile?.proteinTarget) {
    cautions.push("Nutrition targets are incomplete, so recommendations are conservative.");
  }
  if (followThrough.adherence === "low") {
    cautions.push("Recent follow-through is low, so targets should stay stable until the user completes more actions.");
  }

  return {
    ecosystemUserId,
    date: today?.date ?? null,
    generatedAt: new Date().toISOString(),
    confidence,
    recoveryState,
    followThrough,
    todayTargets: adjustedTargets,
    adjustment,
    foodSuggestion,
    trainingSuggestion,
    coachMessage: buildCoachMessage(recoveryState, adjustedTargets, adjustment, foodSuggestion, trainingSuggestion, followThrough),
    evidence: buildEvidence(today, adjustedTargets, confidence, followThrough),
    cautions,
  };
}
