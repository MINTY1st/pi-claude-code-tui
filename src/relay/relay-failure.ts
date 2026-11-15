/**
 * relay の失敗を、Pi の再試行判定（pi-ai の isRetryableAssistantError）が読む最終エラー文言に変える。
 * Claude Code には CLAUDE_CODE_MAX_RETRIES=0 を渡すため、一時的な障害を再試行できるのは Pi だけである
 */

export type RelayFailureKind = "request" | "connect" | "disconnect" | "capture";

export interface RelayFailure {
  kind: RelayFailureKind;
  /** name と code だけ。4xx の本文読み取り中の切断で、message の再試行語を最終文言に出さないために使う */
  summary: string;
  detail: string;
}

export interface RelayOutcome {
  status?: number;
  failure?: RelayFailure;
  denied: number;
  capture: { complete: boolean };
  errorText(): string;
}

const MAX_DETAIL_LENGTH = 1_000;
const MAX_UPSTREAM_TEXT_LENGTH = 500;

// pi-ai の RETRYABLE_PROVIDER_ERROR_PATTERN の connection.?error / connection.?lost に一致させる
const TRANSIENT_PREFIX: Record<"connect" | "disconnect", string> = {
  connect: "Claude Code upstream connection error",
  disconnect: "Claude Code upstream connection lost",
};

export class CaptureError extends Error {
  constructor(cause: unknown) {
    super(`Claude Code stream handling failed: ${describeError(cause)}`, { cause });
    this.name = "CaptureError";
  }
}

function label(error: Error): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? `${error.name} [${code}]` : error.name;
}

function headline(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message ? `${label(error)}: ${error.message}` : label(error);
}

export function describeError(error: unknown): string {
  const inner = error instanceof AggregateError ? (error.errors as unknown[]) : [];
  const text = inner.length > 0 ? `${headline(error)} (errors: ${inner.map(headline).join("; ")})` : headline(error);
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

export function relayFailure(kind: RelayFailureKind, error: unknown): RelayFailure {
  return { kind, summary: error instanceof Error ? label(error) : "UnknownError", detail: describeError(error) };
}

function isClientError(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500;
}

function transientPrefix(outcome: Pick<RelayOutcome, "status" | "failure">): string | undefined {
  const kind = outcome.failure?.kind;
  if (kind === "connect") return TRANSIENT_PREFIX.connect;
  if (kind === "disconnect" && !isClientError(outcome.status)) return TRANSIENT_PREFIX.disconnect;
  return undefined;
}

export function isTransientRelayFailure(outcome: Pick<RelayOutcome, "status" | "failure">): boolean {
  return transientPrefix(outcome) !== undefined;
}

function failureText(outcome: Pick<RelayOutcome, "status" | "failure">): string | undefined {
  const failure = outcome.failure;
  if (!failure) return undefined;
  return failure.kind === "disconnect" && isClientError(outcome.status) ? failure.summary : failure.detail;
}

export function incompleteUpstreamMessage(outcome: RelayOutcome): string {
  let detail = `status ${outcome.status ?? "unknown"}, capture ${outcome.capture.complete ? "complete" : "incomplete"}`;
  const failure = failureText(outcome);
  if (failure) detail += `, relay failure ${failure}`;
  if (outcome.denied) detail += `, native retries denied ${outcome.denied}`;
  const upstreamError = outcome.errorText();
  if (upstreamError) detail += `, upstream said: ${upstreamError.slice(0, MAX_UPSTREAM_TEXT_LENGTH)}`;
  const message = `Incomplete Claude Code upstream response (${detail})`;
  const prefix = transientPrefix(outcome);
  return prefix ? `${prefix}: ${message}` : message;
}
