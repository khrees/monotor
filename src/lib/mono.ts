import type { Incident } from "../schemas/mono";
import { classifyIncident, PRODUCT_ALIASES } from "./classify";

export const STATUS_API_BASE = "https://status.mono.co/api/v2";
export const STATUS_INCIDENTS_URL = `${STATUS_API_BASE}/incidents.json`;
export const STATUS_UNRESOLVED_URL = `${STATUS_API_BASE}/incidents/unresolved.json`;
export const STATUS_SUMMARY_URL = `${STATUS_API_BASE}/summary.json`;
export const CACHE_TTL_MS = 60_000;

export interface StatuspageIncidentUpdate {
  id: string;
  status: string;
  body: string;
  created_at: string;
  updated_at: string;
  display_at: string;
  affected_components?: Array<{
    code: string;
    name: string;
    old_status: string;
    new_status: string;
  }> | null;
}

export interface StatuspageComponent {
  id: string;
  name: string;
  status: string;
  description?: string | null;
}

export interface StatuspageIncidentRaw {
  id: string;
  name: string;
  status: string;
  impact?: string | null;
  created_at?: string;
  started_at?: string;
  resolved_at?: string | null;
  updated_at?: string;
  shortlink?: string;
  incident_updates?: StatuspageIncidentUpdate[];
  components?: StatuspageComponent[];
}

export type IncidentFilters = {
  product?: string;
  service?: string;
  institution?: string;
  provider?: string;
  auth_method?: string;
  scope?: "institution" | "systemic";
  severity?: string;
  status?: string;
};

export const SERVICE_ALIASES: Record<string, string> = {
  mandate_debit: "account_debit",
  debit: "account_debit",
  sweep: "mono_sweep",
  sweep_mandate: "mono_sweep",
};

export function filterIncidents(incidents: Incident[], filters: IncidentFilters): Incident[] {
  let result = incidents;

  if (filters.product) {
    const raw = filters.product.toLowerCase();
    const resolved = PRODUCT_ALIASES[raw] ?? raw;
    result = result.filter((i) => i.products.some((p) => p.toLowerCase() === resolved));
  }
  if (filters.service) {
    const raw = filters.service.toLowerCase();
    const resolved = SERVICE_ALIASES[raw] ?? raw;
    result = result.filter((i) => i.affected_services.some((x) => x.toLowerCase() === resolved));
  }
  const inst = (filters.institution ?? filters.provider)?.toLowerCase();
  if (inst) {
    result = result.filter((i) => (i.provider ?? "").toLowerCase().includes(inst));
  }
  if (filters.auth_method) {
    const am = filters.auth_method.toLowerCase();
    // Incidents with auth_method === null affect both methods (whole-bank outage),
    // so they pass through when filtering for a specific method.
    result = result.filter((i) => i.auth_method === null || i.auth_method.toLowerCase() === am);
  }
  if (filters.scope) {
    const sc = filters.scope.toLowerCase();
    result = result.filter((i) => i.scope.toLowerCase() === sc);
  }
  if (filters.severity) {
    const sev = filters.severity.toLowerCase();
    result = result.filter((i) => i.severity.toLowerCase() === sev);
  }
  if (filters.status) {
    const st = filters.status.toLowerCase();
    result = result.filter((i) => (i.status ?? "").toLowerCase() === st);
  }
  return result;
}

export function transformStatuspageIncident(inc: StatuspageIncidentRaw): Incident {
  const title = inc.name ?? "Untitled";
  const updates = inc.incident_updates ?? [];
  const latestUpdate = updates[0];
  const rawStatus = latestUpdate?.status ?? inc.status ?? "investigating";
  const status = rawStatus ? rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase() : null;

  const description = updates
    .map((u) => {
      const prefix = u.status ? `${u.status.charAt(0).toUpperCase() + u.status.slice(1)} - ` : "";
      return `${prefix}${u.body}`.trim();
    })
    .filter(Boolean)
    .join("\n\n") || (latestUpdate?.body ?? "");

  const componentNames = [
    ...(inc.components ?? []).map((c) => c.name),
    ...updates.flatMap((u) => (u.affected_components ?? []).map((ac) => ac.name)),
  ];
  const componentText = componentNames.filter(Boolean).join(" ");

  const cls = classifyIncident(title, `${description}\n${componentText}`);

  let severity = cls.severity;
  if (cls.scope === "institution" && severity === "major") {
    severity = "minor";
  } else if (inc.impact === "critical" && cls.scope === "systemic") {
    severity = "critical";
  }

  const id = inc.id;
  const link = `https://status.mono.co/incidents/${id}`;
  const pubDate = inc.updated_at || latestUpdate?.created_at || inc.started_at || inc.created_at || new Date().toISOString();
  const is_ongoing = inc.status !== "resolved" && inc.resolved_at === null;

  return {
    title,
    description,
    link,
    id,
    published_at: new Date(pubDate).toISOString(),
    is_ongoing,
    status,
    products: cls.products,
    affected_services: cls.affected_services,
    outage_type: cls.outage_type,
    provider: cls.provider,
    institution: cls.institution,
    auth_method: cls.auth_method,
    scope: cls.scope,
    severity,
  };
}

export function parseStatuspageJson(data: string | { incidents?: StatuspageIncidentRaw[] }): Incident[] {
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  const rawIncidents: StatuspageIncidentRaw[] = parsed?.incidents ?? (Array.isArray(parsed) ? parsed : []);
  const items = rawIncidents.map(transformStatuspageIncident);
  items.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  return items;
}

export function mergeAndParseStatuspageJson({
  unresolved = [],
  historical = [],
}: {
  unresolved?: StatuspageIncidentRaw[];
  historical?: StatuspageIncidentRaw[];
}): Incident[] {
  const map = new Map<string, StatuspageIncidentRaw>();
  for (const inc of historical) {
    if (inc?.id) map.set(inc.id, inc);
  }
  for (const inc of unresolved) {
    if (inc?.id) map.set(inc.id, inc);
  }
  const items = Array.from(map.values()).map(transformStatuspageIncident);
  items.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  return items;
}

export async function fetchMonoFeed(fetcher: typeof fetch = fetch): Promise<Incident[]> {
  const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(8000)
    : undefined;
  const headers = { "User-Agent": "Monotor/0.1.0 (+https://github.com/khrees/monotor)" };

  const [unresRes, incRes] = await Promise.all([
    fetcher(STATUS_UNRESOLVED_URL, { headers, signal }).catch(() => null),
    fetcher(STATUS_INCIDENTS_URL, { headers, signal }).catch(() => null),
  ]);

  const validRes = incRes?.ok ? incRes : unresRes?.ok ? unresRes : null;
  if (!validRes) {
    throw new Error(`Statuspage API request failed: unres=${unresRes?.status}, inc=${incRes?.status}`);
  }

  const unresJson = unresRes?.ok ? await unresRes.json().catch(() => null) : null;
  const incJson = incRes?.ok ? await incRes.json().catch(() => null) : null;

  if (unresJson || incJson) {
    return mergeAndParseStatuspageJson({
      unresolved: unresJson?.incidents ?? (Array.isArray(unresJson) ? unresJson : []),
      historical: incJson?.incidents ?? (Array.isArray(incJson) ? incJson : []),
    });
  }

  throw new Error("Invalid Statuspage API response");
}

export function createMonoCache(ttlMs = CACHE_TTL_MS) {
  let cached: { at: number; data: Incident[] } | null = null;
  let pending: Promise<{ at: number; data: Incident[] }> | null = null;

  async function refresh(fetcher: typeof fetch = fetch): Promise<{ at: number; data: Incident[] }> {
    if (pending) return pending;
    pending = fetchMonoFeed(fetcher)
      .then((data) => {
        cached = { at: Date.now(), data };
        return cached;
      })
      .catch((err) => {
        if (cached) {
          console.warn(`[cache] background refresh failed, keeping stale data: ${err?.message ?? err}`);
          return cached;
        }
        throw err;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  return {
    async get(fetcher: typeof fetch = fetch): Promise<{ incidents: Incident[]; cached: boolean; last_checked: string }> {
      const now = Date.now();

      // 1. Fresh cache: instantaneous return (< 0.1ms)
      if (cached && now - cached.at < ttlMs) {
        return { incidents: cached.data, cached: true, last_checked: new Date(cached.at).toISOString() };
      }

      // 2. Stale-While-Revalidate: if we have cached data, return it immediately (< 0.1ms)
      // and revalidate asynchronously in the background so the partner never experiences latency.
      if (cached) {
        refresh(fetcher).catch(() => {});
        return { incidents: cached.data, cached: true, last_checked: new Date(cached.at).toISOString() };
      }

      // 3. Cold start: await initial fetch once
      const result = await refresh(fetcher);
      return { incidents: result.data, cached: false, last_checked: new Date(result.at).toISOString() };
    },
    clear() {
      cached = null;
      pending = null;
    },
    _peek() {
      return cached;
    },
  };
}

export type MonoCache = ReturnType<typeof createMonoCache>;
