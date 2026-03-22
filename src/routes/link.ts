import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";

const linkBodySchema = z.object({
  fitmacroUid: z.string().trim().min(1).optional(),
  fitfaceUid: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
});

export async function registerLinkRoutes(app: FastifyInstance) {
  app.post("/v1/ecosystem/link", async (request, reply) => {
    const body = linkBodySchema.parse(request.body ?? {});
    if (!body.fitmacroUid && !body.fitfaceUid && !body.email) {
      return reply.code(400).send({ error: "At least one identifier is required." });
    }

    const normalizedEmail = body.email?.toLowerCase() ?? null;
    const lockKeys = [normalizedEmail, body.fitmacroUid ?? null, body.fitfaceUid ?? null]
      .filter((value): value is string => Boolean(value))
      .map((value) => `ecosystem-link:${value}`)
      .sort();

    const client = await pool.connect();
    try {
      await client.query("begin");

      for (const key of lockKeys) {
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [key]);
      }

      const rows = (
        await client.query(
          `select * from ecosystem_users
           where ($1::text is not null and fitmacro_uid = $1)
              or ($2::text is not null and fitface_uid = $2)
              or ($3::text is not null and lower(email) = $3)`,
          [body.fitmacroUid ?? null, body.fitfaceUid ?? null, normalizedEmail]
        )
      ).rows;

      if (rows.length > 1) {
        await client.query("rollback");
        return reply.code(409).send({ error: "Conflicting linked accounts found. Resolve manually." });
      }

      const row =
        rows[0] ??
        (
          await client.query(
            `insert into ecosystem_users (fitmacro_uid, fitface_uid, email)
             values ($1, $2, $3)
             returning *`,
            [body.fitmacroUid ?? null, body.fitfaceUid ?? null, normalizedEmail]
          )
        ).rows[0];

      const updated = (
        await client.query(
          `update ecosystem_users
           set fitmacro_uid = coalesce($2, fitmacro_uid),
               fitface_uid = coalesce($3, fitface_uid),
               email = coalesce($4, email),
               updated_at = now()
           where ecosystem_user_id = $1
           returning *`,
          [row.ecosystem_user_id, body.fitmacroUid ?? null, body.fitfaceUid ?? null, normalizedEmail]
        )
      ).rows[0];

      await client.query("commit");
      return {
        ecosystemUserId: updated.ecosystem_user_id,
        fitmacroUid: updated.fitmacro_uid,
        fitfaceUid: updated.fitface_uid,
        email: updated.email,
      };
    } catch (error: any) {
      await client.query("rollback");
      return reply.code(500).send({ error: error?.message ?? "Failed to link account." });
    } finally {
      client.release();
    }
  });
}
