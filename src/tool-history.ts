import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";

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

  for (const message of messages) {
    if (message.role === "assistant") {
      closePending();
      const assistant = message as AssistantMessage;
      if (assistant.stopReason === "error" || assistant.stopReason === "aborted") continue;
      pendingCalls = assistant.content.filter((block): block is ToolCall => block.type === "toolCall");
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
