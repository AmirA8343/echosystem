import type { EcosystemDailySummary, EcosystemProfile, Nudge } from "../types.js";

export function deriveNudges(
  profile: EcosystemProfile | null,
  today: EcosystemDailySummary | null
): Nudge[] {
  if (!profile || !today) return [];

  const nudges: Nudge[] = [];
  const proteinTarget = Number(profile.proteinTarget ?? 0);
  const proteinLogged = Number(today.proteinLogged ?? 0);
  const workoutMinutes = Number(today.workoutMinutes ?? 0);
  const caloriesLogged = Number(today.caloriesLogged ?? 0);
  const calorieTarget = Number(profile.calorieTarget ?? 0);
  const sodiumMg = Number(today.sodiumMg ?? 0);

  if (workoutMinutes > 0 && proteinTarget > 0 && proteinLogged < proteinTarget) {
    nudges.push({
      type: "protein_gap",
      message: `You trained today and still have ${Math.max(0, Math.round(proteinTarget - proteinLogged))}g protein left.`,
    });
  }

  if (profile.goal === "fat_loss" && calorieTarget > 0 && caloriesLogged > calorieTarget) {
    nudges.push({
      type: "calorie_over",
      message: `You are ${Math.round(caloriesLogged - calorieTarget)} kcal over target today.`,
    });
  }

  if ((today.steps ?? 0) < 6000 && workoutMinutes <= 0) {
    nudges.push({
      type: "movement_low",
      message: "Activity is light today. A short walk or session would help consistency.",
    });
  }

  if (sodiumMg > 2300) {
    nudges.push({
      type: "sodium_high",
      message: `Sodium is high today at ${Math.round(sodiumMg)} mg. Keep hydration steady to reduce water retention.`,
    });
  }

  return nudges;
}
