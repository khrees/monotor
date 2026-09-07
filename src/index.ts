import { createApp } from "./app";
import { createMonoCache } from "./lib/mono";
import { startMonoCron, getCronIntervalMinutes } from "./lib/cron";

const cache = createMonoCache();
const app = createApp(cache);
const port = Number(process.env.PORT ?? 3000);

if (process.env.DISABLE_CRON !== "true" && process.env.NODE_ENV !== "test") {
  const intervalMinutes = getCronIntervalMinutes();
  const cron = startMonoCron(cache, { intervalMinutes, runOnStart: true });
  console.log(`[cron] polling ${process.env.STATUS_API_BASE ?? "https://status.mono.co/api/v2"} every ${cron.intervalMinutes}m (set CRON_INTERVAL_MINUTES to override, DISABLE_CRON=true to disable)`);
}

app.listen(port, () => {
  console.log(`🦊 monotor running at http://localhost:${port} — GET /api/incidents`);
});

export type { App } from "./app";
