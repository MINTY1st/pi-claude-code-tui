import type { NativeMessage, NativeUsage } from "./native-types.ts";
import { incompleteUpstreamMessage, type RelayOutcome } from "./relay-failure.ts";

/** TurnRelay が満たす形。テストで relay を立てずに偽の結果を渡すため、クラスではなく形で受ける */
export interface CapturedOutcome extends RelayOutcome {
  capture: { complete: boolean; message?: NativeMessage };
}

/** 上流の応答が 200 で、message_stop まで受け取れていれば、その message を返す。そうでなければ投げる */
export function capturedMessage(outcome: CapturedOutcome): NativeMessage {
  if (outcome.status === 200 && outcome.capture.complete && outcome.capture.message) return outcome.capture.message;
  throw new Error(incompleteUpstreamMessage(outcome));
}

// -p 経路は message.usage が無いとき result.usage を渡す。どちらを渡すかは呼び出し側が決める
/** input_tokens と output_tokens が数で入っている usage だけを通す */
export function completeUsage(usage: NativeUsage | undefined): NativeUsage {
  if (!usage || typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") {
    throw new Error("Claude Code response did not include complete token usage");
  }
  return usage;
}
