import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";

const eventBodySchema = z.object({
  ecosystemUserId: z.string().uuid(),
  sourceApp: z.enum(["fitmacro", "fitface"]),
  eventType: z.enum([
    "brief_viewed",
    "brief_action_opened",
    "meal_logged",
    "daily_tracking_updated",
    "scan_completed",
    "workout_opened",
    "ai_chat_sent",
  ]),
  metadata: z.record(z.unknown()).optional(),
});

let ensureCoachEventsSchemaPromise: Promise<void> | null = null;

async function ensureCoachEventsSchema(): Promise<void> {
  if (!ensureCoachEventsSchemaPromise) {
    ensureCoachEventsSchemaPromise = pool
      .query(`
        create table if not exists ecosystem_coach_events (
          id uuid primary key default gen_random_uuid(),
          ecosystem_user_id uuid not null references ecosystem_users(ecosystem_user_id) on delete cascade,
          source_app text not null check (source_app in ('fitmacro', 'fitface')),
          event_type text not null check (
            event_type in (
              'brief_viewed',
              'brief_action_opened',
              'meal_logged',
              'daily_tracking_updated',
              'scan_completed',
              'workout_opened',
              'ai_chat_sent'
            )
          ),
          metadata jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        );
        create index if not exists idx_coach_events_user_created_at
          on ecosystem_coach_events(ecosystem_user_id, created_at desc);
        create index if not exists idx_coach_events_type_created_at
          on ecosystem_coach_events(event_type, created_at desc);
      `)
      .then(() => undefined);
  }

  await ensureCoachEventsSchemaPromise;
}

export async function registerCoachEventRoutes(app: FastifyInstance) {
  app.post("/v1/ecosystem/coach-event", async (request) => {
    const body = eventBodySchema.parse(request.body ?? {});
    await ensureCoachEventsSchema();

    const result = await pool.query(
      `insert into ecosystem_coach_events (
         ecosystem_user_id, source_app, event_type, metadata
       ) values ($1, $2, $3, $4)
       returning id, ecosystem_user_id, source_app, event_type, metadata, created_at`,
      [
        body.ecosystemUserId,
        body.sourceApp,
        body.eventType,
        JSON.stringify(body.metadata ?? {}),
      ]
    );

    const row = result.rows[0];
    return {
      ok: true,
      event: {
        id: row.id,
        ecosystemUserId: row.ecosystem_user_id,
        sourceApp: row.source_app,
        eventType: row.event_type,
        metadata: row.metadata,
        createdAt: row.created_at,
      },
    };
  });
}
