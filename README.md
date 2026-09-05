# mono-uptime

Elysia + Bun + TypeScript + Zod microservice that scrapes `https://status.mono.co/history.rss`, sorts by date, and infers downtime type / product / affected service via regex.

## Stack
- Bun, Elysia, TypeScript (strict), Zod, `fast-xml-parser`

## Inference
Mono's RSS only gives `title` + HTML `description` + `pubDate`. This service extracts (all `snake_case`):

- `products` — `["direct_debit"]`, `["bvn"]`, `["lookup"]`, `["auth"]`, `["data_sync"]`
- `affected_services` — `mandate_approval`, `mandate_creation`, `account_debit`, `nin_lookup`, `bvn_igree`, `otp`, `bank_auth`, `360_view`, …
- `outage_type` — `intermittent_downtime` | `degraded_performance` | `authentication_outage` | `otp_failure` | `downtime`
- `provider` — `NIBSS` | `FCMB` | `Providus Bank` … or `null`
- `severity` — `major` | `minor` | `critical`
- `status` — first `<strong>` in description (`Identified`/`Investigating`/`Monitoring`/`Resolved`)
- `is_ongoing` — not `Resolved`/`Completed`

Regex tables in `src/lib/classify.ts`.

## Incident shape
```json
{
  "title": "Direct Debit: Intermittent Downtime",
  "description": "Sep 4 , 17:46 BST Identified - Please note that debit processing ...",
  "link": "https://status.mono.co/incidents/yqbzdtffykhm",
  "guid": "yqbzdtffykhm",
  "published_at": "2026-09-04T17:46:59.000Z",
  "timestamp": 1725475619000,
  "is_ongoing": true,
  "status": "Identified",
  "products": ["direct_debit"],
  "affected_services": ["mandate_approval","account_debit"],
  "outage_type": "intermittent_downtime",
  "provider": "NIBSS",
  "severity": "minor"
}
```
`guid` is the incident id only; `link` is the full URL. `description` is plain text (HTML stripped).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| GET | `/api/uptime` | Main — sorted incidents + downtime detection |
| GET | `/api/history` | Paginated history |
| GET | `/api/incidents/:guid` | Single incident by id |

### Query params

Both `/api/uptime` and `/api/history` support:

| Param | Type | Description |
|-------|------|-------------|
| `product` | string | Filter by product slug: `direct_debit`, `bvn`, `lookup`, `auth`, `data_sync`, `kyc`, `payments`, `general` |
| `service` | string | Filter by affected service: `mandate_approval`, `mandate_creation`, `account_debit`, `nin_lookup`, `bvn_igree`, `bank_auth`, `otp`, … |
| `severity` | string | `major` / `minor` / `critical` / `none` |
| `status` | string | Incident status: `identified`, `investigating`, `monitoring`, `resolved` (case-insensitive) |
| `offset` | int | Pagination start (default `0`) |
| `limit` | int | Pagination size (1–100, default: no limit for `/api/uptime`, `20` for `/api/history`) |

Additional for `/api/uptime` only:

| Param | Description |
|-------|-------------|
| `active_only` | `true` → only `is_ongoing` incidents in `all_incidents` |
| `include_summary` | `true` → include `summary: {by_product, by_service, by_severity}` (off by default) |

All filters (except offset/limit) also restrict `active_incidents`/`active_incidents_count`/`has_active_downtime` so `?product=direct_debit&active_only=true` gives exactly what that integration should show.

**Response pagination (when `offset`/`limit` used):**
```json
{ "pagination": { "offset": 0, "limit": 10, "total": 25, "returned": 10 } }
```

### Examples
```bash
# Current downtime — is anything down?
curl http://localhost:3000/api/uptime | jq '{status, has_active_downtime, active_incidents_count}'

# Paginated, only ongoing + summary
curl "http://localhost:3000/api/uptime?active_only=true&include_summary=true&limit=5&offset=0" | jq

# What you care about if you use Direct Debit mandate approval
curl "http://localhost:3000/api/uptime?product=direct_debit&service=mandate_approval&active_only=true" | jq

# All lookup degraded, page 2
curl "http://localhost:3000/api/uptime?product=lookup&status=investigating&offset=10&limit=10" | jq

# History filtered by severity + status
curl "http://localhost:3000/api/history?severity=minor&status=identified&limit=5&offset=0" | jq

# NIN lookup only
curl "http://localhost:3000/api/history?product=lookup&service=nin_lookup&limit=10" | jq
```

### Current downtime (2026-09-04)
```bash
curl http://localhost:3000/api/uptime | jq
```
```json
{
  "status": "DOWNTIME_DETECTED",
  "has_active_downtime": true,
  "active_incidents_count": 1,
  "active_incidents": [{
    "title": "Direct Debit: Intermittent Downtime",
    "guid": "yqbzdtffykhm",
    "link": "https://status.mono.co/incidents/yqbzdtffykhm",
    "products": ["direct_debit"],
    "affected_services": ["mandate_approval","account_debit"],
    "outage_type": "intermittent_downtime",
    "provider": "NIBSS",
    "severity": "minor",
    "status": "Identified",
    "is_ongoing": true
  }],
  "all_incidents": [ ... ],
  "pagination": { "offset": 0, "limit": null, "total": 25, "returned": 25 }
}
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
3. `parseMonoRss()` → `stripHtml` + `is_ongoing` + `classifyIncident()` → sorted `b.timestamp-a.timestamp`
4. `createMonoCache(60s)` — TTL + dedupes concurrent fetches
5. `src/lib/cron.ts` — `setInterval` every `CRON_INTERVAL_MINUTES` (default 30m) calls `cache.get()` to keep cache warm

## Quickstart
```bash
bun install
bun run dev   # http://localhost:3000
bun test      # 19 tests
bun run typecheck
```

## Project structure
```
src/
  app.ts
  index.ts            # starts cron + server
  lib/mono.ts         # fetch/parse/sort/cache
  lib/classify.ts     # regex tables PRODUCT/SERVICE/OUTAGE/PROVIDER
  lib/cron.ts         # setInterval poll every 30m (configurable)
  routes/health.ts
  routes/mono.ts      # /api/uptime, /api/history, /api/incidents/:guid
  schemas/mono.ts     # Zod (snake_case)
tests/
  health.test.ts
  mono.test.ts
  cron.test.ts
```

## Tuning
Edit `src/lib/classify.ts` → add a regex, `bun test`.
