import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { sanitizeDailySummaryPatch } from "../lib/mergeDailySummary.js";

const summaryBodySchema = z.object({
  ecosystemUserId: z.string().uuid(),
  date: z.string().min(10).max(10),
  source: z.enum(["fitmacro", "fitface"]),
  summary: z.object({
    caloriesLogged: z.number().int().optional(),
    proteinLogged: z.number().optional(),
    mealsLogged: z.number().int().optional(),
    workoutMinutes: z.number().int().optional(),
    steps: z.number().int().optional(),
    sleepHours: z.number().optional(),
    hydrationMl: z.number().int().optional(),
    sodiumMg: z.number().int().optional(),
    faceScanDone: z.boolean().optional(),
    bodyScanDone: z.boolean().optional(),
    faceOverallScore: z.number().int().optional(),
    bodyPostureScore: z.number().int().optional(),
    bodyDefinitionScore: z.number().int().optional(),
    bodyFatRangeEstimate: z.string().optional(),
    nutritionSignalLabel: z.string().optional(),
    nutritionSuggestion: z.string().optional(),
  }),
});

const summaryQuerySchema = z.object({
  ecosystemUserId: z.string().uuid(),
  date: z.string().min(10).max(10),
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

function mapDailySummary(row: Record<string, unknown>) {
  return {
    ecosystemUserId: row.ecosystem_user_id,
    date: toIsoDate(row.date),
    caloriesLogged: row.calories_logged,
    proteinLogged: Number(row.protein_logged ?? 0) || null,
    mealsLogged: row.meals_logged,
    workoutMinutes: row.workout_minutes,
    steps: row.steps,
    sleepHours: Number(row.sleep_hours ?? 0) || null,
    hydrationMl: row.hydration_ml,
    sodiumMg: row.sodium_mg,
    faceScanDone: row.face_scan_done,
    bodyScanDone: row.body_scan_done,
    faceOverallScore: row.face_overall_score,
    bodyPostureScore: row.body_posture_score,
    bodyDefinitionScore: row.body_definition_score,
    bodyFatRangeEstimate: row.body_fat_range_estimate,
    nutritionSignalLabel: row.nutrition_signal_label,
    nutritionSuggestion: row.nutrition_suggestion,
  };
}

export async function registerDailySummaryRoutes(app: FastifyInstance) {
  app.post("/v1/ecosystem/daily-summary", async (request) => {
    const body = summaryBodySchema.parse(request.body ?? {});
    const patch = sanitizeDailySummaryPatch(body.source, body.summary);
    const timestampColumn = body.source === "fitmacro" ? "fitmacro_updated_at" : "fitface_updated_at";

    const current = await pool.query(
      `select * from ecosystem_daily_summaries where ecosystem_user_id = $1 and date = $2`,
      [body.ecosystemUserId, body.date]
    );

    const merged = {
      caloriesLogged: patch.caloriesLogged ?? current.rows[0]?.calories_logged ?? null,
      proteinLogged: patch.proteinLogged ?? current.rows[0]?.protein_logged ?? null,
      mealsLogged: patch.mealsLogged ?? current.rows[0]?.meals_logged ?? null,
      workoutMinutes: patch.workoutMinutes ?? current.rows[0]?.workout_minutes ?? null,
      steps: patch.steps ?? current.rows[0]?.steps ?? null,
      sleepHours: patch.sleepHours ?? current.rows[0]?.sleep_hours ?? null,
      hydrationMl: patch.hydrationMl ?? current.rows[0]?.hydration_ml ?? null,
      sodiumMg: patch.sodiumMg ?? current.rows[0]?.sodium_mg ?? null,
      faceScanDone: patch.faceScanDone ?? current.rows[0]?.face_scan_done ?? null,
      bodyScanDone: patch.bodyScanDone ?? current.rows[0]?.body_scan_done ?? null,
      faceOverallScore: patch.faceOverallScore ?? current.rows[0]?.face_overall_score ?? null,
      bodyPostureScore: patch.bodyPostureScore ?? current.rows[0]?.body_posture_score ?? null,
      bodyDefinitionScore: patch.bodyDefinitionScore ?? current.rows[0]?.body_definition_score ?? null,
      bodyFatRangeEstimate: patch.bodyFatRangeEstimate ?? current.rows[0]?.body_fat_range_estimate ?? null,
      nutritionSignalLabel: patch.nutritionSignalLabel ?? current.rows[0]?.nutrition_signal_label ?? null,
      nutritionSuggestion: patch.nutritionSuggestion ?? current.rows[0]?.nutrition_suggestion ?? null,
    };

    const result = await pool.query(
      `insert into ecosystem_daily_summaries (
         ecosystem_user_id, date, calories_logged, protein_logged, meals_logged,
         workout_minutes, steps, sleep_hours, hydration_ml, sodium_mg, face_scan_done, body_scan_done,
         face_overall_score, body_posture_score, body_definition_score, body_fat_range_estimate,
         nutrition_signal_label, nutrition_suggestion, ${timestampColumn}
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16,
         $17, $18, now()
       )
       on conflict (ecosystem_user_id, date) do update set
         calories_logged = excluded.calories_logged,
         protein_logged = excluded.protein_logged,
         meals_logged = excluded.meals_logged,
         workout_minutes = excluded.workout_minutes,
         steps = excluded.steps,
         sleep_hours = excluded.sleep_hours,
         hydration_ml = excluded.hydration_ml,
         sodium_mg = excluded.sodium_mg,
         face_scan_done = excluded.face_scan_done,
         body_scan_done = excluded.body_scan_done,
         face_overall_score = excluded.face_overall_score,
         body_posture_score = excluded.body_posture_score,
         body_definition_score = excluded.body_definition_score,
         body_fat_range_estimate = excluded.body_fat_range_estimate,
         nutrition_signal_label = excluded.nutrition_signal_label,
         nutrition_suggestion = excluded.nutrition_suggestion,
         ${timestampColumn} = now(),
         updated_at = now()
       returning *`,
      [
        body.ecosystemUserId,
        body.date,
        merged.caloriesLogged,
        merged.proteinLogged,
        merged.mealsLogged,
        merged.workoutMinutes,
        merged.steps,
        merged.sleepHours,
        merged.hydrationMl,
        merged.sodiumMg,
        merged.faceScanDone,
        merged.bodyScanDone,
        merged.faceOverallScore,
        merged.bodyPostureScore,
        merged.bodyDefinitionScore,
        merged.bodyFatRangeEstimate,
        merged.nutritionSignalLabel,
        merged.nutritionSuggestion,
      ]
    );

    const row = result.rows[0] as Record<string, unknown>;
    return {
      ok: true,
      dailySummary: mapDailySummary(row),
    };
  });

  app.get("/v1/ecosystem/daily-summary", async (request, reply) => {
    const query = summaryQuerySchema.parse(request.query ?? {});
    const result = await pool.query(
      `select * from ecosystem_daily_summaries where ecosystem_user_id = $1 and date = $2 limit 1`,
      [query.ecosystemUserId, query.date]
    );

    const row = result.rows[0];
    if (!row) return reply.code(404).send({ error: "Daily summary not found." });

    return {
      dailySummary: mapDailySummary(row as Record<string, unknown>),
    };
  });
}
