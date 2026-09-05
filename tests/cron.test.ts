import { describe, expect, it } from "bun:test";
import { startMonoCron, getCronIntervalMinutes } from "../src/lib/cron";
import { createMonoCache } from "../src/lib/mono";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><item><title>Direct Debit: Intermittent Downtime</title><description>&lt;p&gt;&lt;strong&gt;Identified&lt;/strong&gt; - downtime from NIBSS.&lt;/p&gt;</description><pubDate>Fri, 04 Sep 2026 17:46:59 +0100</pubDate><link>https://status.mono.co/incidents/abc123</link><guid>https://status.mono.co/incidents/abc123</guid></item></channel></rss>`;

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
    const fetcher = async () => new Response(SAMPLE_RSS, { status: 200 });
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
