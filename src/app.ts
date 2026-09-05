import { Elysia } from "elysia";
import { healthRoutes } from "./routes/health";
import { createMonoRoutes } from "./routes/mono";
import { createMonoCache } from "./lib/mono";

export function createApp(cache = createMonoCache()) {
  return new Elysia()
    .get("/", () => ({
      name: "mono-uptime",
      version: "0.2.0",
      docs: "/api/incidents",
      endpoints: ["/health", "/api/incidents", "/api/incidents/:id"],
    }))
    .use(healthRoutes)
    .use(createMonoRoutes(cache))
    .onError(({ code, error, set }) => {
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "not_found", message: "Not found" };
      }
      if (code === "VALIDATION") {
        set.status = 422;
        return { error: "validation_error", message: error.message };
      }
      console.error(error);
      set.status = 500;
      return { error: "internal_error", message: "Internal server error" };
    });
}

export type App = ReturnType<typeof createApp>;
