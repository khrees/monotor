# monotor

> **Live Status & Downtime Inference Microservice for Mono APIs**  
> Built with Bun, Elysia, and TypeScript.

---

## Table of Contents
- [The Problem](#the-problem)
- [How It Works](#how-it-works)
- [Product & Service Architecture](#product--service-architecture)
- [Quickstart & Testing](#quickstart--testing)
- [Status Levels & Decision Matrix](#status-levels--decision-matrix)
- [Real-World Partner Use Cases](#real-world-partner-use-cases)
  - [1. Pre-flight Check Before Mandate Debit (Charging Accounts)](#1-pre-flight-check-before-mandate-debit-charging-accounts)
  - [2. Mandate Authorization & Mono Sweep Check](#2-mandate-authorization--mono-sweep-check)
  - [3. Bank-Specific Outage on Connect (Mobile vs Internet Auth)](#3-bank-specific-outage-on-connect-mobile-vs-internet-auth)
  - [4. Identity Verification (Lookup / KYC)](#4-identity-verification-lookup--kyc)
  - [5. DirectPay (Pay with Bank Checkout)](#5-directpay-pay-with-bank-checkout)
- [API Reference](#api-reference)
  - [Endpoints](#endpoints)
  - [Query Parameters](#query-parameters)
  - [Response Shape](#response-shape)
  - [Error Responses](#error-responses)
- [In-Process Cache & Cron](#in-process-cache--cron)
- [Testing & Quality Assurance](#testing--quality-assurance)

---

## The Problem

Partners integrating Mono (e.g. lenders, fintechs, neobanks) frequently face temporary provider outages (e.g., NIBSS downtime, bank maintenance). 

While Mono publishes incident announcements via its Atlassian Statuspage (`https://status.mono.co`), automated partner systems face three major roadblocks:

1. **Misleading High-Level Status**: Atlassian's top-level status endpoint often reports `"All Systems Operational"` even when multiple banks and specific channels are experiencing active outages.
2. **Unstructured Prose**: Announcements are written in human prose (e.g., *"Debit processing is relatively stable now. However, mandate approval is still experiencing downtime from NIBSS. The internet banking authentication method remains unaffected."*). Automated backends cannot evaluate unstructured prose in an `if/else` pre-flight check.
3. **No Direct Pre-Flight Endpoint**: Partners cannot make a sub-millisecond pre-flight query before high-stakes operations (like charging an account, approving a mandate, or initiating a bank link) without false alarms.

`monotor` bridges this gap as a high-performance stopgap microservice. It ingests Mono's public Atlassian Statuspage v2 REST API (`unresolved.json` + `incidents.json`), runs regex NLP classification to deduce affected products, services, banks, and severity, and exposes a clean, queryable REST API.

---

## How It Works

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                    Mono Atlassian Statuspage v2 REST API               │
 │  GET https://status.mono.co/api/v2/incidents/unresolved.json (Active)  │
 │  GET https://status.mono.co/api/v2/incidents.json (Historical, 50+)    │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ (Polled every 15-30m or on-demand)
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                               monotor                                  │
 │                                                                        │
 │  1. Ingestion Layer (src/lib/mono.ts):                                 │
 │     - Fetches Statuspage JSON in parallel                              │
 │     - Overlays unresolved outages on history (prevents silent drops)   │
 │     - Deduplicates and structures full incident payload                │
 │  2. Sentence/Clause NLP Classifier (src/lib/classify.ts):              │
 │     - Identifies affected products & services                          │
 │     - Suppresses negated / unaffected services                         │
 │     - Isolates banks & auth methods (mobile vs internet)               │
 │  3. In-Memory Cache (60s TTL + Request Deduplication + Cron Warming)   │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │              Partner Applications / Pre-Flight Checks                  │
 │  GET /api/incidents?product=direct_debit&service=mandate_debit         │
 │  GET /api/incidents?product=connect&institution=fcmb&auth_method=mobile│
 └────────────────────────────────────────────────────────────────────────┘
```

---

## Product & Service Architecture

Mono's products are mapped in [`src/lib/classify.ts`](src/lib/classify.ts):

### 1. `payments` (Payments Suite)
Direct Debit is a pillar of the Payments suite alongside DirectPay and Disburse:
- **`direct_debit`**: Recurring payments and account charging.
  - **Mandates**: Authorization given by the account holder.
    - Types: Fixed Mandates, e-mandates, and **`mono_sweep`** (variable sweeping mandates).
    - Lifecycle phases: `mandate_creation`, `mandate_authorization`, `mandate_approval`.
    - *Note*: Mono Sweep is a **mandate type**, not a debit transaction itself.
  - **Account Debit (`account_debit`)**: Executing/charging funds against an active mandate. (Aliases: `mandate_debit` and `debit` automatically resolve to `account_debit`).
  - *Cross-product rule*: BVN iGree outages also tag `direct_debit` and `payments` because iGree is required for Mono Sweep mandate authorization.
- **`directpay`**: Pay with bank, payment checkout, and transfer completion.
- **`disbursement`**: Transfers, disbursements, and settlement payouts.

### 2. `connect` (Financial Data)
- Bank account linking, statement fetching, and data enrichment.
- Tracks specific banks (`institution`) and authentication methods (`auth_method: "mobile" | "internet"`).

### 3. `lookup` (Identity Verification / KYC)
- Identity verification APIs: `nin_lookup`, `bvn_igree`, `bvn_legacy`, `cac_lookup`, `tin_lookup`, `account_lookup`, `360_view`, `passport_lookup`.
- Aliases: querying `?product=kyc` or `?product=bvn` automatically resolves to `lookup`.

### 4. `prove` (Widget)
- Standalone biometric & identity widget (`prove_verification`).

---

## Quickstart & Testing

### Installation

Ensure you have [Bun](https://bun.sh) installed (v1.1+):

```bash
git clone https://github.com/khrees/monotor.git
cd monotor
bun install
```

### Running Locally

```bash
# Start development server with hot-reload (runs on http://localhost:3000)
bun run dev

# Or run in production mode
bun run start
```

### Running Tests

The test suite validates parsing, sentence-level negation, granularity, and status resolution:

```bash
bun test
# 40 pass, 0 fail, 155 assertions

# Type checking
bun run typecheck
```

---

## Status Levels & Decision Matrix

When querying `/api/incidents`, the top-level `status`, `has_active_downtime`, and `has_degraded_service` fields tell your backend how to react:

| Status | `has_active_downtime` | `has_degraded_service` | Meaning | Recommended Action |
|---|---|---|---|---|
| **`OPERATIONAL`** | `false` | `false` | All matching services/institutions are operating normally. | Proceed with standard API calls. |
| **`DEGRADED`** | `false` | `true` | An isolated bank is down, or only one auth method is affected (e.g. mobile down, internet working). | Proceed, but route users away from the affected bank/channel. |
| **`DOWNTIME_DETECTED`** | `true` | `false` | Core product downtime (e.g. NIBSS down) or the specific queried bank/method is down. | Halt transactions, queue for retry, or show maintenance warning. |

---

## Real-World Partner Use Cases

### 1. Pre-flight Check Before Debiting Accounts
**Scenario**: Your system has recurring loans or subscriptions to charge via Direct Debit. You want to check if the debit endpoint is healthy before running the billing batch.

```bash
# Canonical service: account_debit (alias: mandate_debit)
curl -s "http://localhost:3000/api/incidents?product=direct_debit&service=account_debit"
```

*Response when operational:*
```json
{
  "status": "OPERATIONAL",
  "has_active_downtime": false,
  "has_degraded_service": false,
  "active_incidents_count": 0,
  "last_checked": "2026-09-07T08:30:00.000Z",
  "active_incidents": []
}
```

*Integration snippet (Node.js / TypeScript):*
```typescript
const res = await fetch("http://localhost:3000/api/incidents?product=direct_debit&service=mandate_debit");
const { has_active_downtime } = await res.json();

if (has_active_downtime) {
  console.warn("Direct Debit processing is currently down. Rescheduling charge batch.");
  return rescheduleBatch(15 * 60 * 1000); // Retry in 15 mins
}

await mono.directDebit.initiateDebit({ mandateId, amount });
```

---

### 2. Mandate Authorization & Mono Sweep Check
**Scenario**: A customer is on your website attempting to set up automated sweeping repayments. You need to verify that mandate creation and authorization are working.

```bash
# Check Mono Sweep specifically (variable mandate type)
curl -s "http://localhost:3000/api/incidents?product=direct_debit&service=mono_sweep"

# Or check general mandate approval
curl -s "http://localhost:3000/api/incidents?product=direct_debit&service=mandate_approval"
```

*Response during NIBSS outage:*
```json
{
  "status": "DOWNTIME_DETECTED",
  "has_active_downtime": true,
  "has_degraded_service": false,
  "active_incidents_count": 1,
  "active_incidents": [
    {
      "id": "yqbzdtffykhm",
      "title": "Direct Debit: Intermittent Downtime",
      "description": "Identified - debit processing is relatively stable now. However, mandate approval is still experiencing downtime from NIBSS.",
      "is_ongoing": true,
      "status": "Identified",
      "products": ["direct_debit", "payments"],
      "affected_services": ["mandate_approval"],
      "scope": "systemic",
      "provider": "NIBSS",
      "severity": "major"
    }
  ]
}
```

---

### 3. Bank-Specific Outage on Connect (Mobile vs Internet Auth)
**Scenario**: Mono Connect is up, but FCMB mobile authentication details are failing. FCMB internet banking is completely functional.

```bash
# General Connect status: DEGRADED (because 1 bank doesn't take down the whole platform)
curl -s "http://localhost:3000/api/incidents?product=connect"
# -> status: "DEGRADED", has_active_downtime: false, has_degraded_service: true

# FCMB specifically without auth_method: DEGRADED (one method works, one doesn't)
curl -s "http://localhost:3000/api/incidents?product=connect&institution=fcmb"
# -> status: "DEGRADED"

# FCMB Mobile Auth: DOWNTIME_DETECTED
curl -s "http://localhost:3000/api/incidents?product=connect&institution=fcmb&auth_method=mobile"
# -> status: "DOWNTIME_DETECTED", has_active_downtime: true

# FCMB Internet Banking: OPERATIONAL (it remains unaffected!)
curl -s "http://localhost:3000/api/incidents?product=connect&institution=fcmb&auth_method=internet"
# -> status: "OPERATIONAL", has_active_downtime: false
```

*UI Benefit*: Instead of telling the customer *"Bank linking is down"*, your frontend can say: *"FCMB mobile login is experiencing temporary issues. Please log in using your Internet Banking credentials."*

---

### 4. Identity Verification (Lookup / KYC)
**Scenario**: You want to check if NIN or BVN lookups are experiencing downtime:

```bash
# Check all lookup services
curl -s "http://localhost:3000/api/incidents?product=lookup"

# Check NIN Lookup specifically
curl -s "http://localhost:3000/api/incidents?product=lookup&service=nin_lookup"

# Legacy alias (works identically to product=lookup)
curl -s "http://localhost:3000/api/incidents?product=kyc"
```

---

### 5. DirectPay (Pay with Bank Checkout)
**Scenario**: Check if checkout and payment completion via DirectPay are operational:

```bash
curl -s "http://localhost:3000/api/incidents?product=payments&service=directpay"
```

---

## API Reference

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Service information, version, and endpoints index |
| `GET` | `/health` | Uptime check and server heartbeat |
| `GET` | `/api/incidents` | Query incident history and compute real-time status |
| `GET` | `/api/incidents/:id` | Retrieve single incident by slug or ID |

---

### Query Parameters

| Parameter | Type | Valid Values & Aliases | Description |
|---|---|---|---|
| `product` | string | `payments`, `direct_debit`, `connect`, `lookup`, `prove`, `general` (Aliases: `kyc`, `bvn`, `data_sync`, `auth`) | Target product |
| `service` | string | `account_debit`, `mandate_approval`, `mandate_creation`, `mandate_authorization`, `mono_sweep`, `nin_lookup`, `bvn_igree`, `bvn_legacy`, `bank_auth`, `directpay`, `disbursement`, etc. (Aliases: `mandate_debit` & `debit` $\to$ `account_debit`; `sweep` $\to$ `mono_sweep`) | Filter by specific capability |
| `institution` | string | `gtbank`, `fcmb`, `zenith`, `stanbic`, `providus`, `nibss`, `wema`, etc. (Alias: `provider`) | Filter by bank or partner provider |
| `auth_method` | string | `mobile`, `internet` | Filter retail banking authentication channel |
| `scope` | string | `institution`, `systemic` | Filter local bank vs central infrastructure issues |
| `severity` | string | `critical`, `major`, `minor`, `none` | Filter by incident severity |
| `status` | string | `identified`, `investigating`, `monitoring`, `resolved` | Statuspage workflow state |
| `ongoing` | boolean | `true`, `false` (default: `false`) | If `true`, returns only active, unresolved incidents |
| `offset` | integer | Default `0` | Pagination start index |
| `limit` | integer | Default `20` (max `100`) | Pagination limit |

---

### Response Shape

```json
{
  "status": "DEGRADED",
  "has_active_downtime": false,
  "has_degraded_service": true,
  "active_incidents_count": 1,
  "last_checked": "2026-09-04T17:46:59.000Z",
  "active_incidents": [
    {
      "id": "ht4433g0pl6s",
      "title": "FCMB Mobile (Authentication Outage)",
      "description": "We are presently investigating an issue where users are encountering challenges in authenticating with their FCMB mobile details. The internet banking authentication method remains unaffected.",
      "link": "https://status.mono.co/incidents/ht4433g0pl6s",
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
  ],
  "incidents": [ /* paginated historical incidents */ ],
  "pagination": {
    "offset": 0,
    "limit": 20,
    "total": 25,
    "returned": 20
  }
}
```

---

### Error Responses

All error responses adhere to a standard JSON contract:

```json
{
  "error": "invalid_param",
  "message": "Invalid product 'unknown'. Valid values: payments, direct_debit, lookup, prove, connect, general"
}
```

| HTTP Status | Error Code | Cause |
|---|---|---|
| `404` | `not_found` | Unknown path or non-existent incident ID |
| `422` | `invalid_param` | Invalid enum value supplied in query parameters |
| `502` | `upstream_unavailable` | Mono Statuspage API unreachable |

---

## In-Process Cache & Cron

To ensure sub-millisecond response times without burdening Statuspage:

- **60-Second TTL Cache**: In-memory caching with request deduplication (in-flight fetches are shared across concurrent requests).
- **Background Cron**: Warms the cache at regular intervals so API queries never experience cold fetches:
  - Default interval: **30 minutes** (`CRON_INTERVAL_MINUTES=30`).
  - Fast alerting: `CRON_INTERVAL_MINUTES=15`.
  - Disable cron: `DISABLE_CRON=true` (relies purely on on-demand fetching).

```bash
# Run with 15-minute background polling
CRON_INTERVAL_MINUTES=15 bun run start
```

---

## Testing & Quality Assurance

The codebase includes 40 comprehensive tests covering:
- Ingestion of Atlassian Statuspage v2 REST API (`unresolved.json` + `incidents.json`).
- Sentence-level negation (preventing "Debit processing remains unaffected" from falsely tagging debits).
- Deduplication of broad categories when specific services are present (e.g. `mandate` $\to$ `mandate_approval`).
- Bank authentication isolation (mobile outage vs internet banking).
- Product and service alias resolution.
- In-memory cache deduplication and background cron warming.

Run tests:
```bash
bun test
```
