interface PendingRequest {
  sessionId?: string;
  controller: AbortController;
  done: Promise<void>;
}

// キャッシュ登録前の起動と使い捨ての並行要求も、セッション破棄を追い越してはならない。
const pending = new Set<PendingRequest>();

export async function trackTuiRequest<T>(
  sessionId: string | undefined,
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const completion = Promise.withResolvers<void>();
  const request = { sessionId, controller, done: completion.promise };
  pending.add(request);
  try {
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    combined.throwIfAborted();
    return await operation(combined);
  } catch (error) {
    // 片付けで止めた要求は、途中で出た「Claude Code ended」などではなく中断として返す
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    pending.delete(request);
    completion.resolve();
  }
}

export async function abortTuiRequests(sessionId?: string): Promise<void> {
  const targets = [...pending].filter((request) => sessionId === undefined || request.sessionId === sessionId);
  for (const request of targets) request.controller.abort(new DOMException("Claude Code TUI session was closed", "AbortError"));
  await Promise.all(targets.map((request) => request.done));
}
