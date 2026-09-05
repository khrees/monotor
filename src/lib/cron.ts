import { createMonoCache } from "./mono";

export type CronOptions = {
  intervalMinutes: number;
  runOnStart?: boolean;
  onTick?: (result: { at: string; total: number; active: number; has_active_downtime: boolean }) => void;
  onError?: (err: Error) => void;
};

export function startMonoCron(cache = createMonoCache(), opts: CronOptions = { intervalMinutes: 30 }) {
  const intervalMs = opts.intervalMinutes * 60 * 1000;

  let timer: Timer | null = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const { incidents } = await cache.get();
      const active = incidents.filter((i) => i.is_ongoing).length;
      const at = new Date().toISOString();
      const payload = { at, total: incidents.length, active, has_active_downtime: active > 0 };
      console.log(`[cron] ${at} polled ${payload.total} incidents, active=${payload.active} has_downtime=${payload.has_active_downtime}`);
      opts.onTick?.(payload);
    } catch (e: any) {
      console.error(`[cron] poll failed: ${e?.message ?? e}`);
      opts.onError?.(e);
    } finally {
      running = false;
    }
  }

  if (opts.runOnStart ?? true) tick();
  timer = setInterval(tick, intervalMs);

  if (timer && typeof (timer as any).unref === "function") (timer as any).unref();

  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
    intervalMinutes: opts.intervalMinutes,
  };
}

export function getCronIntervalMinutes(): number {
  const raw = process.env.CRON_INTERVAL_MINUTES ?? process.env.RSS_POLL_INTERVAL_MINUTES ?? "30";
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 1440) return 30;
  return Math.floor(n);
}
