import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";

function isFailedTurn(message: Message): message is AssistantMessage {
  return message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted");
}

// Results of a dropped turn must go too, or they would reference a missing tool_use.
// Scope ends at the next assistant turn because some providers reuse ids like call_0.
function withoutFailedTurns(messages: Message[]): Message[] {
  const dropped = new Set<string>();
  return messages.filter((message) => {
    if (message.role === "assistant") dropped.clear();
    if (isFailedTurn(message)) {
      for (const block of message.content) if (block.type === "toolCall") dropped.add(block.id);
      return false;
    }
    return !(message.role === "toolResult" && dropped.has(message.toolCallId));
  });
}

// Mirrors pi-ai's transformMessages (not exported): Anthropic rejects a tool_use
// that is not answered by a tool_result in the next message, which happens when
// a turn was aborted or failed, possibly under another provider.
export function repairToolHistory(messages: Message[]): Message[] {
  const repaired: Message[] = [];
  const heldSystem: Message[] = [];
  let pendingCalls: ToolCall[] = [];
  let answered = new Set<string>();

  const closePending = () => {
    for (const call of pendingCalls) {
      if (answered.has(call.id)) continue;
      const synthetic: ToolResultMessage = {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: "No result provided" }],
        isError: true,
        timestamp: 0,
      };
      repaired.push(synthetic);
    }
    pendingCalls = [];
    answered = new Set();
    repaired.push(...heldSystem);
    heldSystem.length = 0;
  };

  for (const message of withoutFailedTurns(messages)) {
    if (message.role === "assistant") {
      closePending();
      pendingCalls = message.content.filter((block): block is ToolCall => block.type === "toolCall");
      repaired.push(message);
    } else if (message.role === "toolResult") {
      answered.add(message.toolCallId);
      repaired.push(message);
    } else if (message.role === "system" && pendingCalls.length > 0) {
      heldSystem.push(message);
    } else {
      if (message.role === "user") closePending();
      repaired.push(message);
    }
  }
  closePending();
  return repaired;
}
