import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";

const querySchema = z.object({
  fitmacroUid: z.string().trim().min(1).optional(),
  fitfaceUid: z.string().trim().min(1).optional(),
});

export async function registerUserRoutes(app: FastifyInstance) {
  app.get("/v1/ecosystem/user", async (request, reply) => {
    const query = querySchema.parse(request.query ?? {});
    if (!query.fitmacroUid && !query.fitfaceUid) {
      return reply.code(400).send({ error: "fitmacroUid or fitfaceUid is required." });
    }

    const userResult = await pool.query(
      `select * from ecosystem_users
       where ($1::text is not null and fitmacro_uid = $1)
          or ($2::text is not null and fitface_uid = $2)
       limit 1`,
      [query.fitmacroUid ?? null, query.fitfaceUid ?? null]
    );

    const user = userResult.rows[0];
    if (!user) return reply.code(404).send({ error: "User not found." });

    const profileResult = await pool.query(
      `select * from ecosystem_profiles where ecosystem_user_id = $1 limit 1`,
      [user.ecosystem_user_id]
    );

    return {
      user: {
        ecosystemUserId: user.ecosystem_user_id,
        fitmacroUid: user.fitmacro_uid,
        fitfaceUid: user.fitface_uid,
        email: user.email,
      },
      profile: profileResult.rows[0]
        ? {
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
            units: profileResult.rows[0].units,
            timezone: profileResult.rows[0].timezone,
          }
        : null,
    };
  });
}
