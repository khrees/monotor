import { describe, expect, it } from "bun:test";
import { startMonoCron, getCronIntervalMinutes } from "../src/lib/cron";
import { createMonoCache } from "../src/lib/mono";

const SAMPLE_STATUSPAGE_PAYLOAD = JSON.stringify({
  incidents: [
    {
      id: "abc123",
      name: "Direct Debit: Intermittent Downtime",
      status: "identified",
      impact: "major",
      created_at: "2026-09-04T17:46:59+01:00",
      started_at: "2026-09-04T17:46:59+01:00",
      resolved_at: null,
      updated_at: "2026-09-04T17:46:59+01:00",
      shortlink: "https://stspg.io/abc123",
      incident_updates: [
        {
          id: "u1",
          status: "identified",
          body: "downtime from NIBSS.",
          created_at: "2026-09-04T17:46:59+01:00",
          updated_at: "2026-09-04T17:46:59+01:00",
          display_at: "2026-09-04T17:46:59+01:00",
          affected_components: [],
        },
      ],
      components: [],
    },
  ],
});

describe("cron", () => {
  it("getCronIntervalMinutes defaults to 30, respects env", () => {
    const prev = process.env.CRON_INTERVAL_MINUTES;
    delete process.env.CRON_INTERVAL_MINUTES;
    delete process.env.RSS_POLL_INTERVAL_MINUTES;
    expect(getCronIntervalMinutes()).toBe(30);
    process.env.CRON_INTERVAL_MINUTES = "15";
    expect(getCronIntervalMinutes()).toBe(15);
    process.env.CRON_INTERVAL_MINUTES = "0";
    expect(getCronIntervalMinutes()).toBe(30);
    if (prev) process.env.CRON_INTERVAL_MINUTES = prev;
    else delete process.env.CRON_INTERVAL_MINUTES;
  });

  it("startMonoCron ticks and caches", async () => {
    const fetcher = async () =>
      new Response(SAMPLE_STATUSPAGE_PAYLOAD, { status: 200, headers: { "Content-Type": "application/json" } });
    const cache = createMonoCache(60_000);
    // prime cache via cron tick (cron uses cache.get which calls fetcher)
    // inject fetcher by temporarily monkey-patching fetch
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = fetcher;
    const ticks: any[] = [];
    const cron = startMonoCron(cache, { intervalMinutes: 30, runOnStart: false, onTick: (r) => ticks.push(r) });
    await cron.tick();
    expect(ticks.length).toBe(1);
    expect(ticks[0].active).toBe(1);
    expect(ticks[0].has_active_downtime).toBe(true);
    cron.stop();
    (globalThis as any).fetch = origFetch;
  });
});
