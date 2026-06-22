import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { personalizeWeeklyCoach, type AiWeeklyCoach } from "../lib/aiWeeklyCoach.js";
import { deriveWeeklyReview } from "../lib/deriveWeeklyReview.js";
import { ensureCoachEventsSchema } from "./coachEvent.js";
import type { CoachEvent, EcosystemDailySummary, EcosystemProfile } from "../types.js";

const querySchema = z.object({
  ecosystemUserId: z.string().uuid(),
  locale: z.string().trim().min(2).max(16).optional(),
});

type CacheEntry = {
  contextHash: string;
  expiresAt: number;
  coach: AiWeeklyCoach;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const toIsoDate = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
};

const mapSummary = (row: Record<string, unknown>): EcosystemDailySummary => ({
  ecosystemUserId: String(row.ecosystem_user_id),
  date: toIsoDate(row.date),
  caloriesLogged: row.calories_logged as number | null,
  proteinLogged: Number(row.protein_logged ?? 0) || null,
  mealsLogged: row.meals_logged as number | null,
  workoutMinutes: row.workout_minutes as number | null,
  steps: row.steps as number | null,
  sleepHours: Number(row.sleep_hours ?? 0) || null,
  hydrationMl: row.hydration_ml as number | null,
  sodiumMg: row.sodium_mg as number | null,
  faceScanDone: row.face_scan_done as boolean | null,
  bodyScanDone: row.body_scan_done as boolean | null,
  faceOverallScore: row.face_overall_score as number | null,
  bodyPostureScore: row.body_posture_score as number | null,
  bodyDefinitionScore: row.body_definition_score as number | null,
  bodyFatRangeEstimate: row.body_fat_range_estimate as string | null,
  nutritionSignalLabel: row.nutrition_signal_label as string | null,
  nutritionSuggestion: row.nutrition_suggestion as string | null,
  fitmacroUpdatedAt: row.fitmacro_updated_at as string | null,
  fitfaceUpdatedAt: row.fitface_updated_at as string | null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const mapEvent = (row: Record<string, unknown>): CoachEvent => ({
  id: String(row.id),
  ecosystemUserId: String(row.ecosystem_user_id),
  sourceApp: row.source_app as CoachEvent["sourceApp"],
  eventType: row.event_type as CoachEvent["eventType"],
  metadata: (row.metadata as Record<string, unknown> | null) ?? {},
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
});

const mapProfile = (row: Record<string, unknown>): EcosystemProfile => ({
  ecosystemUserId: String(row.ecosystem_user_id),
  goal: row.goal as EcosystemProfile["goal"],
  age: row.age as number | null,
  sex: row.sex as EcosystemProfile["sex"],
  heightCm: Number(row.height_cm ?? 0) || null,
  weightKg: Number(row.weight_kg ?? 0) || null,
  targetWeightKg: Number(row.target_weight_kg ?? 0) || null,
  activityLevel: row.activity_level as EcosystemProfile["activityLevel"],
  workoutDaysPerWeek: row.workout_days_per_week as number | null,
  calorieTarget: row.calorie_target as number | null,
  proteinTarget: Number(row.protein_target ?? 0) || null,
  primaryFocus: row.primary_focus as EcosystemProfile["primaryFocus"],
  secondaryFocus: row.secondary_focus as EcosystemProfile["secondaryFocus"],
  experience: row.experience as EcosystemProfile["experience"],
  timeConstraint: row.time_constraint as EcosystemProfile["timeConstraint"],
  units: row.units as EcosystemProfile["units"],
  timezone: String(row.timezone ?? "America/Toronto"),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export async function registerWeeklyCoachRoutes(app: FastifyInstance) {
  app.get("/v1/ecosystem/weekly-coach", async (request, reply) => {
    const query = querySchema.parse(request.query ?? {});
    await ensureCoachEventsSchema();

    const [profileResult, summaryResult, eventResult] = await Promise.all([
      pool.query(`select * from ecosystem_profiles where ecosystem_user_id = $1 limit 1`, [query.ecosystemUserId]),
      pool.query(
        `select * from ecosystem_daily_summaries where ecosystem_user_id = $1 order by date desc limit 14`,
        [query.ecosystemUserId]
      ),
      pool.query(
        `select * from ecosystem_coach_events
         where ecosystem_user_id = $1 and created_at >= now() - interval '14 days'
         order by created_at desc limit 120`,
        [query.ecosystemUserId]
      ),
    ]);

    const profile = profileResult.rows[0]
      ? mapProfile(profileResult.rows[0] as Record<string, unknown>)
      : null;
    const summaries = summaryResult.rows.map((row) => mapSummary(row as Record<string, unknown>));
    const events = eventResult.rows.map((row) => mapEvent(row as Record<string, unknown>));
    const weeklyReview = deriveWeeklyReview(profile, summaries, events);
    if (!weeklyReview) return reply.code(404).send({ error: "Weekly coach data is unavailable." });

    const contextHash = createHash("sha256")
      .update(JSON.stringify({ profile, summaries, weeklyReview }))
      .digest("hex");
    const locale = query.locale ?? "en";
    const cacheKey = `${query.ecosystemUserId}:${locale}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.contextHash === contextHash && cached.expiresAt > Date.now()) {
      return { weeklyCoach: cached.coach, weeklyReview, cached: true };
    }

    const weeklyCoach = await personalizeWeeklyCoach({
      locale,
      profile: profile as unknown as Record<string, unknown> | null,
      summaries: summaries as unknown as Record<string, unknown>[],
      weeklyReview,
    });

    if (cache.size >= 500) cache.clear();
    cache.set(cacheKey, {
      contextHash,
      expiresAt: Date.now() + CACHE_TTL_MS,
      coach: weeklyCoach,
    });

    return { weeklyCoach, weeklyReview, cached: false };
  });
}
