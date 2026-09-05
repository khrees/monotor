import { describe, expect, it } from "bun:test";
import { parseMonoRss, isIncidentActive, stripHtml, extractLatestStatus, createMonoCache, extractIncidentId, filterIncidents } from "../src/lib/mono";
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

  it("classifies BVN iGree as both lookup (Identity) and direct_debit (mandate authorization)", () => {
    const c = classifyIncident("BVN [iGree] OTP failure", "OTP delivery failure for BVN iGree", "");
    expect(c.products).toContain("lookup");
    expect(c.products).toContain("direct_debit");
    expect(c.affected_services).toContain("otp");
    expect(c.affected_services).toContain("bvn_igree");
    expect(c.outage_type).toBe("otp_failure");
  });

  it("classifies Prove as a standalone identity verification product", () => {
    const c = classifyIncident("Prove Verification Downtime", "users are encountering challenges on the Prove widget", "");
    expect(c.products).toContain("prove");
    expect(c.products).not.toContain("lookup");
    expect(c.affected_services).toContain("prove_verification");
  });

  it("classifies bank outages under Connect (Financial Data) with auth_method", () => {
    const mobileInc = classifyIncident(
      "FCMB Mobile (Authentication Outage)",
      "users are encountering challenges in authenticating with their FCMB mobile details. The internet banking authentication method remains unaffected.",
      ""
    );
    expect(mobileInc.products).toContain("connect");
    expect(mobileInc.affected_services).toContain("bank_auth");
    expect(mobileInc.provider).toBe("FCMB");
    expect(mobileInc.institution).toBe("FCMB");
    expect(mobileInc.auth_method).toBe("mobile");
    expect(mobileInc.scope).toBe("institution");

    const internetInc = classifyIncident(
      "FCMB Internet Downtime",
      "users are encountering challenges in authenticating with their FCMB internet details.",
      ""
    );
    expect(internetInc.auth_method).toBe("internet");
    expect(internetInc.institution).toBe("FCMB");
  });
});

describe("filterIncidents", () => {
  it("filters by canonical product", () => {
    const incidents = parseMonoRss(SAMPLE_RSS);
    const filtered = filterIncidents(incidents, { product: "lookup" });
    expect(filtered.length).toBe(2);
    for (const inc of filtered) {
      expect(inc.products).toContain("lookup");
    }
  });

  it("resolves product aliases (kyc, bvn -> lookup)", () => {
    const incidents = parseMonoRss(SAMPLE_RSS);
    const kycFiltered = filterIncidents(incidents, { product: "kyc" });
    const bvnFiltered = filterIncidents(incidents, { product: "bvn" });
    expect(kycFiltered.length).toBe(2);
    expect(bvnFiltered.length).toBe(2);
  });

  it("filters by connect product", () => {
    const incidents = parseMonoRss(SAMPLE_RSS);
    const filtered = filterIncidents(incidents, { product: "connect" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("ht4433g0pl6s");
  });

  it("filters by severity", () => {
    const incidents = parseMonoRss(SAMPLE_RSS);
    const filtered = filterIncidents(incidents, { severity: "minor" });
    expect(filtered.length).toBeGreaterThan(0);
    for (const inc of filtered) expect(inc.severity).toBe("minor");
  });

  it("filters by multiple criteria", () => {
    const incidents = parseMonoRss(SAMPLE_RSS);
    const filtered = filterIncidents(incidents, { product: "direct_debit", status: "identified" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("yqbzdtffykhm");
  });

  it("returns all when no filters", () => {
    const incidents = parseMonoRss(SAMPLE_RSS);
    const filtered = filterIncidents(incidents, {});
    expect(filtered.length).toBe(incidents.length);
  });
});

describe("parseMonoRss", () => {
  it("parses, sorts desc, id is slug only, link is full url, description is plain text", () => {
    const incidents = parseMonoRss(SAMPLE_RSS);
    expect(incidents.length).toBe(4);
    expect(incidents[0].title).toBe("Direct Debit: Intermittent Downtime");
    expect(incidents[0].is_ongoing).toBe(true);
    expect(incidents[0].id).toBe("yqbzdtffykhm");
    expect(incidents[0].link).toBe("https://status.mono.co/incidents/yqbzdtffykhm");
    expect(incidents[0].description).not.toContain("<strong>");
    expect(incidents[0].description).toContain("mandate approval");
    expect((incidents[0] as any).guid).toBeUndefined();
    expect((incidents[0] as any).timestamp).toBeUndefined();
    expect(incidents[0].products).toContain("direct_debit");
    expect(incidents[0].status).toBe("Identified");
    expect(incidents[0].published_at).toContain("2026-09-04");
  });
});

describe("GET /api/incidents", () => {
  function mockFetcher(xml: string) {
    return async () => new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
  }

  it("returns DOWNTIME_DETECTED with default limit=20", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe("DOWNTIME_DETECTED");
    expect(body.has_active_downtime).toBe(true);
    expect(body.active_incidents[0].id).toBe("yqbzdtffykhm");
    expect(body.pagination.total).toBe(4);
    expect(body.pagination.limit).toBe(20);
  });

  it("filters by product, service, severity, status", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);

    const byProduct = await app.handle(new Request("http://localhost/api/incidents?product=connect")).then((r) => r.json()) as any;
    expect(byProduct.incidents.length).toBe(1);
    expect(byProduct.incidents[0].products).toContain("connect");

    const byLookup = await app.handle(new Request("http://localhost/api/incidents?product=lookup")).then((r) => r.json()) as any;
    expect(byLookup.incidents.length).toBe(2);

    const byService = await app.handle(new Request("http://localhost/api/incidents?service=mandate_approval")).then((r) => r.json()) as any;
    expect(byService.incidents.length).toBe(1);

    const bySeverity = await app.handle(new Request("http://localhost/api/incidents?severity=minor")).then((r) => r.json()) as any;
    expect(bySeverity.incidents.length).toBeGreaterThan(0);
    for (const inc of bySeverity.incidents) expect(inc.severity).toBe("minor");

    const byStatus = await app.handle(new Request("http://localhost/api/incidents?status=identified")).then((r) => r.json()) as any;
    expect(byStatus.incidents.length).toBe(1);
    expect(byStatus.incidents[0].status).toBe("Identified");
  });

  it("resolves product alias in route (?product=kyc -> lookup)", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?product=kyc"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.incidents.length).toBe(2);
  });

  it("rejects invalid product with 422", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?product=not_a_product"));
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBe("invalid_param");
    expect(body.message).toContain("Invalid product");
  });

  it("rejects invalid severity with 422", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?severity=critial"));
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBe("invalid_param");
  });

  it("rejects invalid status with 422", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?status=pending"));
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBe("invalid_param");
  });

  it("offset + limit pagination", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const p1: any = await app.handle(new Request("http://localhost/api/incidents?limit=1&offset=0")).then((r) => r.json());
    expect(p1.incidents.length).toBe(1);
    expect(p1.incidents[0].id).toBe("yqbzdtffykhm");
    expect(p1.pagination.total).toBe(4);
    expect(p1.pagination.returned).toBe(1);
    const p2: any = await app.handle(new Request("http://localhost/api/incidents?limit=1&offset=1")).then((r) => r.json());
    expect(p2.incidents[0].id).toBe("0nsyqp86mt6m");
    const both: any = await app.handle(new Request("http://localhost/api/incidents?limit=2&offset=1")).then((r) => r.json());
    expect(both.incidents.length).toBe(2);
  });

  it("ongoing=true filters incidents to active only", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res: any = await app.handle(new Request("http://localhost/api/incidents?ongoing=true")).then((r) => r.json());
    expect(res.incidents.length).toBe(3);
    for (const inc of res.incidents) expect(inc.is_ongoing).toBe(true);
  });

  it("filters by status across all incidents", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const filtered: any = await app.handle(new Request("http://localhost/api/incidents?status=investigating")).then((r) => r.json());
    expect(filtered.incidents.length).toBe(2);
    for (const inc of filtered.incidents) expect(inc.status.toLowerCase()).toBe("investigating");
  });

  it("GET /api/incidents/:id resolves by id", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents/yqbzdtffykhm"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.id).toBe("yqbzdtffykhm");
    expect(body.status).toBe("Identified");
  });

  it("single bank outage (FCMB) marks product as DEGRADED, not DOWN", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?product=connect"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    // Connect platform itself is NOT down!
    expect(body.status).toBe("DEGRADED");
    expect(body.has_active_downtime).toBe(false);
    expect(body.has_degraded_service).toBe(true);
    expect(body.active_incidents_count).toBe(1);
    expect(body.active_incidents[0].provider).toBe("FCMB");
    expect(body.active_incidents[0].scope).toBe("institution");
  });

  it("filters by institution and auth_method — mobile down does not take internet down", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);

    // GTBank is not experiencing any downtime
    const gtbank = await app.handle(new Request("http://localhost/api/incidents?product=connect&institution=gtbank")).then((r) => r.json()) as any;
    expect(gtbank.status).toBe("OPERATIONAL");
    expect(gtbank.has_active_downtime).toBe(false);
    expect(gtbank.active_incidents_count).toBe(0);

    // FCMB without specifying auth_method is DEGRADED (since only mobile is down, internet still works)
    const fcmb = await app.handle(new Request("http://localhost/api/incidents?product=connect&institution=fcmb")).then((r) => r.json()) as any;
    expect(fcmb.status).toBe("DEGRADED");
    expect(fcmb.has_active_downtime).toBe(false);
    expect(fcmb.has_degraded_service).toBe(true);
    expect(fcmb.active_incidents_count).toBe(1);
    expect(fcmb.active_incidents[0].auth_method).toBe("mobile");

    // FCMB with auth_method=mobile is DOWNTIME_DETECTED
    const fcmbMobile = await app.handle(new Request("http://localhost/api/incidents?product=connect&institution=fcmb&auth_method=mobile")).then((r) => r.json()) as any;
    expect(fcmbMobile.status).toBe("DOWNTIME_DETECTED");
    expect(fcmbMobile.has_active_downtime).toBe(true);
    expect(fcmbMobile.active_incidents_count).toBe(1);

    // FCMB with auth_method=internet is OPERATIONAL (internet banking is unaffected!)
    const fcmbInternet = await app.handle(new Request("http://localhost/api/incidents?product=connect&institution=fcmb&auth_method=internet")).then((r) => r.json()) as any;
    expect(fcmbInternet.status).toBe("OPERATIONAL");
    expect(fcmbInternet.has_active_downtime).toBe(false);
    expect(fcmbInternet.has_degraded_service).toBe(false);
    expect(fcmbInternet.active_incidents_count).toBe(0);
  });

  it("rejects invalid auth_method with 422", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?auth_method=ussd"));
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBe("invalid_param");
    expect(body.message).toContain("Invalid auth_method");
  });

  it("rejects invalid scope with 422", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher(SAMPLE_RSS) as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?scope=global"));
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBe("invalid_param");
    expect(body.message).toContain("Invalid scope");
  });
});

