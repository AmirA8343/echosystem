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
    const steps = firstNumberOrNull(today, yesterday, "steps");
    const workoutMinutes = firstNumberOrNull(today, yesterday, "workout_minutes");
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
        micronutrientSuggestion,
      },
      cached: cacheHit,
    };
  });
}
