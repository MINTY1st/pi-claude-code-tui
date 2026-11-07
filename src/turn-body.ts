// output_config（effort）はターンごとに変わる。CLAUDE_CODE_EXTRA_BODY は Claude Code の起動時にしか読まれないため、
// 値まで指紋に入れると effort が変わるたびに 2〜7秒かけて起動し直す。この2つの値は relay が毎ターン本文へ書く
export const TURN_BODY_KEYS = ["output_config", "context_management"] as const;

export type TurnBodyKey = (typeof TURN_BODY_KEYS)[number];
export type TurnBody = Partial<Record<TurnBodyKey, unknown>>;

export interface LaunchIdentity {
  body: Record<string, unknown>;
  turnKeys: TurnBodyKey[];
}

/** extraBody のうち、relay がターンごとに本文へ書くキーと値だけを取り出す。 */
export function turnBodyOf(extraBody: Record<string, unknown>): TurnBody {
  const turn: TurnBody = {};
  for (const key of TURN_BODY_KEYS) {
    if (extraBody[key] !== undefined) turn[key] = structuredClone(extraBody[key]);
  }
  return turn;
}

// 値は指紋から外すが、キーの有無は残す。起動時の CLAUDE_CODE_EXTRA_BODY に output_config.effort が無いと、
// Claude Code は自分で anthropic-beta に effort-2025-11-24 を足す（2.1.317 の静的読解）ため、有無が変わったら起動し直す
export function launchIdentity(extraBody: Record<string, unknown>): LaunchIdentity {
  const body = { ...extraBody };
  for (const key of TURN_BODY_KEYS) delete body[key];
  return { body, turnKeys: TURN_BODY_KEYS.filter((key) => extraBody[key] !== undefined) };
}

// Claude Code が本文に入れたキーだけを差し替え、無いキーは足さない。起動時の settings と同じキーを持つ Claude Code が
// そのキーを落としたなら（モデルが effort に対応しないときの output_config など）、変更前も上流へは送っていなかったため
/** 本文の最上位のキーをターンの値で丸ごと置き換える。中身は混ぜず、ほかのキーには触らない。 */
export function applyTurnBody(body: Buffer, turn: TurnBody): Buffer {
  const entries = Object.entries(turn);
  if (entries.length === 0) return body;
  const payload: unknown = JSON.parse(body.toString("utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Claude Code request body must be a JSON object");
  }
  for (const [key, value] of entries) {
    if (Object.hasOwn(payload, key)) (payload as Record<string, unknown>)[key] = structuredClone(value);
  }
  return Buffer.from(JSON.stringify(payload));
}
