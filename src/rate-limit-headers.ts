import type { RateLimitInfo } from "./billing.ts";

// 対話 TUI には -p の rate_limit_event が無いため、relay が受けた上流のヘッダーから同じ情報を作る。
// 変換の式は Claude Code 2.1.316 がヘッダーから rate_limit_info を作る処理に合わせている
const PREFIX = "anthropic-ratelimit-unified-";
const OVERAGE_SERVING = new Set(["allowed", "allowed_warning"]);

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | undefined {
  const value = headers[PREFIX + name];
  return Array.isArray(value) ? value[0] : value;
}

function epochSeconds(value: string | undefined): number | undefined {
  const seconds = Math.round(Number(value));
  return value && Number.isFinite(seconds) ? seconds : undefined;
}

function definedOnly(record: Record<string, unknown>): RateLimitInfo {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as RateLimitInfo;
}

export function rateLimitFromHeaders(headers: Headers): RateLimitInfo | undefined {
  if (!Object.keys(headers).some((name) => name.toLowerCase().startsWith(PREFIX))) return undefined;
  const status = header(headers, "status") ?? "allowed";
  const overageStatus = header(headers, "overage-status");
  return definedOnly({
    status: status === "allowed_warning" ? "allowed" : status,
    resetsAt: epochSeconds(header(headers, "reset")),
    rateLimitType: header(headers, "representative-claim"),
    overageStatus,
    overageDisabledReason: header(headers, "overage-disabled-reason"),
    // プラン枠を断られたのに応答が返った = 使用量クレジットで払われた
    isUsingOverage: status === "rejected" && OVERAGE_SERVING.has(overageStatus ?? ""),
  });
}
