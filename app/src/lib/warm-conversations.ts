import { prefetchThreadMessages } from "@/lib/copilot/thread-messages";
import {
  currentOrganizationId,
  organizationHeaders,
} from "@/lib/organizations/current";

/**
 * Read the stored history of the conversations in the sidebar before anybody clicks one.
 *
 * Opening a conversation connects the Bot's agent and then reads its thread; the read is the part
 * this can move earlier. The warm read is one-shot: the moment the conversation asks for its own
 * history it takes this copy, so nothing stale is kept after the read has been used.
 */

type Conversation = { threadId?: string; botIds?: string[]; lastMessageBotId?: string };

let started = false;

export function warmConversations(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  fetch("/api/v2/organizations/default/conversations", {
    headers: organizationHeaders(currentOrganizationId()),
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { conversations?: Conversation[] } | null) => {
      for (const conversation of body?.conversations ?? []) {
        const agentId = conversation.botIds?.[0] ?? conversation.lastMessageBotId;
        if (conversation.threadId && agentId) {
          void prefetchThreadMessages(conversation.threadId, agentId);
        }
      }
    })
    .catch(() => {
      /* A warm read that fails costs nothing: the conversation reads on open as it always did. */
    });
}
