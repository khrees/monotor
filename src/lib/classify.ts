/**
 * Mono product taxonomy (from mono.co and docs.mono.co):
 *
 * Financial Data (Connect) — Connect, Statement Pages, Data Enrichment, Creditworthiness, Bank Auth
 * Payments                  — DirectPay, DirectDebit (Mandates, Mono Sweep, Mandate Debits), Global Standing Mandate, Disburse
 * Lookup                    — Identity Verification: BVN (iGree + Legacy), NIN, CAC, TIN, Address, Passport, 360 View, Account Number
 * Prove                     — Standalone identity verification product (Prove widget)
 *
 * Notes on Direct Debit:
 * - A Mandate is an authorization granted by an account holder allowing recurring debits.
 * - Mono Sweep is a mandate type (variable sweeping mandate) on Direct Debit, NOT a debit transaction itself.
 * - Mandate lifecycle consists of creation, authorization (e.g. via BVN iGree or bank consent), and approval.
 * - Mandate Debit refers to the execution / initiation of a debit charge against an authorized mandate.
 * - BVN iGree outages affect both Lookup (identity) AND Direct Debit (mandate authorization for Mono Sweep).
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
  // Payments → Direct Debit (Mandates, Mono Sweep, Mandate Debits)
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

// BVN iGree is used for Mandate Authorization (Mono Sweep Mandate), so iGree or sweep incidents
// also tag direct_debit
const CROSS_PRODUCT_RULES: { trigger: RegExp; product: Product }[] = [
  { trigger: /igree|mono sweep|sweep mandate/i, product: "direct_debit" },
];

const UNAFFECTED_PATTERNS = [
  /remains?\s+unaffected/i,
  /\bunaffected\b/i,
  /not\s+affected/i,
  /continues?\s+to\s+operate\s+normally/i,
  /operating\s+normally/i,
  /relatively\s+stable/i,
  /continue\s+using/i,
  /is\s+up\s+and\s+(?:fully\s+)?functional/i,
];

/**
 * Checks if a mention in the incident text is described as unaffected, operational, or stable
 * (e.g., "Debit processing remains unaffected and continues to operate normally.")
 * Evaluates the specific clause/sentence boundary rather than a naive character window.
 */
export function isMentionUnaffected(text: string, matchIndex: number, matchLength: number): boolean {
  const delimiters = /[.;\n]|However\b|However,|But\b|But,/i;

  let clauseStart = 0;
  for (let i = matchIndex - 1; i >= 0; i--) {
    if (delimiters.test(text[i]) || (i >= 7 && /However|But/i.test(text.slice(Math.max(0, i - 7), i + 1)))) {
      clauseStart = i + 1;
      break;
    }
  }

  const after = text.slice(matchIndex + matchLength);
  let clauseEnd = text.length;
  const rel = after.search(delimiters);
  if (rel !== -1) {
    clauseEnd = matchIndex + matchLength + rel;
  }

  const clause = text.slice(clauseStart, clauseEnd);
  return UNAFFECTED_PATTERNS.some((p) => p.test(clause));
}

const SERVICE_PATTERNS: { re: RegExp; service: string }[] = [
  // Direct Debit: Mandate lifecycle
  { re: /mandate\s+approval|mandates?\s+(?:are|is)\s+not\s+(?:getting|being)\s+approved|e-mandate\s+approval|approval\s+services?|\bapproval\b/i, service: "mandate_approval" },
  { re: /mandate\s+creation|create.*mandate|creating.*mandate|\bcreation\b/i, service: "mandate_creation" },
  { re: /mandate\s+authorization|authorize.*mandate|authorizing.*mandate/i, service: "mandate_authorization" },
  // Direct Debit: Mandate types (Mono Sweep is a variable sweeping mandate, not a debit itself)
  { re: /mono sweep|sweep mandate/i, service: "mono_sweep" },
  { re: /e-mandate|emandate/i, service: "e_mandate" },
  { re: /mandate\b/i, service: "mandate" },

  // Direct Debit: Account Debit (charging funds against an authorized mandate)
  { re: /(?:mandate|account)\s+debits?|debit\s+mandates?|initiat(?:e|ing)\s+(?:a\s+)?debit|(?:attempt(?:ing)?|unable)\s+to\s+(?:initiate\s+)?(?:a\s+)?debit|attempt(?:ing)?\s+(?:a\s+)?debit|debit\s+(?:services?|processing|failures?|outages?|downtimes?|operations?|transactions?)|debiting/i, service: "account_debit" },
  { re: /balance enquiry/i, service: "balance_enquiry" },
  { re: /debit readiness/i, service: "debit_readiness" },

  // Payments
  { re: /disburs/i, service: "disbursement" },
  { re: /directpay|payment completion|pay with bank/i, service: "directpay" },
  { re: /pay with transfer/i, service: "pay_with_transfer" },

  // Lookup (Identity Verification)
  { re: /nin.*lookup|nin\b/i, service: "nin_lookup" },
  { re: /bvn.*igree|igree/i, service: "bvn_igree" },
  { re: /bvn.*legacy/i, service: "bvn_legacy" },
  { re: /\bbvn\b/i, service: "bvn" },
  { re: /otp\b/i, service: "otp" },
  { re: /360\s*view/i, service: "360_view" },
  { re: /account number/i, service: "account_lookup" },
  { re: /address verification/i, service: "address_verification" },
  { re: /passport/i, service: "passport_lookup" },
  { re: /tin\b|tin.*lookup/i, service: "tin_lookup" },
  { re: /cac\b|cac.*lookup/i, service: "cac_lookup" },
  { re: /lookup\b.*api|lookup api/i, service: "lookup_api" },

  // Prove widget
  { re: /\bprove\b/i, service: "prove_verification" },

  // Connect (Bank Auth & Data)
  { re: /mobile\b[^.;\n]*?auth|authentication outage|bank\s+auth|authenticating with|internet\s+downtime/i, service: "bank_auth" },
  { re: /data connection|data sync|account linking/i, service: "data_sync" },
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
  // Cross-product rules (e.g. iGree / Mono Sweep mandate → also direct_debit)
  for (const { trigger, product } of CROSS_PRODUCT_RULES) {
    if (trigger.test(combined)) found.add(product);
  }
  // Direct Debit is under Payments (alongside DirectPay & Disburse)
  if (found.has("direct_debit")) {
    found.add("payments");
  }
  if (found.size === 0) found.add("general");
  return [...found];
}

export function inferAffectedServices(title: string, text: string): string[] {
  const combined = `${title} ${text}`;
  const services = new Set<string>();

  for (const { re, service } of SERVICE_PATTERNS) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const globalRe = new RegExp(re.source, flags);
    let match: RegExpExecArray | null;
    while ((match = globalRe.exec(combined)) !== null) {
      if (!isMentionUnaffected(combined, match.index, match[0].length)) {
        services.add(service);
        break;
      }
    }
  }

  // Deduplicate generic 'mandate' if more specific mandate services/types are detected
  if (
    services.has("mandate") &&
    (services.has("mandate_approval") ||
      services.has("mandate_creation") ||
      services.has("mandate_authorization") ||
      services.has("account_debit") ||
      services.has("mono_sweep") ||
      services.has("e_mandate"))
  ) {
    services.delete("mandate");
  }

  // Deduplicate generic 'bvn' if specific BVN sub-services are detected
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
  const titleLower = title.toLowerCase();
  if (titleLower.includes("mobile")) return "mobile";
  if (titleLower.includes("internet")) return "internet";

  const combined = `${title} ${text}`;
  const mobileMatch = /authenticating with.*mobile|specific to.*mobile|mobile authentication|mobile details/i.exec(combined);
  const internetMatch = /authenticating with.*internet|specific to.*internet|internet (?:banking|downtime)|internet details/i.exec(combined);

  const mobileValid = mobileMatch && !isMentionUnaffected(combined, mobileMatch.index, mobileMatch[0].length);
  const internetValid = internetMatch && !isMentionUnaffected(combined, internetMatch.index, internetMatch[0].length);

  if (mobileValid && !internetValid) return "mobile";
  if (internetValid && !mobileValid) return "internet";
  if (mobileValid && internetValid) return null;

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
