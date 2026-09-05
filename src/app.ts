import { Elysia } from "elysia";
import { healthRoutes } from "./routes/health";
import { createMonoRoutes } from "./routes/mono";
import { createMonoCache } from "./lib/mono";

export function createApp(cache = createMonoCache()) {
  return new Elysia()
    .get("/", () => ({
      name: "mono-uptime",
      version: "0.1.0",
      docs: "/api/uptime",
      endpoints: ["/health", "/api/uptime", "/api/history", "/api/incidents/:guid"],
    }))
    .use(healthRoutes)
    .use(createMonoRoutes(cache))
    .onError(({ code, error, set }) => {
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "Not found" };
      }
      console.error(error);
      set.status = 500;
      return { error: "Internal server error" };
    });
}

export type App = ReturnType<typeof createApp>;
