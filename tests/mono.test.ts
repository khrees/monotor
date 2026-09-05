import { describe, expect, it } from "bun:test";
import { parseMonoRss, isIncidentActive, stripHtml, extractLatestStatus, createMonoCache, extractIncidentId } from "../src/lib/mono";
import { classifyIncident } from "../src/lib/classify";
import { createApp } from "../src/app";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Mono Status - Incident History</title>
<item>
  <title>Direct Debit: Intermittent Downtime</title>
  <description>&lt;p&gt;&lt;strong&gt;Identified&lt;/strong&gt; - debit processing is relatively stable now. However, mandate approval is still experiencing downtime from NIBSS.&lt;/p&gt;</description>
  <pubDate>Fri, 04 Sep 2026 17:46:59 +0100</pubDate>
  <link>https://status.mono.co/incidents/yqbzdtffykhm</link>
  <guid>https://status.mono.co/incidents/yqbzdtffykhm</guid>
</item>
<item>
  <title>Degraded Performance Across Lookup APIs</title>
  <description>&lt;p&gt;&lt;strong&gt;Resolved&lt;/strong&gt; - NIN Lookup has been resolved.&lt;/p&gt;</description>
  <pubDate>Wed, 26 Aug 2026 17:51:40 +0100</pubDate>
  <link>https://status.mono.co/incidents/0nsyqp86mt6m</link>
  <guid>https://status.mono.co/incidents/0nsyqp86mt6m</guid>
</item>
<item>
  <title>BVN [iGree] OTP failure</title>
  <description>&lt;p&gt;&lt;strong&gt;Investigating&lt;/strong&gt; - OTP delivery failure for BVN iGree.&lt;/p&gt;</description>
  <pubDate>Sat, 08 Aug 2026 16:07:52 +0100</pubDate>
  <link>https://status.mono.co/incidents/n2d2rgjp754x</link>
  <guid>https://status.mono.co/incidents/n2d2rgjp754x</guid>
</item>
<item>
  <title>FCMB Mobile (Authentication Outage)</title>
  <description>&lt;p&gt;&lt;strong&gt;Investigating&lt;/strong&gt; - FCMB mobile authentication failing.&lt;/p&gt;</description>
  <pubDate>Fri, 18 Apr 2025 17:53:52 +0100</pubDate>
  <link>https://status.mono.co/incidents/ht4433g0pl6s</link>
  <guid>https://status.mono.co/incidents/ht4433g0pl6s</guid>
</item>
</channel></rss>`;

describe("stripHtml / extractLatestStatus / isIncidentActive / extractIncidentId", () => {
  it("stripHtml removes tags", () => {
    expect(stripHtml("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
  });
  it("extractLatestStatus picks first strong", () => {
    expect(extractLatestStatus("<p><strong>Identified</strong> - stuff</p>")).toBe("Identified");
    expect(extractLatestStatus("no strong")).toBeNull();
  });
  it("extractIncidentId gets id from url", () => {
    expect(extractIncidentId("https://status.mono.co/incidents/z73t7c14r4f4")).toBe("z73t7c14r4f4");
    expect(extractIncidentId("https://status.mono.co/incidents/z73t7c14r4f4/")).toBe("z73t7c14r4f4");
    expect(extractIncidentId("z73t7c14r4f4")).toBe("z73t7c14r4f4");
  });
  it("active when Investigating/Identified without Resolved", () => {
    expect(isIncidentActive({ title: "Downtime", description: "<strong>Investigating</strong> - outage" })).toBe(true);
  });
  it("not active when Resolved", () => {
    expect(isIncidentActive({ title: "Service Downtime", description: "<strong>Resolved</strong> - done" })).toBe(false);
  });
});

describe("classifyIncident", () => {
  it("classifies direct_debit with mandate_approval + NIBSS", () => {
    const c = classifyIncident("Direct Debit: Intermittent Downtime", "mandate approval is still experiencing downtime from NIBSS", "");
    expect(c.products).toContain("direct_debit");
    expect(c.affected_services).toContain("mandate_approval");
    expect(c.provider).toBe("NIBSS");
    expect(c.outage_type).toBe("intermittent_downtime");
  });
  it("classifies BVN OTP failure", () => {
    const c = classifyIncident("BVN [iGree] OTP failure", "OTP delivery failure for BVN iGree", "");
    expect(c.products).toContain("bvn");
    expect(c.affected_services).toContain("otp");
    expect(c.outage_type).toBe("otp_failure");
  });
});

describe("parseMonoRss with simplification", () => {
  it("parses, sorts desc, guid is id only, link is full url, description is plain text, status field", () => {
    const incidents = parseMonoRss(SAMPLE_RSS);
    expect(incidents.length).toBe(4);
    expect(incidents[0].title).toBe("Direct Debit: Intermittent Downtime");
    expect(incidents[0].is_ongoing).toBe(true);
    expect(incidents[0].guid).toBe("yqbzdtffykhm");
    expect(incidents[0].link).toBe("https://status.mono.co/incidents/yqbzdtffykhm");
    expect(incidents[0].description).not.toContain("<strong>");
    expect(incidents[0].description).toContain("mandate approval");
    expect((incidents[0] as any).description_text).toBeUndefined();
    expect((incidents[0] as any).latest_status).toBeUndefined();
    expect(incidents[0].products).toContain("direct_debit");
    expect(incidents[0].status).toBe("Identified");
    expect(incidents[0].published_at).toContain("2026-09-04");
  });
});

describe("GET /api/uptime snake_case + query params", () => {
  function mockFetcher(xml: string) {
    return async () => new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
  }

  it("returns DOWNTIME_DETECTED without summary by default, new route /api/uptime", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/uptime"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe("DOWNTIME_DETECTED");
    expect(body.has_active_downtime).toBe(true);
    expect(body.active_incidents[0].guid).toBe("yqbzdtffykhm");
    expect(body.summary).toBeUndefined();
    expect(body.pagination.total).toBe(4);
  });

  it("/api/status is gone (404)", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/status"));
    expect(res.status).toBe(404);
  });

  it("includes summary when include_summary=true", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/uptime?include_summary=true"));
    const body: any = await res.json();
    expect(body.summary.by_product.direct_debit).toBe(1);
    expect(body.summary.by_service.mandate_approval).toBe(1);
  });

  it("filters by product, service, severity, status", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const byProduct = await app.handle(new Request("http://localhost/api/uptime?product=lookup")).then((r) => r.json()) as any;
    expect(byProduct.all_incidents.length).toBe(1);
    expect(byProduct.all_incidents[0].products).toContain("lookup");

    const byService = await app.handle(new Request("http://localhost/api/uptime?service=mandate_approval")).then((r) => r.json()) as any;
    expect(byService.all_incidents.length).toBe(1);

    const bySeverity = await app.handle(new Request("http://localhost/api/uptime?severity=minor")).then((r) => r.json()) as any;
    expect(bySeverity.all_incidents.length).toBeGreaterThan(0);
    for (const inc of bySeverity.all_incidents) expect(inc.severity).toBe("minor");

    const byStatus = await app.handle(new Request("http://localhost/api/uptime?status=identified")).then((r) => r.json()) as any;
    expect(byStatus.all_incidents.length).toBe(1);
    expect(byStatus.all_incidents[0].status).toBe("Identified");
  });

  it("offset + limit pagination", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const p1: any = await app.handle(new Request("http://localhost/api/uptime?limit=1&offset=0")).then((r) => r.json());
    expect(p1.all_incidents.length).toBe(1);
    expect(p1.all_incidents[0].guid).toBe("yqbzdtffykhm");
    expect(p1.pagination.total).toBe(4);
    expect(p1.pagination.returned).toBe(1);
    const p2: any = await app.handle(new Request("http://localhost/api/uptime?limit=1&offset=1")).then((r) => r.json());
    expect(p2.all_incidents[0].guid).toBe("0nsyqp86mt6m");
    const both: any = await app.handle(new Request("http://localhost/api/uptime?limit=2&offset=1")).then((r) => r.json());
    expect(both.all_incidents.length).toBe(2);
  });

  it("GET /api/history with offset/limit/severity/status", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res: any = await app.handle(new Request("http://localhost/api/history?limit=1&offset=1")).then((r) => r.json());
    expect(res.incidents.length).toBe(1);
    expect(res.incidents[0].guid).toBe("0nsyqp86mt6m");
    expect(res.pagination.offset).toBe(1);
    const filtered: any = await app.handle(new Request("http://localhost/api/history?status=investigating")).then((r) => r.json());
    expect(filtered.incidents.length).toBe(2);
    for (const inc of filtered.incidents) expect(inc.status.toLowerCase()).toBe("investigating");
  });

  it("GET /api/incidents/:guid resolves by id only", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents/yqbzdtffykhm"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.guid).toBe("yqbzdtffykhm");
    expect(body.status).toBe("Identified");
  });
});
