# mono-uptime

Elysia + Bun + TypeScript + Zod microservice that scrapes `https://status.mono.co/history.rss`, sorts by date, and infers downtime type / product / affected service via regex.

## Stack
- Bun, Elysia, TypeScript (strict), Zod, `fast-xml-parser`

## Inference
Mono's RSS only gives `title` + HTML `description` + `pubDate`. This service extracts (all `snake_case`):

- `products` — `direct_debit` | `lookup` | `prove` | `connect` | `payments` | `general`
  - *Lookup*: Mono's Identity Verification product (BVN, NIN, CAC, TIN, etc. — also maps legacy aliases `kyc` and `bvn`).
  - *Direct Debit*: Recurring payments, mandate creation, mandate approval, account debits. (BVN iGree outages also tag `direct_debit` as iGree is used for mandate approval).
  - *Prove*: Standalone identity verification widget.
  - *Connect*: Financial Data (Account linking, statement pages, bank-specific auth/connection).
  - *Payments*: DirectPay, pay with bank, disbursements.
- `affected_services` — `mandate_approval`, `mandate_creation`, `mandate_authorization`, `account_debit`, `nin_lookup`, `bvn_igree`, `bvn_legacy`, `otp`, `bank_auth`, `360_view`, `cac_lookup`, `tin_lookup`, `prove_verification`, …
- `outage_type` — `intermittent_downtime` | `degraded_performance` | `authentication_outage` | `otp_failure` | `downtime`
- `provider` / `institution` — `NIBSS` | `FCMB` | `Providus Bank` … or `null`
- `auth_method` — `mobile` | `internet` | `null` (retail banking authentication method)
- `scope` — `institution` (bank-specific) | `systemic` (product-wide)
- `severity` — `major` | `minor` | `critical`
- `status` — first `<strong>` in description (`Identified`/`Investigating`/`Monitoring`/`Resolved`)
- `is_ongoing` — not `Resolved`/`Completed`

Regex tables in `src/lib/classify.ts`.

## Incident shape
```json
{
  "title": "FCMB Mobile (Authentication Outage)",
  "description": "We are presently investigating an issue where users are encountering challenges in authenticating with their FCMB mobile details. The internet banking authentication method remains unaffected.",
  "link": "https://status.mono.co/incidents/ht4433g0pl6s",
  "id": "ht4433g0pl6s",
  "published_at": "2026-09-04T17:46:59.000Z",
  "is_ongoing": true,
  "status": "Investigating",
  "products": ["connect"],
  "affected_services": ["bank_auth"],
  "outage_type": "authentication_outage",
  "provider": "FCMB",
  "institution": "FCMB",
  "auth_method": "mobile",
  "scope": "institution",
  "severity": "major"
}
```
`id` is the incident slug; `link` is the full URL. `description` is plain text (HTML stripped).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| GET | `/api/incidents` | Status + incidents (filterable, paginated) |
| GET | `/api/incidents/:id` | Single incident by id |

### Query params — `GET /api/incidents`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `product` | enum | — | Filter by product: `direct_debit`, `lookup`, `prove`, `connect`, `payments`, `general` (aliases `kyc`, `bvn`, `data_sync`, `auth` automatically resolve; 422 on invalid) |
| `service` | string | — | Filter by affected service: `mandate_approval`, `mandate_creation`, `nin_lookup`, `bvn_igree`, `otp`, `bank_auth`, … |
| `institution` | string | — | Filter by bank/provider: `gtbank`, `fcmb`, `zenith`, `stanbic`, `providus`, `nibss`, etc. (alias: `provider`) |
| `auth_method` | enum | — | Filter by auth method: `mobile` or `internet` (422 on invalid) |
| `scope` | enum | — | Filter by scope: `institution` (bank-specific) or `systemic` (product-wide; 422 on invalid) |
| `severity` | enum | — | `critical` / `major` / `minor` / `none` (422 on invalid) |
| `status` | enum | — | `identified` / `investigating` / `monitoring` / `resolved` (422 on invalid) |
| `ongoing` | boolean | `false` | `true` → only ongoing incidents in `incidents` list |
| `offset` | int | `0` | Pagination offset |
| `limit` | int | `20` | Page size (1–100) |

### Status Levels & Granularity

A single bank having an issue does **not** take Connect down; and a single auth method having an issue does **not** take the entire bank down:
- **`OPERATIONAL`**: Everything running normally (or the queried bank/auth-method has no active incidents).
- **`DEGRADED`**: An isolated bank has an issue, OR only one auth method is down while the other works (e.g. FCMB mobile auth is failing, but FCMB internet banking is operational). `has_active_downtime: false`, `has_degraded_service: true`.
- **`DOWNTIME_DETECTED`**: Systemic downtime on the core product, OR the specific queried bank/auth-method is down (e.g. `?institution=fcmb&auth_method=mobile`).

### Response — `GET /api/incidents`

```json
{
  "status": "DEGRADED",
  "has_active_downtime": false,
  "has_degraded_service": true,
  "active_incidents_count": 1,
  "last_checked": "2026-09-04T17:46:59.000Z",
  "active_incidents": [{
    "title": "FCMB Mobile (Authentication Outage)",
    "provider": "FCMB",
    "scope": "institution",
    "is_ongoing": true
  }],
  "incidents": [{ "..." }],
  "pagination": { "offset": 0, "limit": 20, "total": 25, "returned": 20 }
}
```

### Error responses

All errors return a consistent shape:
```json
{ "error": "error_code", "message": "Human-readable description" }
```

| Status | Error code | When |
|--------|-----------|------|
| 404 | `not_found` | Unknown route or incident |
| 422 | `invalid_param` | Invalid query parameter value |
| 502 | `upstream_unavailable` | RSS feed unreachable |

### Examples
```bash
# Current status — is anything down?
curl http://localhost:3000/api/incidents | jq '{status, has_active_downtime, has_degraded_service, active_incidents_count}'

# Only active / ongoing incidents
curl "http://localhost:3000/api/incidents?ongoing=true&limit=5" | jq

# Check if a specific bank authentication method is down (e.g. FCMB mobile vs internet)
curl "http://localhost:3000/api/incidents?product=connect&institution=fcmb&auth_method=mobile" | jq

# Check if GTBank is operational
curl "http://localhost:3000/api/incidents?product=connect&institution=gtbank" | jq

# Direct Debit mandate approval status
curl "http://localhost:3000/api/incidents?product=direct_debit&service=mandate_approval&ongoing=true" | jq

# All lookup issues under investigation, page 2
curl "http://localhost:3000/api/incidents?product=lookup&status=investigating&offset=10&limit=10" | jq

# Filter by severity
curl "http://localhost:3000/api/incidents?severity=minor&status=identified&limit=5" | jq

# Single incident lookup by ID
curl http://localhost:3000/api/incidents/yqbzdtffykhm | jq
```

## Cron — polling the RSS

A lightweight in-process cron warms the cache even with no traffic.

- Default: **30 minutes** (`CRON_INTERVAL_MINUTES=30`) —  48 fetches/day vs 96 at 15m, half the egress + avoids Statuspage rate-limiting; Statuspage incidents update every 15–30m anyway so 30m still catches downtime within 30m.
- Use **15 minutes** if you need faster alerting: `CRON_INTERVAL_MINUTES=15` (≈ 96 fetches/day, still trivial).
- Disable: `DISABLE_CRON=true` (rely on on-demand `cache.get()` only, e.g. for tests).
- Also respects `RSS_POLL_INTERVAL_MINUTES` as alias.

```bash
# 30m (default for free servers)
bun run start

# 15m for quicker detection
CRON_INTERVAL_MINUTES=15 bun run start

# disable cron, on-demand only
DISABLE_CRON=true bun run start
```
Cron logs each tick: `[cron] 2026-09-04T12:00:00.000Z polled 25 incidents, active=1 has_downtime=true`. It reuses the same `createMonoCache` so HTTP handlers get the warmed data. Set `NODE_ENV=test` to auto-disable in tests.

## How it works
1. `GET https://status.mono.co/history.rss` (`User-Agent: MonoUptime/1.0`)
2. `fast-xml-parser` → `rss.channel.item[]`
3. `parseMonoRss()` → `stripHtml` + `is_ongoing` + `classifyIncident()` → sorted by `published_at` desc
4. `createMonoCache(60s)` — TTL + dedupes concurrent fetches
5. `src/lib/cron.ts` — `setInterval` every `CRON_INTERVAL_MINUTES` (default 30m) calls `cache.get()` to keep cache warm

## Quickstart
```bash
bun install
bun run dev   # http://localhost:3000
bun test      # 35 tests
bun run typecheck
```

## Project structure
```
src/
  app.ts
  index.ts            # starts cron + server
  lib/mono.ts         # fetch/parse/sort/cache/filter
  lib/classify.ts     # regex tables PRODUCT/SERVICE/OUTAGE/PROVIDER
  lib/cron.ts         # setInterval poll every 30m (configurable)
  routes/health.ts
  routes/mono.ts      # /api/incidents, /api/incidents/:id
  schemas/mono.ts     # Zod incident schema
tests/
  health.test.ts
  mono.test.ts
  cron.test.ts
```

## Tuning
Edit `src/lib/classify.ts` → add a regex, `bun test`.
