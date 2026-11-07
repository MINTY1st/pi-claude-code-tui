// 実装担当は、この関数を src/billing.ts の usageCreditsChargeError の直後へ足す（このファイルは新しく作らない）
// import は不要（同じファイルの usageCreditsAllowed・usageCreditsChargeError・RateLimitInfo を使う）

// 環境変数は呼び出し側で process.env と Pi の env を混ぜて渡す。この関数は process.env を読まない
/** 使用量クレジットで払われた応答なら、許可の環境変数が無い限り投げる */
export function guardUsageCredits(rateLimit: RateLimitInfo | undefined, environment: Record<string, string | undefined>): void {
  if (rateLimit?.isUsingOverage === true && !usageCreditsAllowed(environment)) throw usageCreditsChargeError(rateLimit);
}
