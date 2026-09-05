import { Elysia, t } from "elysia";
import { createMonoCache } from "../lib/mono";

function parsePagination(query: { offset?: string; limit?: string }) {
  const offset = Math.max(Number(query.offset ?? 0), 0);
  const limitRaw = query.limit != null ? Number(query.limit) : undefined;
  const limit = limitRaw != null ? Math.min(Math.max(limitRaw, 1), 100) : undefined;
  return { offset, limit };
}

function paginate<T>(arr: T[], offset: number, limit?: number): T[] {
  if (limit == null) return offset ? arr.slice(offset) : arr;
  return arr.slice(offset, offset + limit);
}

export function createMonoRoutes(cache = createMonoCache()) {
  return new Elysia({ prefix: "/api" })
    .get(
      "/uptime",
      async ({ query, set }) => {
        try {
          const { incidents, last_checked } = await cache.get();
          let active_incidents = incidents.filter((i) => i.is_ongoing);
          let filtered = incidents;

          if (query.product) {
            const p = query.product.toLowerCase();
            filtered = filtered.filter((i) => i.products.map((x) => x.toLowerCase()).includes(p));
            active_incidents = active_incidents.filter((i) => i.products.map((x) => x.toLowerCase()).includes(p));
          }
          if (query.service) {
            const s = query.service.toLowerCase();
            filtered = filtered.filter((i) => i.affected_services.map((x) => x.toLowerCase()).includes(s));
            active_incidents = active_incidents.filter((i) => i.affected_services.map((x) => x.toLowerCase()).includes(s));
          }
          if (query.severity) {
            const sev = query.severity.toLowerCase();
            filtered = filtered.filter((i) => i.severity.toLowerCase() === sev);
            active_incidents = active_incidents.filter((i) => i.severity.toLowerCase() === sev);
          }
          if (query.status) {
            const st = query.status.toLowerCase();
            filtered = filtered.filter((i) => (i.status ?? "").toLowerCase() === st);
            active_incidents = active_incidents.filter((i) => (i.status ?? "").toLowerCase() === st);
          }

          const has_active_downtime = active_incidents.length > 0;
          const { offset, limit } = parsePagination(query);
          let all_incidents = filtered;
          if (query.active_only === "true") all_incidents = active_incidents;
          all_incidents = paginate(all_incidents, offset, limit);

          const base: any = {
            status: has_active_downtime ? "DOWNTIME_DETECTED" : "OPERATIONAL",
            has_active_downtime,
            active_incidents_count: active_incidents.length,
            last_checked,
            active_incidents,
            all_incidents,
            pagination: { offset, limit: limit ?? null, total: filtered.length, returned: all_incidents.length },
          };

          if (query.include_summary === "true") {
            const by_product: Record<string, number> = {};
            const by_service: Record<string, number> = {};
            const by_severity: Record<string, number> = {};
            for (const inc of filtered) {
              for (const p of inc.products) by_product[p] = (by_product[p] ?? 0) + 1;
              for (const sv of inc.affected_services) by_service[sv] = (by_service[sv] ?? 0) + 1;
              by_severity[inc.severity] = (by_severity[inc.severity] ?? 0) + 1;
            }
            base.summary = { by_product, by_service, by_severity };
          }

          return base;
        } catch (e: any) {
          set.status = 502;
          return { error: "Failed to fetch Mono status feed", details: e?.message ?? String(e) };
        }
      },
      {
        query: t.Object({
          active_only: t.Optional(t.String()),
          product: t.Optional(t.String()),
          service: t.Optional(t.String()),
          severity: t.Optional(t.String()),
          status: t.Optional(t.String()),
          include_summary: t.Optional(t.String()),
          offset: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      }
    )
    .get(
      "/history",
      async ({ query, set }) => {
        try {
          const { incidents, last_checked } = await cache.get();
          let filtered = incidents;
          if (query.product) {
            const p = query.product.toLowerCase();
            filtered = filtered.filter((i) => i.products.map((x) => x.toLowerCase()).includes(p));
          }
          if (query.service) {
            const s = query.service.toLowerCase();
            filtered = filtered.filter((i) => i.affected_services.map((x) => x.toLowerCase()).includes(s));
          }
          if (query.severity) {
            const sev = query.severity.toLowerCase();
            filtered = filtered.filter((i) => i.severity.toLowerCase() === sev);
          }
          if (query.status) {
            const st = query.status.toLowerCase();
            filtered = filtered.filter((i) => (i.status ?? "").toLowerCase() === st);
          }
          const { offset, limit } = parsePagination({ offset: query.offset, limit: query.limit ?? "20" });
          const paged = paginate(filtered, offset, limit);
          return { last_checked, count: filtered.length, pagination: { offset, limit, total: filtered.length, returned: paged.length }, incidents: paged };
        } catch (e: any) {
          set.status = 502;
          return { error: "Failed to fetch Mono status feed", details: e?.message ?? String(e) };
        }
      },
      {
        query: t.Object({
          offset: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          product: t.Optional(t.String()),
          service: t.Optional(t.String()),
          severity: t.Optional(t.String()),
          status: t.Optional(t.String()),
        }),
      }
    )
    .get("/incidents/:guid", async ({ params, set }) => {
      try {
        const { incidents } = await cache.get();
        const found = incidents.find((i) => i.guid === params.guid || i.link.includes(params.guid));
        if (!found) {
          set.status = 404;
          return { error: "Incident not found" };
        }
        return found;
      } catch (e: any) {
        set.status = 502;
        return { error: "Failed to fetch Mono status feed", details: e?.message ?? String(e) };
      }
    });
}
