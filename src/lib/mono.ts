import { XMLParser } from "fast-xml-parser";
import type { Incident } from "../schemas/mono";
import { classifyIncident } from "./classify";

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

export function extractIncidentId(url: string): string {
  if (!url) return "";
  const parts = url.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] ?? url;
}

export function isIncidentActive(item: { title?: string; description?: string }): boolean {
  const title = (item.title ?? "").toLowerCase();
  const description = (item.description ?? "").toLowerCase();
  const combined = `${title} ${description}`;
  const text = stripHtml(item.description ?? "").toLowerCase();
  const latest = (extractLatestStatus(item.description ?? "") ?? "").toLowerCase();
  if (["resolved", "completed", "operational"].includes(latest)) return false;
  const isExplicitlyResolved = combined.includes("resolved") && latest === "";
  if (isExplicitlyResolved) return false;
  if (latest && ["resolved", "completed"].includes(latest)) return false;
  const indicatesDowntime =
    combined.includes("downtime") ||
    combined.includes("outage") ||
    combined.includes("investigating") ||
    combined.includes("identified") ||
    combined.includes("monitoring") ||
    combined.includes("degraded") ||
    combined.includes("disruption") ||
    combined.includes("intermittent");
  const isResolved = combined.includes("resolved") || combined.includes("completed");
  if (isResolved) {
    return combined.includes("investigating") || combined.includes("identified") || combined.includes("monitoring")
      ? !text.includes("resolved")
      : false;
  }
  return indicatesDowntime;
}

export function buildSummary(incidents: Incident[]) {
  const by_product: Record<string, number> = {};
  const by_service: Record<string, number> = {};
  const by_severity: Record<string, number> = {};
  for (const inc of incidents) {
    for (const p of inc.products) by_product[p] = (by_product[p] ?? 0) + 1;
    for (const s of inc.affected_services) by_service[s] = (by_service[s] ?? 0) + 1;
    by_severity[inc.severity] = (by_severity[inc.severity] ?? 0) + 1;
  }
  return { by_product, by_service, by_severity };
}

export function parseMonoRss(xml: string): Incident[] {
  const parsed = parser.parse(xml);
  const rawItems = parsed?.rss?.channel?.item ?? [];
  const items: any[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const incidents: Incident[] = items.map((item) => {
    const pubDate = new Date(item.pubDate);
    const timestamp = pubDate.getTime();
    const rawDesc: string =
      typeof item.description === "string" ? item.description : item.description?.["#text"] ?? item.description?.toString?.() ?? "";
    const description = stripHtml(rawDesc);
    const title: string = item.title ?? "Untitled";
    const cls = classifyIncident(title, description, rawDesc);
    const rawLink: string = item.link ?? "";
    const rawGuid: string = typeof item.guid === "object" ? item.guid["#text"] ?? item.guid : item.guid ?? rawLink ?? "";
    const link = rawLink || (rawGuid.startsWith("http") ? rawGuid : `https://status.mono.co/incidents/${rawGuid}`);
    const guid = extractIncidentId(rawGuid || rawLink);
    return {
      title,
      description,
      link,
      guid,
      published_at: isNaN(timestamp) ? new Date().toISOString() : pubDate.toISOString(),
      timestamp: isNaN(timestamp) ? Date.now() : timestamp,
      is_ongoing: isIncidentActive(item),
      status: extractLatestStatus(rawDesc),
      products: cls.products,
      affected_services: cls.affected_services,
      outage_type: cls.outage_type,
      provider: cls.provider,
      severity: cls.severity,
    };
  });
  incidents.sort((a, b) => b.timestamp - a.timestamp);
  return incidents;
}

export async function fetchMonoFeed(fetcher: typeof fetch = fetch): Promise<Incident[]> {
  const res = await fetcher(RSS_URL, {
    headers: { "User-Agent": "MonoUptime/1.0 (+https://github.com/mono-uptime)" },
  });
  if (!res.ok) throw new Error(`Failed to fetch RSS: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  return parseMonoRss(xml);
}

export function createMonoCache(ttlMs = CACHE_TTL_MS) {
  let cached: { at: number; data: Incident[] } | null = null;
  let pending: Promise<Incident[]> | null = null;

  return {
    async get(fetcher: typeof fetch = fetch): Promise<{ incidents: Incident[]; cached: boolean; last_checked: string }> {
      const now = Date.now();
      if (cached && now - cached.at < ttlMs) {
        return { incidents: cached.data, cached: true, last_checked: new Date(cached.at).toISOString() };
      }
      if (pending) {
        const data = await pending;
        return { incidents: data, cached: true, last_checked: new Date(cached!.at).toISOString() };
      }
      pending = fetchMonoFeed(fetcher)
        .then((data) => {
          cached = { at: Date.now(), data };
          return data;
        })
        .finally(() => {
          pending = null;
        });
      const data = await pending;
      return { incidents: data, cached: false, last_checked: new Date(cached!.at).toISOString() };
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
