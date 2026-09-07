import { describe, expect, it } from "bun:test";
import {
  parseStatuspageJson,
  mergeAndParseStatuspageJson,
  transformStatuspageIncident,
  fetchMonoFeed,
  createMonoCache,
  filterIncidents,
  type StatuspageIncidentRaw,
} from "../src/lib/mono";
import { classifyIncident } from "../src/lib/classify";
import { createApp } from "../src/app";

const SAMPLE_INCIDENTS_RAW: StatuspageIncidentRaw[] = [
  {
    id: "yqbzdtffykhm",
    name: "Direct Debit: Intermittent Downtime",
    status: "identified",
    impact: "major",
    created_at: "2026-09-04T17:46:59+01:00",
    started_at: "2026-09-04T17:46:59+01:00",
    resolved_at: null,
    updated_at: "2026-09-04T17:46:59+01:00",
    shortlink: "https://status.mono.co/incidents/yqbzdtffykhm",
    incident_updates: [
      {
        id: "u1",
        status: "identified",
        body: "debit processing is relatively stable now. However, mandate approval is still experiencing downtime from NIBSS.",
        created_at: "2026-09-04T17:46:59+01:00",
        updated_at: "2026-09-04T17:46:59+01:00",
        display_at: "2026-09-04T17:46:59+01:00",
        affected_components: [
          {
            code: "c1",
            name: "Direct Debit - Mandate Approval",
            old_status: "operational",
            new_status: "degraded_performance",
          },
        ],
      },
    ],
    components: [{ id: "c1", name: "Mandate Approval", status: "operational" }],
  },
  {
    id: "0nsyqp86mt6m",
    name: "Degraded Performance Across Lookup APIs",
    status: "resolved",
    impact: "minor",
    created_at: "2026-08-26T17:51:40+01:00",
    started_at: "2026-08-26T17:51:40+01:00",
    resolved_at: "2026-08-26T17:51:40+01:00",
    updated_at: "2026-08-26T17:51:40+01:00",
    shortlink: "https://status.mono.co/incidents/0nsyqp86mt6m",
    incident_updates: [
      {
        id: "u2",
        status: "resolved",
        body: "NIN Lookup has been resolved.",
        created_at: "2026-08-26T17:51:40+01:00",
        updated_at: "2026-08-26T17:51:40+01:00",
        display_at: "2026-08-26T17:51:40+01:00",
        affected_components: [],
      },
    ],
    components: [{ id: "c2", name: "NIN Lookup", status: "operational" }],
  },
  {
    id: "n2d2rgjp754x",
    name: "BVN [iGree] OTP failure",
    status: "investigating",
    impact: "minor",
    created_at: "2026-08-08T16:07:52+01:00",
    started_at: "2026-08-08T16:07:52+01:00",
    resolved_at: null,
    updated_at: "2026-08-08T16:07:52+01:00",
    shortlink: "https://status.mono.co/incidents/n2d2rgjp754x",
    incident_updates: [
      {
        id: "u3",
        status: "investigating",
        body: "OTP delivery failure for BVN iGree.",
        created_at: "2026-08-08T16:07:52+01:00",
        updated_at: "2026-08-08T16:07:52+01:00",
        display_at: "2026-08-08T16:07:52+01:00",
        affected_components: [],
      },
    ],
    components: [{ id: "c3", name: "BVN iGree", status: "operational" }],
  },
  {
    id: "ht4433g0pl6s",
    name: "FCMB Mobile (Authentication Outage)",
    status: "investigating",
    impact: "major",
    created_at: "2025-04-18T17:53:52+01:00",
    started_at: "2025-04-18T17:53:52+01:00",
    resolved_at: null,
    updated_at: "2025-04-18T17:53:52+01:00",
    shortlink: "https://status.mono.co/incidents/ht4433g0pl6s",
    incident_updates: [
      {
        id: "u4",
        status: "investigating",
        body: "FCMB mobile authentication failing. Internet banking remains unaffected.",
        created_at: "2025-04-18T17:53:52+01:00",
        updated_at: "2025-04-18T17:53:52+01:00",
        display_at: "2025-04-18T17:53:52+01:00",
        affected_components: [],
      },
    ],
    components: [{ id: "c4", name: "FCMB", status: "operational" }],
  },
];

const SAMPLE_STATUSPAGE_JSON = JSON.stringify({ incidents: SAMPLE_INCIDENTS_RAW });

describe("transformStatuspageIncident & parseStatuspageJson", () => {
  it("parses, sorts desc, id is slug only, link is full url, description is formatted", () => {
    const incidents = parseStatuspageJson(SAMPLE_STATUSPAGE_JSON);
    expect(incidents.length).toBe(4);
    expect(incidents[0].title).toBe("Direct Debit: Intermittent Downtime");
    expect(incidents[0].is_ongoing).toBe(true);
    expect(incidents[0].id).toBe("yqbzdtffykhm");
    expect(incidents[0].link).toBe("https://status.mono.co/incidents/yqbzdtffykhm");
    expect(incidents[0].description).toContain("mandate approval");
    expect(incidents[0].products).toContain("direct_debit");
    expect(incidents[0].status).toBe("Identified");
    expect(incidents[0].published_at).toContain("2026-09-04");
  });

  it("marks ongoing=true when status is investigating or identified", () => {
    const inc = transformStatuspageIncident(SAMPLE_INCIDENTS_RAW[0]);
    expect(inc.is_ongoing).toBe(true);
    expect(inc.status).toBe("Identified");
  });

  it("marks ongoing=false when status is resolved", () => {
    const inc = transformStatuspageIncident(SAMPLE_INCIDENTS_RAW[1]);
    expect(inc.is_ongoing).toBe(false);
    expect(inc.status).toBe("Resolved");
  });

  it("mergeAndParseStatuspageJson merges unresolved onto historical with deduplication", () => {
    const historical = [
      {
        ...SAMPLE_INCIDENTS_RAW[0],
        status: "resolved",
        resolved_at: "2026-09-05T09:00:00Z",
      },
      SAMPLE_INCIDENTS_RAW[1],
    ];
    const unresolved = [
      {
        ...SAMPLE_INCIDENTS_RAW[0],
        status: "investigating",
        incident_updates: [
          {
            ...SAMPLE_INCIDENTS_RAW[0].incident_updates![0],
            status: "investigating",
          },
        ],
        resolved_at: null,
      },
    ];

    const merged = mergeAndParseStatuspageJson({ unresolved, historical });
    expect(merged.length).toBe(2);
    const inc0 = merged.find((i) => i.id === "yqbzdtffykhm");
    expect(inc0?.is_ongoing).toBe(true);
    expect(inc0?.status).toBe("Investigating");
  });
});

describe("classifyIncident", () => {
  it("classifies direct_debit with mandate_approval + NIBSS and tags payments", () => {
    const c = classifyIncident("Direct Debit: Intermittent Downtime", "mandate approval is still experiencing downtime from NIBSS");
    expect(c.products).toContain("direct_debit");
    expect(c.products).toContain("payments"); // DD is part of Payments suite
    expect(c.affected_services).toContain("mandate_approval");
    expect(c.provider).toBe("NIBSS");
    expect(c.outage_type).toBe("intermittent_downtime");
  });

  it("classifies BVN iGree as both lookup (Identity) and direct_debit (mandate authorization)", () => {
    const c = classifyIncident("BVN [iGree] OTP failure", "OTP delivery failure for BVN iGree");
    expect(c.products).toContain("lookup");
    expect(c.products).toContain("direct_debit");
    expect(c.affected_services).toContain("otp");
    expect(c.affected_services).toContain("bvn_igree");
    expect(c.outage_type).toBe("otp_failure");
  });

  it("classifies Prove as a standalone identity verification product", () => {
    const c = classifyIncident("Prove Verification Downtime", "users are encountering challenges on the Prove widget");
    expect(c.products).toContain("prove");
    expect(c.products).not.toContain("lookup");
    expect(c.affected_services).toContain("prove_verification");
  });

  it("classifies bank outages under Connect (Financial Data) with auth_method", () => {
    const mobileInc = classifyIncident(
      "FCMB Mobile (Authentication Outage)",
      "It's worth noting that this problem is specific to FCMB mobile. The internet banking authentication method remains unaffected."
    );
    expect(mobileInc.products).toContain("connect");
    expect(mobileInc.institution).toBe("FCMB");
    expect(mobileInc.auth_method).toBe("mobile");
    expect(mobileInc.scope).toBe("institution");
  });

  it("classifies account_debit when debits are affected", () => {
    const c = classifyIncident("Direct Debit Downtime", "users may encounter an error when attempting to initiate a debit");
    expect(c.products).toContain("direct_debit");
    expect(c.affected_services).toContain("account_debit");
  });

  it("classifies account_debit across various phrasings (account debit, attempt to debit, debit failures)", () => {
    const phrasings = [
      "We are investigating account debits failing for users",
      "attempting a debit results in timeout",
      "debit mandates are not executing properly",
      "users unable to initiate a debit at this time",
      "intermittent debit failures reported by provider",
    ];
    for (const text of phrasings) {
      const c = classifyIncident("Service Issue", text);
      expect(c.affected_services).toContain("account_debit");
    }
  });

  it("does NOT classify account_debit when incident text states debits remain unaffected", () => {
    const text =
      "Please note that debit processing is relatively stable now. However, mandate approval is still experiencing downtime. The NIBSS team is actively investigating.";
    const c = classifyIncident("Direct Debit: Intermittent Downtime", text);
    expect(c.affected_services).toContain("mandate_approval");
    expect(c.affected_services).not.toContain("account_debit");
  });

  it("classifies Mono Sweep as a mandate type under direct_debit and extracts authorization / creation", () => {
    const c = classifyIncident(
      "Mono Sweep Mandate Authorization Issue",
      "Users are encountering errors while authorizing a mono sweep mandate on their accounts."
    );
    expect(c.products).toContain("direct_debit");
    expect(c.products).toContain("payments");
    expect(c.affected_services).toContain("mono_sweep");
    expect(c.affected_services).toContain("mandate_authorization");
    expect(c.affected_services).not.toContain("account_debit");
  });

  it("suppresses services recommended as active fallbacks (e.g. continue using legacy BVN)", () => {
    const text =
      "BVN iGree is currently experiencing downtime. Partners can continue using legacy BVN lookup in the meantime.";
    const c = classifyIncident("BVN iGree Outage", text);
    expect(c.affected_services).toContain("bvn_igree");
    expect(c.affected_services).not.toContain("bvn_legacy");
  });
});

describe("filterIncidents", () => {
  const incidents = parseStatuspageJson(SAMPLE_STATUSPAGE_JSON);

  it("filters by canonical product", () => {
    const directDebit = filterIncidents(incidents, { product: "direct_debit" });
    expect(directDebit.length).toBe(2);
    for (const inc of directDebit) {
      expect(inc.products).toContain("direct_debit");
    }

    const lookup = filterIncidents(incidents, { product: "lookup" });
    expect(lookup.length).toBe(2);
    for (const inc of lookup) {
      expect(inc.products).toContain("lookup");
    }
  });

  it("resolves product aliases (kyc, bvn -> lookup)", () => {
    const kycFiltered = filterIncidents(incidents, { product: "kyc" });
    const bvnFiltered = filterIncidents(incidents, { product: "bvn" });
    expect(kycFiltered.length).toBe(2);
    expect(bvnFiltered.length).toBe(2);
  });

  it("filters by connect product", () => {
    const filtered = filterIncidents(incidents, { product: "connect" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("ht4433g0pl6s");
  });

  it("filters by severity", () => {
    const filtered = filterIncidents(incidents, { severity: "minor" });
    expect(filtered.length).toBeGreaterThan(0);
    for (const inc of filtered) expect(inc.severity).toBe("minor");
  });

  it("filters by multiple criteria", () => {
    const filtered = filterIncidents(incidents, { product: "direct_debit", status: "identified" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("yqbzdtffykhm");
  });

  it("resolves service aliases (mandate_debit, debit -> account_debit; sweep -> mono_sweep)", () => {
    const mockIncidents = [
      {
        title: "Direct Debit downtime",
        description: "attempting a debit fails",
        link: "https://status.mono.co/incidents/1",
        id: "1",
        published_at: new Date().toISOString(),
        is_ongoing: true,
        status: "Investigating",
        products: ["direct_debit"],
        affected_services: ["account_debit"],
        outage_type: "downtime",
        provider: "NIBSS",
        institution: "NIBSS",
        auth_method: null,
        scope: "systemic" as const,
        severity: "major" as const,
      },
      {
        title: "Mono Sweep issue",
        description: "authorizing a mono sweep mandate fails",
        link: "https://status.mono.co/incidents/2",
        id: "2",
        published_at: new Date().toISOString(),
        is_ongoing: true,
        status: "Investigating",
        products: ["direct_debit"],
        affected_services: ["mono_sweep", "mandate_authorization"],
        outage_type: "downtime",
        provider: null,
        institution: null,
        auth_method: null,
        scope: "systemic" as const,
        severity: "major" as const,
      },
    ];

    expect(filterIncidents(mockIncidents, { service: "account_debit" }).length).toBe(1);
    expect(filterIncidents(mockIncidents, { service: "mandate_debit" }).length).toBe(1);
    expect(filterIncidents(mockIncidents, { service: "debit" }).length).toBe(1);
    expect(filterIncidents(mockIncidents, { service: "mono_sweep" }).length).toBe(1);
    expect(filterIncidents(mockIncidents, { service: "sweep" }).length).toBe(1);
    expect(filterIncidents(mockIncidents, { service: "sweep_mandate" }).length).toBe(1);
  });

  it("returns all when no filters", () => {
    const filtered = filterIncidents(incidents, {});
    expect(filtered.length).toBe(incidents.length);
  });
});

describe("GET /api/incidents", () => {
  function mockFetcher(json = SAMPLE_STATUSPAGE_JSON) {
    return async () => new Response(json, { status: 200, headers: { "Content-Type": "application/json" } });
  }

  it("returns DOWNTIME_DETECTED with default limit=20", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
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
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);

    const byProduct = await app.handle(new Request("http://localhost/api/incidents?product=connect")).then((r) => r.json()) as any;
    expect(byProduct.incidents.length).toBe(1);
    expect(byProduct.incidents[0].products).toContain("connect");

    const byService = await app.handle(new Request("http://localhost/api/incidents?service=mandate_approval")).then((r) => r.json()) as any;
    expect(byService.incidents.length).toBe(1);
    expect(byService.incidents[0].id).toBe("yqbzdtffykhm");

    const bySeverity = await app.handle(new Request("http://localhost/api/incidents?severity=minor")).then((r) => r.json()) as any;
    expect(bySeverity.incidents.length).toBeGreaterThan(0);
    for (const inc of bySeverity.incidents) expect(inc.severity).toBe("minor");

    const byStatus = await app.handle(new Request("http://localhost/api/incidents?status=identified")).then((r) => r.json()) as any;
    expect(byStatus.incidents[0].status).toBe("Identified");
  });

  it("resolves product alias in route (?product=kyc -> lookup)", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);

    const res = await app.handle(new Request("http://localhost/api/incidents?product=kyc"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.incidents.length).toBe(2);
    for (const inc of body.incidents) expect(inc.products).toContain("lookup");
  });

  it("rejects invalid product with 422", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?product=invalid_product"));
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBe("invalid_param");
    expect(body.message).toContain("Invalid product 'invalid_product'");
  });

  it("rejects invalid severity with 422", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?severity=fatal"));
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBe("invalid_param");
    expect(body.message).toContain("Invalid severity 'fatal'");
  });

  it("rejects invalid status with 422", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?status=pending"));
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBe("invalid_param");
    expect(body.message).toContain("Invalid status 'pending'");
  });

  it("offset + limit pagination", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?offset=1&limit=2"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.incidents.length).toBe(2);
    expect(body.pagination.offset).toBe(1);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.returned).toBe(2);
  });

  it("ongoing=true filters incidents to active only", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?ongoing=true"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    for (const inc of body.incidents) expect(inc.is_ongoing).toBe(true);
  });

  it("filters by status across all incidents", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);
    const filtered: any = await app.handle(new Request("http://localhost/api/incidents?status=investigating")).then((r) => r.json());
    expect(filtered.incidents.length).toBeGreaterThan(0);
    for (const inc of filtered.incidents) expect(inc.status.toLowerCase()).toBe("investigating");
  });

  it("GET /api/incidents/:id resolves by id", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);

    const hit = await app.handle(new Request("http://localhost/api/incidents/yqbzdtffykhm"));
    expect(hit.status).toBe(200);
    const body: any = await hit.json();
    expect(body.id).toBe("yqbzdtffykhm");
    expect(body.title).toBe("Direct Debit: Intermittent Downtime");

    const miss = await app.handle(new Request("http://localhost/api/incidents/non-existent-xyz"));
    expect(miss.status).toBe(404);
  });

  it("single bank outage (FCMB) marks product as DEGRADED, not DOWN", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);

    const res = await app.handle(new Request("http://localhost/api/incidents?product=connect"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe("DEGRADED");
    expect(body.has_active_downtime).toBe(false);
    expect(body.has_degraded_service).toBe(true);
    expect(body.active_incidents_count).toBe(1);
  });

  it("filters by institution and auth_method — mobile down does not take internet down", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);

    // GTBank has NO outage -> OPERATIONAL
    const gtbank = await app.handle(new Request("http://localhost/api/incidents?product=connect&institution=gtbank")).then((r) => r.json()) as any;
    expect(gtbank.status).toBe("OPERATIONAL");
    expect(gtbank.has_active_downtime).toBe(false);

    // FCMB without specifying auth_method is DEGRADED (institution scope, not whole systemic down)
    const fcmb = await app.handle(new Request("http://localhost/api/incidents?product=connect&institution=fcmb")).then((r) => r.json()) as any;
    expect(fcmb.status).toBe("DEGRADED");
    expect(fcmb.has_degraded_service).toBe(true);
    expect(fcmb.active_incidents_count).toBe(1);

    // FCMB with auth_method=mobile is DOWNTIME_DETECTED for that specific channel
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
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?auth_method=ussd"));
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBe("invalid_param");
    expect(body.message).toContain("Invalid auth_method");
  });

  it("rejects invalid scope with 422", async () => {
    const cache = createMonoCache();
    await cache.get(mockFetcher() as any);
    const app = createApp(cache);
    const res = await app.handle(new Request("http://localhost/api/incidents?scope=global"));
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBe("invalid_param");
    expect(body.message).toContain("Invalid scope");
  });
});

describe("fetchMonoFeed", () => {
  it("fetches and merges JSON from Statuspage API endpoints", async () => {
    const jsonFetcher = async (url: string) => {
      if (url.includes("unresolved")) {
        return new Response(JSON.stringify({ incidents: [SAMPLE_INCIDENTS_RAW[0]] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ incidents: SAMPLE_INCIDENTS_RAW }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const incidents = await fetchMonoFeed(jsonFetcher as any);
    expect(incidents.length).toBe(4);
    expect(incidents[0].id).toBe("yqbzdtffykhm");
  });
});
