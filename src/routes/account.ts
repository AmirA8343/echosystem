import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";

export async function registerAccountRoutes(app: FastifyInstance) {
  app.delete("/v1/ecosystem/account", async (request, reply) => {
    const auth = request.ecosystemAuth;
    if (!auth) return reply.code(401).send({ error: "Authentication required." });

    const result = await pool.query(
      `delete from ecosystem_users
       where ($1 = 'fitmacro' and fitmacro_uid = $2)
          or ($1 = 'fitface' and fitface_uid = $2)
       returning ecosystem_user_id`,
      [auth.sourceApp, auth.uid]
    );
    if (!result.rowCount) return reply.code(404).send({ deleted: false });

    request.log.info(
      { sourceApp: auth.sourceApp, uid: auth.uid },
      "Ecosystem account data deleted"
    );
    return { deleted: true };
  });
}
