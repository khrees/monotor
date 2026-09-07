import { XMLParser } from "fast-xml-parser";
import type { Incident } from "../schemas/mono";
import { classifyIncident, PRODUCT_ALIASES } from "./classify";

export const RSS_URL = "https://status.mono.co/history.rss";
export const CACHE_TTL_MS = 60_000;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export function stripHtml(html: string | unknown): string {
  const str = typeof html === "string" ? html : html == null ? "" : String(html);
  return str.replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLatestStatus(description: string): string | null {
  const matches = [...description.matchAll(/<strong>([^<]+)<\/strong>/gi)].map((m) => m[1].trim());
  return matches[0] ?? null;
}

export function extractIncidentId(url: string | unknown): string {
  if (url == null || url === "") return "";
  const str = String(url);
  const parts = str.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] ?? str;
}

export function isIncidentActive(item: { title?: string; description?: string }): boolean {
  const latest = (extractLatestStatus(item.description ?? "") ?? "").toLowerCase();
  if (["resolved", "completed", "operational"].includes(latest)) return false;
  if (!latest) {
    const text = stripHtml(item.description ?? "").toLowerCase();
    if (text.includes("resolved") || text.includes("completed")) return false;
  }
  return true;
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
    const p = PRODUCT_ALIASES[raw] ?? raw;
    result = result.filter((i) => i.products.some((x) => x.toLowerCase() === p));
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

export function parseMonoRss(xml: string): Incident[] {
  const parsed = parser.parse(xml);
  const rawItems = parsed?.rss?.channel?.item ?? [];
  const items: any[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  const withTimestamp = items.map((item) => {
    const pubDate = new Date(item.pubDate);
    const ts = pubDate.getTime();
    const rawDesc: string =
      typeof item.description === "string" ? item.description : item.description?.["#text"] ?? item.description?.toString?.() ?? "";
    const description = stripHtml(rawDesc);
    const title: string = item.title ?? "Untitled";
    const cls = classifyIncident(title, description, rawDesc);
    const rawLink: string = item.link ?? "";
    const rawGuid: string = typeof item.guid === "object" ? item.guid["#text"] ?? item.guid : item.guid ?? rawLink ?? "";
    const link = rawLink || (rawGuid.startsWith("http") ? rawGuid : `https://status.mono.co/incidents/${rawGuid}`);
    const id = extractIncidentId(rawGuid || rawLink);

    return {
      _ts: ts,
      title,
      description,
      link,
      id,
      published_at: isNaN(ts) ? new Date().toISOString() : pubDate.toISOString(),
      is_ongoing: isIncidentActive(item),
      status: extractLatestStatus(rawDesc),
      products: cls.products,
      affected_services: cls.affected_services,
      outage_type: cls.outage_type,
      provider: cls.provider,
      institution: cls.institution,
      auth_method: cls.auth_method,
      scope: cls.scope,
      severity: cls.severity,
    };
  });

  withTimestamp.sort((a, b) => b._ts - a._ts);
  return withTimestamp.map(({ _ts, ...rest }) => rest);
}

export async function fetchMonoFeed(fetcher: typeof fetch = fetch): Promise<Incident[]> {
  const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(8000)
    : undefined;

  const res = await fetcher(RSS_URL, {
    headers: { "User-Agent": "MonoUptime/1.0 (+https://github.com/mono-uptime)" },
    signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch RSS: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  return parseMonoRss(xml);
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
