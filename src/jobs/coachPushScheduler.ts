import type { FastifyInstance } from "fastify";

const HOUR_MS = 60 * 60 * 1000;
const START_DELAY_MS = 10 * 1000;

export function startCoachPushScheduler(app: FastifyInstance) {
  if (process.env.ECOSYSTEM_PUSH_SCHEDULER_ENABLED !== "true") return;

  const adminSecret = process.env.ECOSYSTEM_PUSH_ADMIN_SECRET?.trim();
  if (!adminSecret) {
    app.log.warn(
      "AI coach push scheduler is enabled but ECOSYSTEM_PUSH_ADMIN_SECRET is missing."
    );
    return;
  }

  const run = async () => {
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/ecosystem/push-coach-nudge",
        headers: {
          "x-ecosystem-admin-secret": adminSecret,
        },
        payload: {
          dryRun: false,
          scheduled: true,
        },
      });

      if (response.statusCode >= 400) {
        app.log.error(
          { statusCode: response.statusCode, body: response.body },
          "AI coach push scheduler request failed"
        );
      } else {
        const result = response.json() as {
          count?: number;
          results?: Array<{
            personalizedByAi?: boolean;
            status?: string;
          }>;
        };
        const results = Array.isArray(result.results) ? result.results : [];
        app.log.info(
          {
            aiPersonalized: results.filter((item) => item.personalizedByAi === true).length,
            failed: results.filter((item) => item.status === "failed").length,
            sent: results.filter((item) => item.status === "sent").length,
            skipped: results.filter((item) => item.status === "skipped").length,
            total: result.count ?? results.length,
          },
          "AI coach push scheduler completed"
        );
      }
    } catch (error) {
      app.log.error(error, "AI coach push scheduler failed");
    }
  };

  const startTimer = setTimeout(() => void run(), START_DELAY_MS);
  const interval = setInterval(() => void run(), HOUR_MS);
  startTimer.unref();
  interval.unref();

  app.addHook("onClose", async () => {
    clearTimeout(startTimer);
    clearInterval(interval);
  });
}
