import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { personalizeCoachNudge } from "../lib/aiCoachNudge.js";
import { getLocalDateKey } from "../lib/date.js";
import { getCoachMealSuggestion } from "../lib/coachMealSuggestions.js";
import { deriveMicronutrientCoachSuggestion } from "../lib/micronutrientCoach.js";
import type { CoachPushNudge } from "../types.js";

const sourceAppSchema = z.enum(["fitmacro", "fitface"]);
const platformSchema = z.enum(["ios", "android", "web", "unknown"]);

const pushTokenBodySchema = z.object({
  ecosystemUserId: z.string().uuid(),
  sourceApp: sourceAppSchema,
  expoPushToken: z.string().trim().min(10),
  platform: platformSchema.default("unknown"),
  locale: z.string().trim().min(2).max(16).optional(),
  deviceId: z.string().trim().min(1).optional(),
  enabled: z.boolean().default(true),
});

const sendCoachNudgeBodySchema = z.object({
  ecosystemUserId: z.string().uuid().optional(),
  sourceApp: sourceAppSchema.optional(),
  dryRun: z.boolean().default(true),
  force: z.boolean().default(false),
  scheduled: z.boolean().default(false),
  adminSecret: z.string().optional(),
});

const tokenQuerySchema = z.object({
  ecosystemUserId: z.string().uuid(),
});

let ensurePushSchemaPromise: Promise<void> | null = null;

export async function ensurePushSchema(): Promise<void> {
  if (!ensurePushSchemaPromise) {
    ensurePushSchemaPromise = pool
      .query(`
        create table if not exists ecosystem_push_tokens (
          id uuid primary key default gen_random_uuid(),
          ecosystem_user_id uuid not null references ecosystem_users(ecosystem_user_id) on delete cascade,
          source_app text not null check (source_app in ('fitmacro', 'fitface')),
          expo_push_token text not null unique,
          platform text not null default 'unknown' check (platform in ('ios', 'android', 'web', 'unknown')),
          preferred_locale text not null default 'en',
          device_id text,
          enabled boolean not null default true,
          last_registered_at timestamptz not null default now(),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create table if not exists ecosystem_push_sends (
          id uuid primary key default gen_random_uuid(),
          ecosystem_user_id uuid not null references ecosystem_users(ecosystem_user_id) on delete cascade,
          source_app text not null check (source_app in ('fitmacro', 'fitface')),
          expo_push_token text not null,
          nudge_type text not null,
          title text not null,
          body text not null,
          status text not null check (status in ('sent', 'skipped', 'failed')),
          response jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        );

        create index if not exists idx_push_tokens_user_source_enabled
          on ecosystem_push_tokens(ecosystem_user_id, source_app, enabled);
        create index if not exists idx_push_sends_user_created_at
          on ecosystem_push_sends(ecosystem_user_id, created_at desc);
        create index if not exists idx_push_sends_dedupe
          on ecosystem_push_sends(ecosystem_user_id, source_app, nudge_type, created_at desc);

        alter table ecosystem_push_tokens
          add column if not exists preferred_locale text not null default 'en';
      `)
      .then(() => undefined);
  }

  await ensurePushSchemaPromise;
}

function numberOrZero(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildCoachNudgeCandidates(input: {
  ecosystemUserId: string;
  sourceApp: "fitmacro" | "fitface";
  profile: Record<string, unknown> | null;
  today: Record<string, unknown> | null;
  recentSummaries: Record<string, unknown>[];
}): CoachPushNudge[] {
  const proteinTarget = numberOrZero(input.profile?.protein_target);
  const proteinLogged = numberOrZero(input.today?.protein_logged);
  const proteinGap = proteinTarget > 0 ? Math.max(0, Math.round(proteinTarget - proteinLogged)) : 0;
  const caloriesTarget = numberOrZero(input.profile?.calorie_target);
  const caloriesLogged = numberOrZero(input.today?.calories_logged);
  const calorieGap = caloriesTarget > 0 ? Math.max(0, Math.round(caloriesTarget - caloriesLogged)) : 0;
  const sleepHours = numberOrZero(input.today?.sleep_hours);
  const steps = numberOrZero(input.today?.steps);
  const hydrationMl = numberOrZero(input.today?.hydration_ml);
  const workoutMinutes = numberOrZero(input.today?.workout_minutes);
  const faceScanDone = input.today?.face_scan_done === true;
  const bodyScanDone = input.today?.body_scan_done === true;
  const candidates: CoachPushNudge[] = [];

  if (proteinGap >= 30) {
    const meal = getCoachMealSuggestion(proteinGap, Math.min(proteinGap, 40));
    candidates.push({
      type: "protein_gap",
      title: "Protein gap check",
      body: `You are about ${proteinGap}g short on protein. Coach option: ${meal.name} (${meal.protein}g protein, ${meal.calories} kcal, ${meal.carbs}g carbs, ${meal.fat}g fat).`,
      recommendedApp: "fitmacro",
      destinationKey: "meal_plan",
    });
  }

  if (sleepHours > 0 && sleepHours < 6.5) {
    candidates.push({
      type: "low_sleep_recovery",
      title: "Recovery-first day",
      body: `Sleep was ${sleepHours.toFixed(1)}h. Keep training lighter, hydrate early, and keep nutrition steady today.`,
      recommendedApp: input.sourceApp,
      destinationKey: input.sourceApp === "fitmacro" ? "coach_hub" : "daily_tracking",
    });
  }

  if (hydrationMl > 0 && hydrationMl < 1400) {
    candidates.push({
      type: "hydration_low",
      title: "Hydration check",
      body: `Hydration is around ${Math.round(hydrationMl)} ml. Add water now so recovery and scan signals stay cleaner.`,
      recommendedApp: input.sourceApp,
      destinationKey: input.sourceApp === "fitmacro" ? "coach_hub" : "daily_tracking",
    });
  }

  if (steps > 0 && steps < 7000) {
    candidates.push({
      type: "movement_low",
      title: "Movement check",
      body: `You are at ${Math.round(steps).toLocaleString()} steps. A 15-20 minute walk is the best next move.`,
      recommendedApp: input.sourceApp,
      destinationKey: input.sourceApp === "fitmacro" ? "coach_hub" : "daily_tracking",
    });
  }

  if (input.sourceApp === "fitface" && (!faceScanDone || !bodyScanDone)) {
    candidates.push({
      type: "scan_missing",
      title: "Refresh your scan baseline",
      body: `${faceScanDone ? "Body" : bodyScanDone ? "Face" : "Face or body"} scan is still open. A quick scan keeps tomorrow's coaching sharper.`,
      recommendedApp: "fitface",
      destinationKey: faceScanDone ? "body_workout" : "face_workout",
    });
  }

  if (workoutMinutes <= 0 && input.sourceApp === "fitface") {
    candidates.push({
      type: "workout_missing",
      title: "Training minimum",
      body: "Do a short body session or brisk walk so today's plan has movement data.",
      recommendedApp: "fitface",
      destinationKey: "body_workout",
    });
  }

  if (calorieGap >= 500 && input.sourceApp === "fitmacro") {
    candidates.push({
      type: "calorie_gap",
      title: "Finish the day clean",
      body: `You still have about ${calorieGap} kcal available. Keep the next meal protein-forward and easy to track.`,
      recommendedApp: "fitmacro",
      destinationKey: "meal_plan",
    });
  }

  if (input.sourceApp === "fitmacro") {
    const micronutrientSuggestion = deriveMicronutrientCoachSuggestion({
      ecosystemUserId: input.ecosystemUserId,
      profile: input.profile,
      summaries: input.recentSummaries,
    });
    if (micronutrientSuggestion) {
      candidates.push({
        type: `micronutrient_${micronutrientSuggestion.nutrientKey}`,
        title: micronutrientSuggestion.title,
        body: micronutrientSuggestion.body,
        recommendedApp: "fitmacro",
        destinationKey: "meal_plan",
      });
    }
  }

  candidates.push({
    type: "coach_check_in",
    title: "Coach check-in",
    body: "Open your coach view and complete one small action so tomorrow's plan gets smarter.",
    recommendedApp: input.sourceApp,
    destinationKey: input.sourceApp === "fitmacro" ? "meal_plan" : "ai_health_coach",
  });
  return candidates;
}

async function getProfileAndToday(ecosystemUserId: string) {
  const [userResult, profileResult] = await Promise.all([
    pool.query(`select * from ecosystem_users where ecosystem_user_id = $1 limit 1`, [ecosystemUserId]),
    pool.query(`select * from ecosystem_profiles where ecosystem_user_id = $1 limit 1`, [ecosystemUserId]),
  ]);

  const user = userResult.rows[0] as Record<string, unknown> | undefined;
  if (!user) return null;

  const profile = (profileResult.rows[0] as Record<string, unknown> | undefined) ?? null;
  const todayDate = getLocalDateKey(String(profile?.timezone ?? "America/Toronto"));
  const [todayResult, summaryResult] = await Promise.all([
    pool.query(
      `select * from ecosystem_daily_summaries
       where ecosystem_user_id = $1 and date = $2::date
       limit 1`,
      [ecosystemUserId, todayDate]
    ),
    pool.query(
      `select * from ecosystem_daily_summaries
       where ecosystem_user_id = $1
       order by date desc
       limit 7`,
      [ecosystemUserId]
    ),
  ]);
  const summaries = summaryResult.rows as Array<Record<string, unknown>>;

  return {
    user,
    profile,
    today: (todayResult.rows[0] as Record<string, unknown> | undefined) ?? null,
    summaries,
  };
}

function getLocalHour(timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return Number.isFinite(hour) ? hour : null;
  } catch {
    return null;
  }
}

function isScheduledCoachWindow(timezone: string): boolean {
  const hour = getLocalHour(timezone);
  return hour !== null && [8, 12, 18, 20].includes(hour);
}

async function reachedDailySendLimit(input: {
  ecosystemUserId: string;
  sourceApp: "fitmacro" | "fitface";
}): Promise<boolean> {
  const result = await pool.query(
    `select count(*)::int as send_count
     from ecosystem_push_sends
     where ecosystem_user_id = $1
       and source_app = $2
       and status = 'sent'
       and created_at >= now() - interval '20 hours'`,
    [input.ecosystemUserId, input.sourceApp]
  );
  return Number(result.rows[0]?.send_count ?? 0) >= 3;
}

async function recentlySent(input: {
  ecosystemUserId: string;
  sourceApp: "fitmacro" | "fitface";
  nudgeType: string;
}): Promise<boolean> {
  const dedupeWindow = input.nudgeType.startsWith("micronutrient_")
    ? "7 days"
    : "4 hours";
  const result = await pool.query(
    `select 1 from ecosystem_push_sends
     where ecosystem_user_id = $1
       and source_app = $2
       and nudge_type = $3
       and status = 'sent'
       and created_at >= now() - $4::interval
     limit 1`,
    [input.ecosystemUserId, input.sourceApp, input.nudgeType, dedupeWindow]
  );
  return Number(result.rowCount ?? 0) > 0;
}

async function recordPushSend(input: {
  ecosystemUserId: string;
  sourceApp: "fitmacro" | "fitface";
  expoPushToken: string;
  nudge: CoachPushNudge;
  status: "sent" | "skipped" | "failed";
  response: Record<string, unknown>;
}) {
  await pool.query(
    `insert into ecosystem_push_sends (
       ecosystem_user_id, source_app, expo_push_token, nudge_type, title, body, status, response
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.ecosystemUserId,
      input.sourceApp,
      input.expoPushToken,
      input.nudge.type,
      input.nudge.title,
      input.nudge.body,
      input.status,
      JSON.stringify(input.response),
    ]
  );
}

async function sendExpoPush(input: {
  token: string;
  nudge: CoachPushNudge;
  ecosystemUserId: string;
  sourceApp: "fitmacro" | "fitface";
}) {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify({
      to: input.token,
      title: input.nudge.title,
      body: input.nudge.body,
      sound: "default",
      channelId: "meal-reminders",
      data: {
        ecosystemUserId: input.ecosystemUserId,
        sourceApp: input.sourceApp,
        nudgeType: input.nudge.type,
        recommendedApp: input.nudge.recommendedApp,
        destinationKey: input.nudge.destinationKey,
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export async function registerPushRoutes(app: FastifyInstance) {
  app.post("/v1/ecosystem/push-token", async (request, reply) => {
    const body = pushTokenBodySchema.parse(request.body ?? {});
    await ensurePushSchema();

    const userResult = await pool.query(
      `select ecosystem_user_id from ecosystem_users where ecosystem_user_id = $1 limit 1`,
      [body.ecosystemUserId]
    );
    if (!userResult.rows[0]) return reply.code(404).send({ error: "User not found." });

    const result = await pool.query(
      `insert into ecosystem_push_tokens (
         ecosystem_user_id, source_app, expo_push_token, platform, preferred_locale, device_id, enabled
       ) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (expo_push_token) do update
       set ecosystem_user_id = excluded.ecosystem_user_id,
           source_app = excluded.source_app,
           platform = excluded.platform,
           preferred_locale = excluded.preferred_locale,
           device_id = excluded.device_id,
           enabled = excluded.enabled,
           last_registered_at = now(),
           updated_at = now()
       returning id, ecosystem_user_id, source_app, expo_push_token, platform, preferred_locale, device_id, enabled, last_registered_at, created_at, updated_at`,
      [
        body.ecosystemUserId,
        body.sourceApp,
        body.expoPushToken,
        body.platform,
        body.locale ?? "en",
        body.deviceId ?? null,
        body.enabled,
      ]
    );

    const row = result.rows[0];
    return {
      ok: true,
      pushToken: {
        id: row.id,
        ecosystemUserId: row.ecosystem_user_id,
        sourceApp: row.source_app,
        platform: row.platform,
        locale: row.preferred_locale,
        deviceId: row.device_id,
        enabled: row.enabled,
        lastRegisteredAt: row.last_registered_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  });

  app.get("/v1/ecosystem/push-tokens", async (request, reply) => {
    const query = tokenQuerySchema.parse(request.query ?? {});
    await ensurePushSchema();

    const result = await pool.query(
      `select id, ecosystem_user_id, source_app, platform, preferred_locale, device_id, enabled, last_registered_at, created_at, updated_at
       from ecosystem_push_tokens
       where ecosystem_user_id = $1
       order by updated_at desc`,
      [query.ecosystemUserId]
    );

    return {
      pushTokens: result.rows.map((row) => ({
        id: row.id,
        ecosystemUserId: row.ecosystem_user_id,
        sourceApp: row.source_app,
        platform: row.platform,
        locale: row.preferred_locale,
        deviceId: row.device_id,
        enabled: row.enabled,
        lastRegisteredAt: row.last_registered_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  });

  app.post("/v1/ecosystem/push-coach-nudge", async (request, reply) => {
    const body = sendCoachNudgeBodySchema.parse(request.body ?? {});
    await ensurePushSchema();

    const configuredSecret = process.env.ECOSYSTEM_PUSH_ADMIN_SECRET;
    if (!configuredSecret) {
      return reply.code(503).send({
        ok: false,
        error: "Push sending is not configured. Set ECOSYSTEM_PUSH_ADMIN_SECRET first.",
      });
    }

    const providedSecret =
      request.headers["x-ecosystem-admin-secret"] ?? body.adminSecret;
    if (providedSecret !== configuredSecret) {
      return reply.code(401).send({
        ok: false,
        error: "Unauthorized.",
      });
    }

    const tokenResult = await pool.query(
      `select ecosystem_user_id, source_app, expo_push_token, preferred_locale
       from ecosystem_push_tokens
       where enabled = true
         and ($1::uuid is null or ecosystem_user_id = $1)
         and ($2::text is null or source_app = $2)
       order by last_registered_at desc
       limit 200`,
      [body.ecosystemUserId ?? null, body.sourceApp ?? null]
    );

    const results = [];
    for (const token of tokenResult.rows as Array<{
      ecosystem_user_id: string;
      source_app: "fitmacro" | "fitface";
      expo_push_token: string;
      preferred_locale: string;
    }>) {
      const data = await getProfileAndToday(token.ecosystem_user_id);
      if (!data) continue;

      const timezone = String(data.profile?.timezone ?? "America/Toronto");
      if (
        body.scheduled &&
        !body.force &&
        !isScheduledCoachWindow(timezone)
      ) {
        results.push({
          ecosystemUserId: token.ecosystem_user_id,
          sourceApp: token.source_app,
          status: "skipped",
          reason: "outside_coach_window",
        });
        continue;
      }

      if (
        body.scheduled &&
        !body.force &&
        (await reachedDailySendLimit({
          ecosystemUserId: token.ecosystem_user_id,
          sourceApp: token.source_app,
        }))
      ) {
        results.push({
          ecosystemUserId: token.ecosystem_user_id,
          sourceApp: token.source_app,
          status: "skipped",
          reason: "daily_send_limit",
        });
        continue;
      }

      const nudgeCandidates = buildCoachNudgeCandidates({
        ecosystemUserId: token.ecosystem_user_id,
        sourceApp: token.source_app,
        profile: data.profile,
        today: data.today,
        recentSummaries: data.summaries,
      });
      let fallbackNudge: CoachPushNudge | undefined = body.force
        ? nudgeCandidates[0]
        : undefined;
      if (!body.force) {
        for (const candidate of nudgeCandidates) {
          const wasRecentlySent = await recentlySent({
            ecosystemUserId: token.ecosystem_user_id,
            sourceApp: token.source_app,
            nudgeType: candidate.type,
          });
          if (!wasRecentlySent) {
            fallbackNudge = candidate;
            break;
          }
        }
      }

      if (!fallbackNudge) {
        const skippedNudge = nudgeCandidates[0];
        await recordPushSend({
          ecosystemUserId: token.ecosystem_user_id,
          sourceApp: token.source_app,
          expoPushToken: token.expo_push_token,
          nudge: skippedNudge,
          status: "skipped",
          response: { reason: "all_candidates_recently_sent" },
        });
        results.push({
          ecosystemUserId: token.ecosystem_user_id,
          sourceApp: token.source_app,
          nudge: skippedNudge,
          status: "skipped",
          reason: "all_candidates_recently_sent",
        });
        continue;
      }

      const personalized = await personalizeCoachNudge({
        fallback: fallbackNudge,
        sourceApp: token.source_app,
        locale: token.preferred_locale,
        profile: data.profile,
        today: data.today,
        recentSummaries: data.summaries,
      });
      const nudge = personalized.nudge;
      const userRef = token.ecosystem_user_id.slice(-8);

      app.log.info(
        {
          dryRun: body.dryRun,
          model: personalized.model,
          nudgeType: nudge.type,
          personalizedByAi: personalized.personalizedByAi,
          sourceApp: token.source_app,
          userRef,
        },
        "Coach nudge prepared"
      );

      if (body.dryRun) {
        results.push({
          ecosystemUserId: token.ecosystem_user_id,
          sourceApp: token.source_app,
          nudge,
          status: "dry_run",
          personalizedByAi: personalized.personalizedByAi,
          model: personalized.model,
        });
        continue;
      }

      const expoResponse = await sendExpoPush({
        token: token.expo_push_token,
        nudge,
        ecosystemUserId: token.ecosystem_user_id,
        sourceApp: token.source_app,
      });
      const status = expoResponse.ok ? "sent" : "failed";
      app.log.info(
        {
          personalizedByAi: personalized.personalizedByAi,
          sourceApp: token.source_app,
          status,
          userRef,
        },
        "Coach push dispatch completed"
      );
      await recordPushSend({
        ecosystemUserId: token.ecosystem_user_id,
        sourceApp: token.source_app,
        expoPushToken: token.expo_push_token,
        nudge,
        status,
        response: {
          ...expoResponse,
          personalizedByAi: personalized.personalizedByAi,
          model: personalized.model,
        },
      });
      results.push({
        ecosystemUserId: token.ecosystem_user_id,
        sourceApp: token.source_app,
        nudge,
        status,
        personalizedByAi: personalized.personalizedByAi,
        model: personalized.model,
        response: expoResponse,
      });
    }

    return {
      ok: true,
      dryRun: body.dryRun,
      count: results.length,
      results,
    };
  });
}
