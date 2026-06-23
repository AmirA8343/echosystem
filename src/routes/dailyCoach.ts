import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { personalizeCoachNudge, type PersonalizedCoachNudge } from "../lib/aiCoachNudge.js";
import { buildDailyMorningReview } from "../lib/dailyMorningCoach.js";
import { getLocalDateKey } from "../lib/date.js";

const querySchema = z.object({
  ecosystemUserId: z.string().uuid(),
  sourceApp: z.enum(["fitmacro", "fitface"]).default("fitmacro"),
  locale: z.string().trim().min(2).max(16).optional(),
});

type CacheEntry = {
  contextHash: string;
  expiresAt: number;
  personalized: PersonalizedCoachNudge;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

const positiveNumberOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

export async function registerDailyCoachRoutes(app: FastifyInstance) {
  app.get("/v1/ecosystem/daily-coach", async (request, reply) => {
    const query = querySchema.parse(request.query ?? {});
    const [userResult, profileResult] = await Promise.all([
      pool.query(
        `select ecosystem_user_id from ecosystem_users where ecosystem_user_id = $1 limit 1`,
        [query.ecosystemUserId]
      ),
      pool.query(
        `select * from ecosystem_profiles where ecosystem_user_id = $1 limit 1`,
        [query.ecosystemUserId]
      ),
    ]);

    if (!userResult.rows[0]) {
      return reply.code(404).send({ error: "User not found." });
    }

    const profile = (profileResult.rows[0] as Record<string, unknown> | undefined) ?? null;
    const timezone = String(profile?.timezone ?? "America/Toronto");
    const todayDate = getLocalDateKey(timezone);
    const yesterdayDate = getLocalDateKey(
      timezone,
      new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    const [todayResult, yesterdayResult, recentResult] = await Promise.all([
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1 and date = $2::date limit 1`,
        [query.ecosystemUserId, todayDate]
      ),
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1 and date = $2::date limit 1`,
        [query.ecosystemUserId, yesterdayDate]
      ),
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1 order by date desc limit 7`,
        [query.ecosystemUserId]
      ),
    ]);

    const today = (todayResult.rows[0] as Record<string, unknown> | undefined) ?? null;
    const yesterday =
      (yesterdayResult.rows[0] as Record<string, unknown> | undefined) ?? null;
    const recentSummaries = recentResult.rows as Record<string, unknown>[];
    const fallback = buildDailyMorningReview({
      sourceApp: query.sourceApp,
      profile,
      today,
      yesterday,
    });
    const locale = query.locale ?? "en";
    const contextHash = createHash("sha256")
      .update(JSON.stringify({ profile, today, yesterday, fallback, locale }))
      .digest("hex");
    const cacheKey = `${query.ecosystemUserId}:${query.sourceApp}:${locale}`;
    const cached = cache.get(cacheKey);
    let personalized: PersonalizedCoachNudge;
    let cacheHit = false;

    if (cached && cached.contextHash === contextHash && cached.expiresAt > Date.now()) {
      personalized = cached.personalized;
      cacheHit = true;
    } else {
      personalized = await personalizeCoachNudge({
        fallback,
        sourceApp: query.sourceApp,
        locale,
        profile,
        today,
        yesterday,
        recentSummaries,
      });
      if (personalized.personalizedByAi) {
        if (cache.size >= 500) cache.clear();
        cache.set(cacheKey, {
          contextHash,
          expiresAt: Date.now() + CACHE_TTL_MS,
          personalized,
        });
      } else {
        cache.delete(cacheKey);
      }
    }

    const sleepHours =
      positiveNumberOrNull(today?.sleep_hours) ??
      positiveNumberOrNull(yesterday?.sleep_hours);
    const userRef = query.ecosystemUserId.slice(-8);
    app.log.info(
      {
        cached: cacheHit,
        personalizedByAi: personalized.personalizedByAi,
        sourceApp: query.sourceApp,
        usedYesterdayData: yesterday !== null,
        userRef,
      },
      "Daily coach prepared"
    );

    return {
      dailyCoach: {
        date: todayDate,
        reviewedDate: yesterdayDate,
        headline: personalized.nudge.title,
        message: personalized.nudge.body,
        personalizedByAi: personalized.personalizedByAi,
        model: personalized.model,
        signals: {
          sleepHours,
          caloriesLogged: positiveNumberOrNull(yesterday?.calories_logged),
          proteinLogged: positiveNumberOrNull(yesterday?.protein_logged),
          hydrationMl: positiveNumberOrNull(yesterday?.hydration_ml),
          steps: positiveNumberOrNull(yesterday?.steps),
          workoutMinutes: positiveNumberOrNull(yesterday?.workout_minutes),
        },
        action: {
          recommendedApp: query.sourceApp,
          destinationKey: query.sourceApp === "fitmacro" ? "meal_plan" : "daily_tracking",
        },
      },
      cached: cacheHit,
    };
  });
}
