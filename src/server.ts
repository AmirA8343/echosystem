import "dotenv/config";
import Fastify from "fastify";
import { registerCoachContextRoutes } from "./routes/coachContext.js";
import { registerDailySummaryRoutes } from "./routes/dailySummary.js";
import { registerLinkRoutes } from "./routes/link.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerUserRoutes } from "./routes/user.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

await registerLinkRoutes(app);
await registerUserRoutes(app);
await registerProfileRoutes(app);
await registerDailySummaryRoutes(app);
await registerCoachContextRoutes(app);

const port = Number(process.env.PORT || 8081);
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
