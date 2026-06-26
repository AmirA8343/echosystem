import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { pool } from "../db/pool.js";

type EcosystemSourceApp = "fitmacro" | "fitface";

export type EcosystemAuth = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  projectId: string;
  sourceApp: EcosystemSourceApp;
};

declare module "fastify" {
  interface FastifyRequest {
    ecosystemAuth?: EcosystemAuth;
  }
}

const firebaseJwks = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

function configuredProjects(): Record<string, EcosystemSourceApp> {
  return {
    [process.env.FITMACRO_FIREBASE_PROJECT_ID?.trim() || "macrofit-44fc8"]:
      "fitmacro",
    [process.env.FITFACE_FIREBASE_PROJECT_ID?.trim() || "fitmacros-personal"]:
      "fitface",
  };
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

async function verifyFirebaseToken(token: string): Promise<EcosystemAuth> {
  const unverified = decodeJwt(token);
  const projectId = typeof unverified.aud === "string" ? unverified.aud : "";
  const sourceApp = configuredProjects()[projectId];
  if (!sourceApp) throw new Error("Firebase project is not allowed.");

  const { payload } = await jwtVerify(token, firebaseJwks, {
    algorithms: ["RS256"],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  });
  if (!payload.sub) throw new Error("Firebase user ID is missing.");

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
    emailVerified: payload.email_verified === true,
    projectId,
    sourceApp,
  };
}

function requestedEcosystemUserId(request: FastifyRequest): string | null {
  for (const candidate of [request.body, request.query, request.params]) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = (candidate as Record<string, unknown>).ecosystemUserId;
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export async function registerEcosystemAuth(app: FastifyInstance) {
  const authRequired = process.env.ECOSYSTEM_AUTH_REQUIRED === "true";
  app.log.info(
    { authRequired },
    `Ecosystem authentication loaded: ${authRequired ? "required" : "migration mode"}`
  );

  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?", 1)[0];
    if (!path.startsWith("/v1/ecosystem/")) return;
    if (path === "/v1/ecosystem/push-coach-nudge") return;

    const token = bearerToken(request);
    if (!token) {
      if (!authRequired && path !== "/v1/ecosystem/account") return;
      return reply.code(401).send({ error: "Authentication required." });
    }

    try {
      request.ecosystemAuth = await verifyFirebaseToken(token);
    } catch (error) {
      request.log.warn({ error }, "Ecosystem authentication failed");
      return reply.code(401).send({ error: "Invalid authentication token." });
    }

    const ecosystemUserId = requestedEcosystemUserId(request);
    if (!ecosystemUserId) return;

    const auth = request.ecosystemAuth;
    const result = await pool.query(
      `select 1 from ecosystem_users
       where ecosystem_user_id = $1
         and (($2 = 'fitmacro' and fitmacro_uid = $3)
           or ($2 = 'fitface' and fitface_uid = $3))
       limit 1`,
      [ecosystemUserId, auth.sourceApp, auth.uid]
    );
    if (!result.rowCount) {
      return reply.code(403).send({ error: "Ecosystem account access denied." });
    }
  });
}
