import "dotenv/config";
import Fastify from "fastify";
import { ZodError } from "zod";
import { startCoachPushScheduler } from "./jobs/coachPushScheduler.js";
import { isMicronutrientCoachingEnabled } from "./lib/micronutrientCoach.js";
import { registerCoachBriefRoutes } from "./routes/coachBrief.js";
import { registerCoachContextRoutes } from "./routes/coachContext.js";
import { registerCoachEventRoutes } from "./routes/coachEvent.js";
import { registerDailySummaryRoutes } from "./routes/dailySummary.js";
import { registerLinkRoutes } from "./routes/link.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerPushRoutes } from "./routes/push.js";
import { registerUserRoutes } from "./routes/user.js";
import { registerWeeklyCoachRoutes } from "./routes/weeklyCoach.js";

const app = Fastify({ logger: true });

app.log.info(
  { enabled: isMicronutrientCoachingEnabled() },
  "Micronutrient coaching feature flag loaded"
);

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "Invalid request.",
      issues: error.issues,
    });
  }

  app.log.error(error);
  return reply.code(500).send({
    error: "Internal Server Error",
  });
});

app.get("/health", async () => ({ ok: true }));

await registerLinkRoutes(app);
await registerUserRoutes(app);
await registerProfileRoutes(app);
await registerDailySummaryRoutes(app);
await registerCoachContextRoutes(app);
await registerCoachBriefRoutes(app);
await registerCoachEventRoutes(app);
await registerPushRoutes(app);
await registerWeeklyCoachRoutes(app);
startCoachPushScheduler(app);

const port = Number(process.env.PORT || 8081);
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
