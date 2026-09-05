import { Elysia, t } from "elysia";
import { createMonoCache, filterIncidents } from "../lib/mono";
import { PRODUCT_ALIASES } from "../lib/classify";

const VALID_PRODUCTS = new Set(["direct_debit", "lookup", "prove", "connect", "payments", "general"]);
const VALID_SEVERITIES = new Set(["critical", "major", "minor", "none"]);
const VALID_STATUSES = new Set(["identified", "investigating", "monitoring", "resolved"]);
const VALID_SCOPES = new Set(["institution", "systemic"]);
const VALID_AUTH_METHODS = new Set(["mobile", "internet"]);

const incidentQuerySchema = {
  query: t.Object({
    product: t.Optional(t.String()),
    service: t.Optional(t.String()),
    institution: t.Optional(t.String()),
    provider: t.Optional(t.String()),
    auth_method: t.Optional(t.String()),
    scope: t.Optional(t.String()),
    severity: t.Optional(t.String()),
    status: t.Optional(t.String()),
    ongoing: t.Optional(t.String()),
    offset: t.Optional(t.String()),
    limit: t.Optional(t.String()),
  }),
};

export function createMonoRoutes(cache = createMonoCache()) {
  const handleIncidents = async ({ query, set }: any) => {
    if (query.product) {
      const raw = query.product.toLowerCase();
      const resolved = PRODUCT_ALIASES[raw] ?? raw;
      if (!VALID_PRODUCTS.has(resolved)) {
        set.status = 422;
        return {
          error: "invalid_param",
          message: `Invalid product '${query.product}'. Valid values: direct_debit, lookup, prove, connect, payments, general`,
        };
      }
    }
    if (query.auth_method && !VALID_AUTH_METHODS.has(query.auth_method.toLowerCase())) {
      set.status = 422;
      return {
        error: "invalid_param",
        message: `Invalid auth_method '${query.auth_method}'. Valid values: mobile, internet`,
      };
    }
    if (query.scope && !VALID_SCOPES.has(query.scope.toLowerCase())) {
      set.status = 422;
      return { error: "invalid_param", message: `Invalid scope '${query.scope}'. Valid values: institution, systemic` };
    }
    if (query.severity && !VALID_SEVERITIES.has(query.severity.toLowerCase())) {
      set.status = 422;
      return { error: "invalid_param", message: `Invalid severity '${query.severity}'. Valid values: critical, major, minor, none` };
    }
    if (query.status && !VALID_STATUSES.has(query.status.toLowerCase())) {
      set.status = 422;
      return { error: "invalid_param", message: `Invalid status '${query.status}'. Valid values: identified, investigating, monitoring, resolved` };
    }

    try {
      const { incidents: allIncidents, last_checked } = await cache.get();
      const filtered = filterIncidents(allIncidents, {
        product: query.product,
        service: query.service,
        institution: query.institution ?? query.provider,
        auth_method: query.auth_method,
        scope: query.scope as any,
        severity: query.severity,
        status: query.status,
      });
      const activeIncidents = filtered.filter((i) => i.is_ongoing);
      const hasActiveIncidents = activeIncidents.length > 0;
      const hasSystemicDowntime = activeIncidents.some((i) => i.scope === "systemic");

      let status: "OPERATIONAL" | "DEGRADED" | "DOWNTIME_DETECTED" = "OPERATIONAL";
      let hasActiveDowntime = false;
      let hasDegradedService = false;

      if (hasActiveIncidents) {
        if (hasSystemicDowntime) {
          // Core platform or national infrastructure is down
          status = "DOWNTIME_DETECTED";
          hasActiveDowntime = true;
        } else if (query.auth_method) {
          // Partner queried a specific auth method that is down
          status = "DOWNTIME_DETECTED";
          hasActiveDowntime = true;
        } else if (query.institution || query.provider) {
          // Partner queried a specific bank:
          // If an incident has auth_method === null (entire bank is down), it is DOWNTIME_DETECTED.
          // If it only affects a specific auth method (e.g. mobile down while internet works), the bank is DEGRADED.
          const hasFullBankOutage = activeIncidents.some((i) => i.auth_method === null);
          if (hasFullBankOutage) {
            status = "DOWNTIME_DETECTED";
            hasActiveDowntime = true;
          } else {
            status = "DEGRADED";
            hasDegradedService = true;
          }
        } else {
          // Product-level query without institution filter — single bank outage is degraded
          status = "DEGRADED";
          hasDegradedService = true;
        }
      }

      const offset = Math.max(Number(query.offset ?? 0), 0);
      const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);

      let list = query.ongoing === "true" ? activeIncidents : filtered;
      const total = list.length;
      list = list.slice(offset, offset + limit);

      return {
        status,
        has_active_downtime: hasActiveDowntime,
        has_degraded_service: hasDegradedService,
        active_incidents_count: activeIncidents.length,
        last_checked,
        active_incidents: activeIncidents,
        incidents: list,
        pagination: { offset, limit, total, returned: list.length },
      };
    } catch {
      set.status = 502;
      return { error: "upstream_unavailable", message: "Failed to fetch Mono status feed" };
    }
  };

  return new Elysia({ prefix: "/api" })
    .get("/incidents", handleIncidents, incidentQuerySchema)
    .get("/incidents/:id", async ({ params, set }) => {
      try {
        const { incidents } = await cache.get();
        const found = incidents.find((i) => i.id === params.id || i.link.includes(params.id));
        if (!found) {
          set.status = 404;
          return { error: "not_found", message: "Incident not found" };
        }
        return found;
      } catch {
        set.status = 502;
        return { error: "upstream_unavailable", message: "Failed to fetch Mono status feed" };
      }
    });
}
