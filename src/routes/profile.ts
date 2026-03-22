import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";

const profileSchema = z.object({
  ecosystemUserId: z.string().uuid(),
  goal: z.enum(["fat_loss", "maintenance", "muscle_gain", "recomp"]),
  age: z.number().int().min(0).max(120).nullable().optional(),
  sex: z.enum(["male", "female"]).nullable().optional(),
  heightCm: z.number().positive().nullable().optional(),
  weightKg: z.number().positive().nullable().optional(),
  targetWeightKg: z.number().positive().nullable().optional(),
  activityLevel: z.enum(["low", "moderate", "high"]).nullable().optional(),
  workoutDaysPerWeek: z.number().int().min(0).max(14).nullable().optional(),
  calorieTarget: z.number().int().positive().nullable().optional(),
  proteinTarget: z.number().positive().nullable().optional(),
  primaryFocus: z.enum(["body_composition", "looks", "longevity", "maintenance"]).nullable().optional(),
  secondaryFocus: z
    .enum(["nutrition", "recovery", "training", "skin", "muscle", "consistency"])
    .nullable()
    .optional(),
  experience: z.enum(["beginner", "intermediate", "advanced"]).nullable().optional(),
  timeConstraint: z.enum(["low", "moderate", "high"]).nullable().optional(),
  units: z.enum(["metric", "imperial"]).default("metric"),
  timezone: z.string().trim().min(1).default("America/Toronto"),
});

let ensureExtendedProfileSchemaPromise: Promise<void> | null = null;

async function ensureExtendedProfileSchema(): Promise<void> {
  if (!ensureExtendedProfileSchemaPromise) {
    ensureExtendedProfileSchemaPromise = pool
      .query(`
        alter table ecosystem_profiles
          add column if not exists primary_focus text check (primary_focus in ('body_composition', 'looks', 'longevity', 'maintenance')),
          add column if not exists secondary_focus text check (secondary_focus in ('nutrition', 'recovery', 'training', 'skin', 'muscle', 'consistency')),
          add column if not exists experience text check (experience in ('beginner', 'intermediate', 'advanced')),
          add column if not exists time_constraint text check (time_constraint in ('low', 'moderate', 'high'))
      `)
      .then(() => undefined);
  }

  await ensureExtendedProfileSchemaPromise;
}

export async function registerProfileRoutes(app: FastifyInstance) {
  app.put("/v1/ecosystem/profile", async (request) => {
    const body = profileSchema.parse(request.body ?? {});
    await ensureExtendedProfileSchema();

    const result = await pool.query(
      `insert into ecosystem_profiles (
         ecosystem_user_id, goal, age, sex, height_cm, weight_kg, target_weight_kg,
         activity_level, workout_days_per_week, calorie_target, protein_target,
         primary_focus, secondary_focus, experience, time_constraint, units, timezone
       ) values (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
       )
       on conflict (ecosystem_user_id) do update set
         goal = excluded.goal,
         age = coalesce(excluded.age, ecosystem_profiles.age),
         sex = coalesce(excluded.sex, ecosystem_profiles.sex),
         height_cm = coalesce(excluded.height_cm, ecosystem_profiles.height_cm),
         weight_kg = coalesce(excluded.weight_kg, ecosystem_profiles.weight_kg),
         target_weight_kg = coalesce(excluded.target_weight_kg, ecosystem_profiles.target_weight_kg),
         activity_level = coalesce(excluded.activity_level, ecosystem_profiles.activity_level),
         workout_days_per_week = coalesce(excluded.workout_days_per_week, ecosystem_profiles.workout_days_per_week),
         calorie_target = coalesce(excluded.calorie_target, ecosystem_profiles.calorie_target),
         protein_target = coalesce(excluded.protein_target, ecosystem_profiles.protein_target),
         primary_focus = coalesce(excluded.primary_focus, ecosystem_profiles.primary_focus),
         secondary_focus = coalesce(excluded.secondary_focus, ecosystem_profiles.secondary_focus),
         experience = coalesce(excluded.experience, ecosystem_profiles.experience),
         time_constraint = coalesce(excluded.time_constraint, ecosystem_profiles.time_constraint),
         units = excluded.units,
         timezone = excluded.timezone,
         updated_at = now()
       returning *`,
      [
        body.ecosystemUserId,
        body.goal,
        body.age ?? null,
        body.sex ?? null,
        body.heightCm ?? null,
        body.weightKg ?? null,
        body.targetWeightKg ?? null,
        body.activityLevel ?? null,
        body.workoutDaysPerWeek ?? null,
        body.calorieTarget ?? null,
        body.proteinTarget ?? null,
        body.primaryFocus ?? null,
        body.secondaryFocus ?? null,
        body.experience ?? null,
        body.timeConstraint ?? null,
        body.units,
        body.timezone,
      ]
    );

    const row = result.rows[0];
    return {
      ok: true,
      profile: {
        ecosystemUserId: row.ecosystem_user_id,
        goal: row.goal,
        calorieTarget: row.calorie_target,
        proteinTarget: Number(row.protein_target ?? 0) || null,
        primaryFocus: row.primary_focus,
        secondaryFocus: row.secondary_focus,
        experience: row.experience,
        timeConstraint: row.time_constraint,
        updatedAt: row.updated_at,
      },
    };
  });
}
