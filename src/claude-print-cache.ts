import { registerSessionResourceCleanup } from "@earendil-works/pi-ai";
import {
  ClaudeProcess,
  launchPlan,
  type ClaudeLaunchPlan,
  type RunClaudeInput,
  type RunClaudeOutput,
} from "./claude-print-process.ts";

const MAX_CACHED_CLAUDE_PROCESSES = 2;

interface AcquiredProcess {
  worker: ClaudeProcess;
  retained: boolean;
  continuation: boolean;
  sessionId?: string;
}

const processCache = new Map<string, ClaudeProcess>();
let managerTail: Promise<void> = Promise.resolve();

async function withManagerLock<T>(operation: () => Promise<T> | T): Promise<T> {
  const previous = managerTail;
  let release!: () => void;
  managerTail = new Promise<void>((resolve) => (release = resolve));
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function expireProcess(sessionId: string, worker: ClaudeProcess): Promise<void> {
  const expired = await withManagerLock(() => {
    if (processCache.get(sessionId) !== worker || worker.busy || !worker.isExpired()) return false;
    processCache.delete(sessionId);
    return true;
  });
  if (expired) await worker.close();
}

/** Drop a worker from the warm cache (if it is still there) and close it. */
async function discardProcess(acquired: AcquiredProcess): Promise<void> {
  const { sessionId, worker } = acquired;
  if (sessionId && processCache.get(sessionId) === worker) {
    await withManagerLock(() => {
      if (processCache.get(sessionId) === worker) processCache.delete(sessionId);
    });
  }
  await worker.close();
}

async function acquireProcess(input: RunClaudeInput, plan: ClaudeLaunchPlan): Promise<AcquiredProcess> {
  return withManagerLock(async () => {
    const sessionId = input.sessionId;
    const cached = sessionId ? processCache.get(sessionId) : undefined;
    if (cached && !cached.busy) {
      cached.clearExpiryTimer();
      if (
        cached.isAlive() &&
        !cached.isExpired() &&
        cached.fingerprint === plan.fingerprint &&
        cached.canContinue(input)
      ) {
        cached.busy = true;
        return { worker: cached, retained: true, continuation: true, sessionId };
      }
      processCache.delete(sessionId!);
      await cached.close();
    }

    // A concurrent request must not mutate the cached conversation. It gets a
    // one-shot process, as does a request without Pi's stable session ID.
    const retain = !!sessionId && !cached?.busy;
    if (retain) {
      while (processCache.size >= MAX_CACHED_CLAUDE_PROCESSES) {
        const victim = [...processCache.entries()]
          .filter(([, worker]) => !worker.busy)
          .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
        if (!victim) break;
        processCache.delete(victim[0]);
        await victim[1].close();
      }
    }

    const worker = await ClaudeProcess.create(input, plan);
    worker.busy = true;
    const retained = retain && processCache.size < MAX_CACHED_CLAUDE_PROCESSES;
    if (retained) processCache.set(sessionId!, worker);
    return { worker, retained, continuation: false, sessionId };
  });
}

/** Close warm Claude processes for one Pi session, or all sessions. */
export async function closeClaudeProcesses(sessionId?: string): Promise<void> {
  const workers = await withManagerLock(() => {
    if (sessionId) {
      const worker = processCache.get(sessionId);
      processCache.delete(sessionId);
      return worker ? [worker] : [];
    }
    const all = [...processCache.values()];
    processCache.clear();
    return all;
  });
  await Promise.allSettled(workers.map((worker) => worker.close()));
}

/** Test/debug visibility without exposing child processes themselves. */
export function cachedClaudeProcessCount(): number {
  return processCache.size;
}

registerSessionResourceCleanup((sessionId) => {
  void closeClaudeProcesses(sessionId);
});

export async function runClaudeRequest(input: RunClaudeInput): Promise<RunClaudeOutput> {
  input.signal?.throwIfAborted();
  const plan = launchPlan(input);
  const acquired = await acquireProcess(input, plan);
  try {
    const output = await acquired.worker.run(input, acquired.continuation);
    const stable = acquired.worker.commit(input, output.message);
    if (
      stable &&
      acquired.retained &&
      acquired.sessionId &&
      processCache.get(acquired.sessionId) === acquired.worker
    ) {
      acquired.worker.busy = false;
      acquired.worker.armExpiryTimer(() => {
        void expireProcess(acquired.sessionId!, acquired.worker);
      });
    } else {
      await discardProcess(acquired);
    }
    return output;
  } catch (error) {
    await discardProcess(acquired);
    throw error;
  }
}
