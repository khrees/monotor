/**
 * Mono product taxonomy (from mono.co and docs.mono.co):
 *
 * Financial Data (Connect) — Connect, Statement Pages, Data Enrichment, Creditworthiness, Bank Auth
 * Payments                  — DirectPay, DirectDebit (mandates, debits, Mono Sweep), Global Standing Mandate, Disburse
 * Lookup                    — Identity Verification: BVN (iGree + Legacy), NIN, CAC, TIN, Address, Passport, 360 View, Account Number
 * Prove                     — Standalone identity verification product (Prove widget)
 *
 * Notes:
 * - "KYC" is Mono Lookup (Identity Verification)
 * - BVN iGree is used for both Lookup (identity) AND Direct Debit (mandate approval via Mono Sweep)
 * - Prove is a standalone product, not part of Lookup
 */

export type Product = "direct_debit" | "lookup" | "prove" | "connect" | "payments" | "general";
export type Scope = "institution" | "systemic";
export type AuthMethod = "mobile" | "internet" | null;
export type Severity = "critical" | "major" | "minor" | "none";
export type OutageType =
  | "downtime"
  | "intermittent_downtime"
  | "degraded_performance"
  | "partial_outage"
  | "authentication_outage"
  | "otp_failure"
  | "degraded"
  | "investigating";

export const PRODUCT_ALIASES: Record<string, Product> = {
  kyc: "lookup",
  bvn: "lookup",
  data_sync: "connect",
  auth: "connect",
};

const PRODUCT_PATTERNS: { re: RegExp; product: Product }[] = [
  // Payments → Direct Debit (mandates, debits, Mono Sweep)
  { re: /direct\s*debit|mandate|debit readiness|mono sweep|balance enquiry|providus.*mandate|stanbic.*direct debit/i, product: "direct_debit" },
  // Lookup = Mono's Identity Verification product (BVN, NIN, CAC, TIN, etc.)
  { re: /\bbvn\b|igree|nin\b|lookup|360\s*view|account number|address verification|passport|tin\b|cac\b|identity verification/i, product: "lookup" },
  // Prove is a standalone identity verification product
  { re: /\bprove\b/i, product: "prove" },
  // Financial Data (Connect) — bank-specific auth/data issues
  { re: /data connection|authentication outage|mobile.*auth|internet.*downtime|\bfcmb\b|\buba\b|\bsterling\b|\bgtbank\b|\bgtb\b|\bmoniepoint\b|first bank|access bank|\bzenith\b/i, product: "connect" },
  // Payments — DirectPay, disbursements, transfers
  { re: /pay with bank|directpay|disburs|payment|transfer|settlement/i, product: "payments" },
];

// BVN iGree is also used for mandate approval (Mono Sweep), so iGree incidents
// also tag direct_debit
const CROSS_PRODUCT_RULES: { trigger: RegExp; product: Product }[] = [
  { trigger: /igree|mono sweep/i, product: "direct_debit" },
];

const SERVICE_PATTERNS: { re: RegExp; service: string }[] = [
  { re: /mandate approval/i, service: "mandate_approval" },
  { re: /mandate creation|create.*mandate/i, service: "mandate_creation" },
  { re: /mandate authorization|authorize.*mandate/i, service: "mandate_authorization" },
  { re: /mandate\b/i, service: "mandate" },
  { re: /account debit|initiate a debit|attempting.*debit/i, service: "account_debit" },
  { re: /balance enquiry/i, service: "balance_enquiry" },
  { re: /mono sweep/i, service: "mono_sweep" },
  { re: /debit readiness/i, service: "debit_readiness" },
  { re: /disburs/i, service: "disbursement" },
  { re: /directpay/i, service: "directpay" },
  { re: /nin.*lookup|nin\b/i, service: "nin_lookup" },
  { re: /bvn.*igree|igree/i, service: "bvn_igree" },
  { re: /bvn.*legacy/i, service: "bvn_legacy" },
  { re: /\bbvn\b/i, service: "bvn" },
  { re: /otp/i, service: "otp" },
  { re: /360\s*view/i, service: "360_view" },
  { re: /account number/i, service: "account_lookup" },
  { re: /address verification/i, service: "address_verification" },
  { re: /passport/i, service: "passport_lookup" },
  { re: /tin\b/i, service: "tin_lookup" },
  { re: /cac\b/i, service: "cac_lookup" },
  { re: /\bprove\b/i, service: "prove_verification" },
  { re: /lookup\b.*api|lookup api/i, service: "lookup_api" },
  { re: /pay with transfer/i, service: "pay_with_transfer" },
  { re: /mobile.*auth|authentication outage|bank.*auth|authenticating with.*(?:bank|fcmb|uba|gtb|zenith|internet details)|internet.*downtime/i, service: "bank_auth" },
];

const OUTAGE_PATTERNS: { re: RegExp; type: OutageType }[] = [
  { re: /otp failure/i, type: "otp_failure" },
  { re: /intermittent/i, type: "intermittent_downtime" },
  { re: /authentication outage/i, type: "authentication_outage" },
  { re: /degraded performance/i, type: "degraded_performance" },
  { re: /partial outage/i, type: "partial_outage" },
  { re: /degraded/i, type: "degraded" },
  { re: /downtime/i, type: "downtime" },
  { re: /investigating/i, type: "investigating" },
];

const PROVIDER_PATTERNS: { re: RegExp; provider: string }[] = [
  { re: /nibss/i, provider: "NIBSS" },
  { re: /\bcac\b/i, provider: "CAC" },
  { re: /stanbic ibtc/i, provider: "Stanbic IBTC" },
  { re: /providus/i, provider: "Providus Bank" },
  { re: /\bfcmb\b/i, provider: "FCMB" },
  { re: /\buba\b/i, provider: "UBA" },
  { re: /\bsterling\b/i, provider: "Sterling Bank" },
  { re: /\bgtbank\b|\bgtb\b/i, provider: "GTBank" },
  { re: /\bwema\b|\balat\b/i, provider: "Wema Bank" },
  { re: /\bmoniepoint\b/i, provider: "Moniepoint" },
  { re: /\bmomo\b|\bmtn\b/i, provider: "MTN Momo" },
  { re: /first bank/i, provider: "First Bank" },
  { re: /access bank/i, provider: "Access Bank" },
  { re: /\bzenith\b/i, provider: "Zenith Bank" },
  { re: /\bkuda\b/i, provider: "Kuda Bank" },
  { re: /\bopay\b/i, provider: "OPay" },
];

const SYSTEMIC_PROVIDERS = new Set(["NIBSS", "CAC"]);

export function inferScope(title: string, text: string, provider: string | null): Scope {
  if (!provider) return "systemic";
  if (SYSTEMIC_PROVIDERS.has(provider)) return "systemic";
  return "institution";
}

const SEVERITY_MAP: Record<string, Severity> = {
  critical: "critical",
  major: "major",
  minor: "minor",
};

export function inferProducts(title: string, text: string): Product[] {
  const combined = `${title} ${text}`;
  const found = new Set<Product>();
  for (const { re, product } of PRODUCT_PATTERNS) {
    if (re.test(combined)) found.add(product);
  }
  // Cross-product rules (e.g. iGree → also direct_debit)
  for (const { trigger, product } of CROSS_PRODUCT_RULES) {
    if (trigger.test(combined)) found.add(product);
  }
  if (found.size === 0) found.add("general");
  return [...found];
}

export function inferAffectedServices(title: string, text: string): string[] {
  const combined = `${title} ${text}`;
  const services = new Set<string>();
  for (const { re, service } of SERVICE_PATTERNS) {
    if (re.test(combined)) services.add(service);
  }
  if (
    services.has("mandate") &&
    (services.has("mandate_approval") || services.has("mandate_creation") || services.has("mandate_authorization"))
  ) {
    services.delete("mandate");
  }
  if (services.has("bvn") && (services.has("bvn_igree") || services.has("bvn_legacy"))) {
    services.delete("bvn");
  }
  return [...services];
}

export function inferOutageType(title: string, text: string): OutageType {
  const combined = `${title} ${text}`;
  for (const { re, type } of OUTAGE_PATTERNS) {
    if (re.test(combined)) return type;
  }
  return "downtime";
}

export function inferProvider(title: string, text: string): string | null {
  const combined = `${title} ${text}`;
  for (const { re, provider } of PROVIDER_PATTERNS) {
    if (re.test(combined)) return provider;
  }
  return null;
}

export function inferAuthMethod(title: string, text: string): AuthMethod {
  const combined = `${title} ${text}`.toLowerCase();
  const titleLower = title.toLowerCase();

  if (titleLower.includes("mobile")) return "mobile";
  if (titleLower.includes("internet")) return "internet";

  if (/authenticating with.*mobile|specific to.*mobile|mobile authentication|mobile details/i.test(combined)) {
    return "mobile";
  }
  if (/authenticating with.*internet|specific to.*internet|internet (?:banking|downtime)|internet details/i.test(combined)) {
    return "internet";
  }

  return null;
}

export function inferSeverity(title: string, text: string, impactHint?: string): Severity {
  if (impactHint && SEVERITY_MAP[impactHint.toLowerCase()]) return SEVERITY_MAP[impactHint.toLowerCase()];
  const combined = `${title} ${text}`.toLowerCase();
  if (combined.includes("critical") || combined.includes("authentication outage") || combined.includes("major")) return "major";
  if (combined.includes("intermittent") || combined.includes("degraded") || combined.includes("partial")) return "minor";
  if (combined.includes("downtime") || combined.includes("outage") || combined.includes("investigating") || combined.includes("identified")) return "major";
  return "minor";
}

export function classifyIncident(title: string, descriptionText: string, descriptionRaw: string) {
  const text = descriptionText || descriptionRaw;
  const provider = inferProvider(title, text);
  return {
    products: inferProducts(title, text),
    affected_services: inferAffectedServices(title, text),
    outage_type: inferOutageType(title, text),
    provider,
    institution: provider,
    auth_method: inferAuthMethod(title, text),
    scope: inferScope(title, text, provider),
    severity: inferSeverity(title, text),
  };
}
