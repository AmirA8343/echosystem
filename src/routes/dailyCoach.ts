import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { personalizeCoachNudge, type PersonalizedCoachNudge } from "../lib/aiCoachNudge.js";
import { buildDailyMorningReview } from "../lib/dailyMorningCoach.js";
import { getLocalDateKey } from "../lib/date.js";
import { deriveMicronutrientCoachSuggestion } from "../lib/micronutrientCoach.js";

const querySchema = z.object({
  ecosystemUserId: z.string().uuid(),
  sourceApp: z.enum(["fitmacro", "fitface"]).default("fitmacro"),
  locale: z.string().trim().min(2).max(16).optional(),
});

type CacheEntry = {
  contextHash: string;
  expiresAt: number;
  personalized: PersonalizedCoachNudge;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

type DailyRescuePlan = {
  status: "on_track" | "tight" | "over_target" | "protein_rescue";
  title: string;
  message: string;
  nextMealCalories: number;
  nextMealProtein: number;
  movementMinutes: number;
  remainingCalories: number;
  remainingProtein: number;
  activeEnergyKcal: number | null;
  tomorrowNote: string;
} | null;

const positiveNumberOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const stringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const firstNumberOrNull = (
  primary: Record<string, unknown> | null,
  secondary: Record<string, unknown> | null,
  key: string
): number | null => positiveNumberOrNull(primary?.[key]) ?? positiveNumberOrNull(secondary?.[key]);

const firstStringOrNull = (
  primary: Record<string, unknown> | null,
  secondary: Record<string, unknown> | null,
  key: string
): string | null => stringOrNull(primary?.[key]) ?? stringOrNull(secondary?.[key]);

const firstBooleanOrNull = (
  primary: Record<string, unknown> | null,
  secondary: Record<string, unknown> | null,
  key: string
): boolean | null => {
  const value = primary?.[key] ?? secondary?.[key];
  return typeof value === "boolean" ? value : null;
};

const buildDailyRescuePlan = (
  profile: Record<string, unknown> | null,
  summary: Record<string, unknown> | null
): DailyRescuePlan => {
  if (!summary) return null;

  const calorieTarget = positiveNumberOrNull(profile?.calorie_target);
  const proteinTarget = positiveNumberOrNull(profile?.protein_target);
  const caloriesLogged = positiveNumberOrNull(summary.calories_logged) ?? 0;
  const proteinLogged = positiveNumberOrNull(summary.protein_logged) ?? 0;
  const activeEnergyKcal = positiveNumberOrNull(summary.active_energy_kcal);
  if (!calorieTarget && !proteinTarget) return null;
  if (caloriesLogged <= 0 && proteinLogged <= 0) return null;

  const movementCredit = activeEnergyKcal ? Math.min(activeEnergyKcal, 300) : 0;
  const effectiveCalorieTarget = (calorieTarget ?? 0) + movementCredit;
  const remainingCalories =
    calorieTarget !== null ? Math.round(effectiveCalorieTarget - caloriesLogged) : 0;
  const remainingProtein =
    proteinTarget !== null ? Math.round(proteinTarget - proteinLogged) : 0;
  const proteinRescueNeeded = proteinTarget !== null && remainingProtein >= 25;
  const isOverTarget = calorieTarget !== null && remainingCalories < -100;
  const isTight = calorieTarget !== null && remainingCalories >= -100 && remainingCalories < 350;

  if (!isOverTarget && !isTight && !proteinRescueNeeded) return null;

  const nextMealProtein = Math.max(25, Math.min(45, Math.max(remainingProtein, 25)));
  const nextMealCalories = isOverTarget
    ? 350
    : isTight
      ? Math.max(300, Math.min(450, remainingCalories + 100))
      : Math.max(350, Math.min(600, Math.round(Math.max(remainingCalories, 450) * 0.45)));
  const movementMinutes = isOverTarget ? 20 : isTight ? 15 : 10;
  const tomorrowNote =
    "Tomorrow returns to the normal target. Do not punish today with a crash diet.";

  if (isOverTarget) {
    return {
      status: "over_target",
      title: "Rescue the day, do not restart it",
      message: `You are about ${Math.abs(remainingCalories)} kcal over the adjusted target. Keep the next meal calm: lean protein, vegetables or fruit, water, and no extra snacking.`,
      nextMealCalories,
      nextMealProtein,
      movementMinutes,
      remainingCalories,
      remainingProtein: Math.max(0, remainingProtein),
      activeEnergyKcal,
      tomorrowNote,
    };
  }

  if (isTight) {
    return {
      status: "tight",
      title: "Keep the landing clean",
      message: "Calories are tight, but the day is still controllable. Use one simple protein-forward meal and a short walk instead of skipping food.",
      nextMealCalories,
      nextMealProtein,
      movementMinutes,
      remainingCalories,
      remainingProtein: Math.max(0, remainingProtein),
      activeEnergyKcal,
      tomorrowNote,
    };
  }

  return {
    status: "protein_rescue",
    title: "Protein can still save the day",
    message: `You still need about ${Math.max(0, remainingProtein)}g protein. Make the next meal protein-first, with calories controlled around appetite.`,
    nextMealCalories,
    nextMealProtein,
    movementMinutes,
    remainingCalories,
    remainingProtein: Math.max(0, remainingProtein),
    activeEnergyKcal,
    tomorrowNote,
  };
};

export async function registerDailyCoachRoutes(app: FastifyInstance) {
  app.get("/v1/ecosystem/daily-coach", async (request, reply) => {
    const query = querySchema.parse(request.query ?? {});
    const [userResult, profileResult] = await Promise.all([
      pool.query(
        `select ecosystem_user_id from ecosystem_users where ecosystem_user_id = $1 limit 1`,
        [query.ecosystemUserId]
      ),
      pool.query(
        `select * from ecosystem_profiles where ecosystem_user_id = $1 limit 1`,
        [query.ecosystemUserId]
      ),
    ]);

    if (!userResult.rows[0]) {
      return reply.code(404).send({ error: "User not found." });
    }

    const profile = (profileResult.rows[0] as Record<string, unknown> | undefined) ?? null;
    const timezone = String(profile?.timezone ?? "America/Toronto");
    const todayDate = getLocalDateKey(timezone);
    const yesterdayDate = getLocalDateKey(
      timezone,
      new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    const [todayResult, yesterdayResult, recentResult] = await Promise.all([
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1 and date = $2::date limit 1`,
        [query.ecosystemUserId, todayDate]
      ),
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1 and date = $2::date limit 1`,
        [query.ecosystemUserId, yesterdayDate]
      ),
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1 order by date desc limit 7`,
        [query.ecosystemUserId]
      ),
    ]);

    const today = (todayResult.rows[0] as Record<string, unknown> | undefined) ?? null;
    const yesterday =
      (yesterdayResult.rows[0] as Record<string, unknown> | undefined) ?? null;
    const recentSummaries = recentResult.rows as Record<string, unknown>[];
    const micronutrientSuggestion = deriveMicronutrientCoachSuggestion({
      ecosystemUserId: query.ecosystemUserId,
      profile,
      summaries: recentSummaries,
    });
    const fallback = buildDailyMorningReview({
      sourceApp: query.sourceApp,
      profile,
      today,
      yesterday,
    });
    const locale = query.locale ?? "en";
    const contextHash = createHash("sha256")
      .update(
        JSON.stringify({
          profile,
          today,
          yesterday,
          fallback,
          locale,
          micronutrientSuggestion,
        })
      )
      .digest("hex");
    const cacheKey = `${query.ecosystemUserId}:${query.sourceApp}:${locale}`;
    const cached = cache.get(cacheKey);
    let personalized: PersonalizedCoachNudge;
    let cacheHit = false;

    if (cached && cached.contextHash === contextHash && cached.expiresAt > Date.now()) {
      personalized = cached.personalized;
      cacheHit = true;
    } else {
      personalized = await personalizeCoachNudge({
        fallback,
        sourceApp: query.sourceApp,
        locale,
        profile,
        today,
        yesterday,
        recentSummaries,
        micronutrientSuggestion,
      });
      if (personalized.personalizedByAi) {
        if (cache.size >= 500) cache.clear();
        cache.set(cacheKey, {
          contextHash,
          expiresAt: Date.now() + CACHE_TTL_MS,
          personalized,
        });
      } else {
        cache.delete(cacheKey);
      }
    }

    const sleepHours = firstNumberOrNull(today, yesterday, "sleep_hours");
    const caloriesLogged = firstNumberOrNull(today, yesterday, "calories_logged");
    const proteinLogged = firstNumberOrNull(today, yesterday, "protein_logged");
    const hydrationMl = firstNumberOrNull(today, yesterday, "hydration_ml");
    const activeEnergyKcal = firstNumberOrNull(today, yesterday, "active_energy_kcal");
    const steps = firstNumberOrNull(today, yesterday, "steps");
    const workoutMinutes = firstNumberOrNull(today, yesterday, "workout_minutes");
    const rescuePlan = buildDailyRescuePlan(profile, today);
    const hasFitmacroNutrition =
      positiveNumberOrNull(yesterday?.calories_logged) !== null ||
      positiveNumberOrNull(yesterday?.protein_logged) !== null ||
      positiveNumberOrNull(today?.calories_logged) !== null ||
      positiveNumberOrNull(today?.protein_logged) !== null;
    const hasFitfaceSignals =
      firstBooleanOrNull(yesterday, today, "face_scan_done") === true ||
      firstBooleanOrNull(yesterday, today, "body_scan_done") === true ||
      firstNumberOrNull(yesterday, today, "sleep_hours") !== null ||
      firstNumberOrNull(yesterday, today, "workout_minutes") !== null ||
      firstNumberOrNull(yesterday, today, "face_overall_score") !== null ||
      firstNumberOrNull(yesterday, today, "body_definition_score") !== null;
    const nutritionSignalLabel = firstStringOrNull(
      yesterday,
      today,
      "nutrition_signal_label"
    );
    const userRef = query.ecosystemUserId.slice(-8);
    app.log.info(
      {
        cached: cacheHit,
        hasFitfaceSignals,
        hasFitmacroNutrition,
        nutritionSignalLabel,
        rescuePlanStatus: rescuePlan?.status ?? null,
        micronutrientCoachingApplied: micronutrientSuggestion !== null,
        personalizedByAi: personalized.personalizedByAi,
        sourceApp: query.sourceApp,
        usedYesterdayData: yesterday !== null,
        userRef,
      },
      "Daily coach prepared"
    );

    return {
      dailyCoach: {
        date: todayDate,
        reviewedDate: yesterdayDate,
        headline: personalized.nudge.title,
        message: personalized.nudge.body,
        personalizedByAi: personalized.personalizedByAi,
        model: personalized.model,
        signals: {
          sleepHours,
          caloriesLogged,
          proteinLogged,
          hydrationMl,
          activeEnergyKcal,
          steps,
          workoutMinutes,
          faceScanDone: firstBooleanOrNull(yesterday, today, "face_scan_done"),
          bodyScanDone: firstBooleanOrNull(yesterday, today, "body_scan_done"),
          faceOverallScore: firstNumberOrNull(yesterday, today, "face_overall_score"),
          bodyPostureScore: firstNumberOrNull(yesterday, today, "body_posture_score"),
          bodyDefinitionScore: firstNumberOrNull(
            yesterday,
            today,
            "body_definition_score"
          ),
          bodyFatRangeEstimate: firstStringOrNull(
            yesterday,
            today,
            "body_fat_range_estimate"
          ),
          nutritionSignalLabel,
          nutritionSuggestion: firstStringOrNull(
            yesterday,
            today,
            "nutrition_suggestion"
          ),
        },
        action: {
          recommendedApp: query.sourceApp,
          destinationKey: query.sourceApp === "fitmacro" ? "meal_plan" : "daily_tracking",
        },
        rescuePlan,
        micronutrientSuggestion,
      },
      cached: cacheHit,
    };
  });
}
