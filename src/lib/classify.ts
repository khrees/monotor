export type Product = "direct_debit" | "lookup" | "bvn" | "kyc" | "data_sync" | "auth" | "payments" | "mandate" | "general";
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

const PRODUCT_PATTERNS: { re: RegExp; product: Product }[] = [
  { re: /direct\s*debit|mandate|debit readiness|mono sweep|balance enquiry|providus.*mandate|stanbic.*direct debit/i, product: "direct_debit" },
  { re: /\bbvn\b|igree|nin.*bvn|bvn.*legacy/i, product: "bvn" },
  { re: /lookup|nin\b|360\s*view|account number|address verification|passport lookup|tin\b|cac\b|prove/i, product: "lookup" },
  { re: /kyc|identity|tin\b|cac|prove verification/i, product: "kyc" },
  { re: /fcmb|uba|sterling|gtbank|moniepoint|wema|alat|first bank|access bank|zenith|data connection/i, product: "data_sync" },
  { re: /authentication outage|mobile.*auth|internet.*downtime/i, product: "auth" },
  { re: /pay with bank|directpay|disburs|payment|transfer|settlement/i, product: "payments" },
];

const SERVICE_PATTERNS: { re: RegExp; service: string }[] = [
  { re: /mandate approval/i, service: "mandate_approval" },
  { re: /mandate creation/i, service: "mandate_creation" },
  { re: /mandate authorization/i, service: "mandate_authorization" },
  { re: /mandate\b/i, service: "mandate" },
  { re: /account debit|initiate a debit/i, service: "account_debit" },
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
  { re: /prove/i, service: "prove_verification" },
  { re: /lookup\b.*api|lookup api/i, service: "lookup_api" },
  { re: /pay with transfer/i, service: "pay_with_transfer" },
  { re: /mobile.*auth|authentication outage/i, service: "bank_auth" },
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
  { re: /stanbic ibtc/i, provider: "Stanbic IBTC" },
  { re: /providus/i, provider: "Providus Bank" },
  { re: /fcmb/i, provider: "FCMB" },
  { re: /uba\b/i, provider: "UBA" },
  { re: /sterling/i, provider: "Sterling Bank" },
  { re: /gtbank|gtb/i, provider: "GTBank" },
  { re: /wema|alat/i, provider: "Wema Bank" },
  { re: /moniepoint/i, provider: "Moniepoint" },
  { re: /momo|mtn\b/i, provider: "MTN Momo" },
];

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
  if (found.size === 0) found.add("general");
  return [...found];
}

export function inferAffectedServices(title: string, text: string): string[] {
  const combined = `${title} ${text}`;
  const services = new Set<string>();
  for (const { re, service } of SERVICE_PATTERNS) {
    if (re.test(combined)) services.add(service);
  }
  if (services.has("mandate") && (services.has("mandate_approval") || services.has("mandate_creation"))) {
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
  return {
    products: inferProducts(title, text),
    affected_services: inferAffectedServices(title, text),
    outage_type: inferOutageType(title, text),
    provider: inferProvider(title, text),
    severity: inferSeverity(title, text),
  };
}
