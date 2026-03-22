import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { deriveCoachDecision } from "../lib/deriveCoachDecision.js";
import { deriveWeeklyReview } from "../lib/deriveWeeklyReview.js";
import { deriveNudges } from "../lib/deriveNudges.js";
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
    fitmacroUpdatedAt: row.fitmacro_updated_at as string | null,
    fitfaceUpdatedAt: row.fitface_updated_at as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  } satisfies EcosystemDailySummary;
}

export async function registerCoachContextRoutes(app: FastifyInstance) {
  app.get("/v1/ecosystem/coach-context", async (request, reply) => {
    const query = querySchema.parse(request.query ?? {});
    const [userResult, profileResult, summaryResult] = await Promise.all([
      pool.query(`select * from ecosystem_users where ecosystem_user_id = $1 limit 1`, [query.ecosystemUserId]),
      pool.query(`select * from ecosystem_profiles where ecosystem_user_id = $1 limit 1`, [query.ecosystemUserId]),
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1
         order by date desc
         limit 7`,
        [query.ecosystemUserId]
      ),
    ]);

    const user = userResult.rows[0];
    if (!user) return reply.code(404).send({ error: "User not found." });

    const profile = profileResult.rows[0]
      ? ({
          ecosystemUserId: profileResult.rows[0].ecosystem_user_id,
          goal: profileResult.rows[0].goal,
          age: profileResult.rows[0].age,
          sex: profileResult.rows[0].sex,
          heightCm: Number(profileResult.rows[0].height_cm ?? 0) || null,
          weightKg: Number(profileResult.rows[0].weight_kg ?? 0) || null,
          targetWeightKg: Number(profileResult.rows[0].target_weight_kg ?? 0) || null,
          activityLevel: profileResult.rows[0].activity_level,
          workoutDaysPerWeek: profileResult.rows[0].workout_days_per_week,
          calorieTarget: profileResult.rows[0].calorie_target,
          proteinTarget: Number(profileResult.rows[0].protein_target ?? 0) || null,
          primaryFocus: profileResult.rows[0].primary_focus,
          secondaryFocus: profileResult.rows[0].secondary_focus,
          experience: profileResult.rows[0].experience,
          timeConstraint: profileResult.rows[0].time_constraint,
          units: profileResult.rows[0].units,
          timezone: profileResult.rows[0].timezone,
          createdAt: String(profileResult.rows[0].created_at),
          updatedAt: String(profileResult.rows[0].updated_at),
        } satisfies EcosystemProfile)
      : null;

    const summaries = summaryResult.rows.map((row) =>
      mapSummaryRow(row as Record<string, unknown>)
    );
    const today = summaries[0] ?? null;

    const coachDecision = deriveCoachDecision(profile, today);
    const weeklyReview = deriveWeeklyReview(profile, summaries);

    return {
      user: {
        ecosystemUserId: user.ecosystem_user_id,
        fitmacroUid: user.fitmacro_uid,
        fitfaceUid: user.fitface_uid,
        email: user.email,
      },
      profile: profile
          ? {
            goal: profile.goal,
            calorieTarget: profile.calorieTarget,
            proteinTarget: profile.proteinTarget,
            primaryFocus: profile.primaryFocus,
            secondaryFocus: profile.secondaryFocus,
            experience: profile.experience,
            timeConstraint: profile.timeConstraint,
          }
        : null,
      today,
      nudges: deriveNudges(profile, today),
      primaryAction: coachDecision.primaryAction,
      winsToday: coachDecision.winsToday,
      missingToday: coachDecision.missingToday,
      consistencyScore: coachDecision.consistencyScore,
      antiAgingFocus: coachDecision.antiAgingFocus,
      weeklyReview,
    };
  });
}
