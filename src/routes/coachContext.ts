import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { deriveCoachDecision } from "../lib/deriveCoachDecision.js";
import { deriveWeeklyReview } from "../lib/deriveWeeklyReview.js";
import { deriveNudges } from "../lib/deriveNudges.js";
import { getLocalDateKey } from "../lib/date.js";
import { ensureCoachEventsSchema } from "./coachEvent.js";
import type { CoachEvent, EcosystemDailySummary, EcosystemProfile } from "../types.js";

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
  } satisfies EcosystemDailySummary;
}

function mapCoachEventRow(row: Record<string, unknown>): CoachEvent {
  return {
    id: String(row.id),
    ecosystemUserId: String(row.ecosystem_user_id),
    sourceApp: row.source_app as CoachEvent["sourceApp"],
    eventType: row.event_type as CoachEvent["eventType"],
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function registerCoachContextRoutes(app: FastifyInstance) {
  app.get("/v1/ecosystem/coach-context", async (request, reply) => {
    const query = querySchema.parse(request.query ?? {});
    await ensureCoachEventsSchema();

    const [userResult, profileResult, summaryResult, eventResult] = await Promise.all([
      pool.query(`select * from ecosystem_users where ecosystem_user_id = $1 limit 1`, [query.ecosystemUserId]),
      pool.query(`select * from ecosystem_profiles where ecosystem_user_id = $1 limit 1`, [query.ecosystemUserId]),
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1
         order by date desc
         limit 14`,
        [query.ecosystemUserId]
      ),
      pool.query(
        `select * from ecosystem_coach_events
         where ecosystem_user_id = $1
           and created_at >= now() - interval '14 days'
         order by created_at desc
         limit 120`,
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
    const events = eventResult.rows.map((row) => mapCoachEventRow(row as Record<string, unknown>));
    const todayDate = getLocalDateKey(profile?.timezone);
    const today = summaries.find((summary) => summary.date === todayDate) ?? null;

    const coachDecision = deriveCoachDecision(profile, today);
    const weeklyReview = deriveWeeklyReview(profile, summaries, events);

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
