import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { deriveCoachBrief } from "../lib/deriveCoachBrief.js";
import type { EcosystemDailySummary, EcosystemProfile } from "../types.js";

const querySchema = z.object({
  ecosystemUserId: z.string().uuid(),
});

function toIsoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function mapSummaryRow(row: Record<string, unknown>): EcosystemDailySummary {
  return {
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
  };
}

function mapProfileRow(row: Record<string, unknown> | undefined): EcosystemProfile | null {
  if (!row) return null;

  return {
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
  };
}

export async function registerCoachBriefRoutes(app: FastifyInstance) {
  app.get("/v1/ecosystem/coach-brief", async (request, reply) => {
    const query = querySchema.parse(request.query ?? {});
    const [userResult, profileResult, summaryResult] = await Promise.all([
      pool.query(`select * from ecosystem_users where ecosystem_user_id = $1 limit 1`, [query.ecosystemUserId]),
      pool.query(`select * from ecosystem_profiles where ecosystem_user_id = $1 limit 1`, [query.ecosystemUserId]),
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1
         order by date desc
         limit 14`,
        [query.ecosystemUserId]
      ),
    ]);

    const user = userResult.rows[0];
    if (!user) return reply.code(404).send({ error: "User not found." });

    const profile = mapProfileRow(profileResult.rows[0] as Record<string, unknown> | undefined);
    const summaries = summaryResult.rows.map((row) => mapSummaryRow(row as Record<string, unknown>));

    return {
      coachBrief: deriveCoachBrief(query.ecosystemUserId, profile, summaries),
    };
  });
}
