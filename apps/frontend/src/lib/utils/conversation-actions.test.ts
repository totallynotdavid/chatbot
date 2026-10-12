/// <reference types="bun" />

import { describe, it, expect, afterEach } from "bun:test";
import {
  acceptAssignment,
  releaseConversation,
  takeOverConversation,
  type ConversationActionContext,
} from "./conversation-actions.ts";

const realFetch = globalThis.fetch;

describe("a conversation action on the dashboard", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function page(respond: (url: string) => Response) {
    const requests: string[] = [];
    const shown: Array<{ kind: "success" | "error"; message: string }> = [];
    let refreshes = 0;

    globalThis.fetch = (async (url: string) => {
      requests.push(url);
      return respond(url);
    }) as unknown as typeof fetch;

    const context: ConversationActionContext = {
      phoneNumber: "51900444001",
      channelQuery: "?channel=ca-1",
      refresh: async () => {
        refreshes++;
      },
      notify: {
        success: (message) => shown.push({ kind: "success", message }),
        error: (message) => shown.push({ kind: "error", message }),
      },
    };

    return { context, requests, shown, refreshes: () => refreshes };
  }

  const refuse = (status: number, error: string) => () =>
    new Response(JSON.stringify({ error }), { status });
  const accept = () => new Response(JSON.stringify({ success: true }));

  it("posts a takeover for the conversation's channel and confirms it", async () => {
    const { context, requests, shown, refreshes } = page(accept);

    expect(await takeOverConversation(context)).toBe(true);

    expect(requests).toEqual([
      "/api/conversations/51900444001/takeover?channel=ca-1",
    ]);
    expect(refreshes()).toBe(1);
    expect(shown).toEqual([
      { kind: "success", message: "Has tomado control de la conversación" },
    ]);
  });

  describe("when the server answers 409", () => {
    const taken = "Another agent has already taken this conversation";

    it("shows the message for a takeover and does not claim success", async () => {
      const { context, shown, refreshes } = page(refuse(409, taken));

      expect(await takeOverConversation(context)).toBe(false);

      expect(shown).toEqual([{ kind: "error", message: taken }]);
      expect(refreshes()).toBe(0);
    });

    it("shows the message for accepting an assignment", async () => {
      const { context, shown } = page(refuse(409, taken));

      expect(await acceptAssignment(context)).toBe(false);

      expect(shown).toEqual([{ kind: "error", message: taken }]);
    });

    it("shows the message for a release of a busy conversation", async () => {
      const busy = "The conversation is busy. Try again in a moment.";
      const { context, requests, shown, refreshes } = page(refuse(409, busy));

      expect(await releaseConversation(context)).toBe(false);

      expect(requests).toEqual([
        "/api/conversations/51900444001/release?channel=ca-1",
      ]);
      expect(shown).toEqual([{ kind: "error", message: busy }]);
      expect(refreshes()).toBe(0);
    });
  });

  it("shows an error when the request never reaches the server", async () => {
    const { context, shown } = page(() => {
      throw new TypeError("Failed to fetch");
    });

    expect(await takeOverConversation(context)).toBe(false);

    expect(shown).toEqual([{ kind: "error", message: "Failed to fetch" }]);
  });

  it("releases without a confirmation toast", async () => {
    const { context, shown, refreshes } = page(accept);

    expect(await releaseConversation(context)).toBe(true);

    expect(refreshes()).toBe(1);
    expect(shown).toEqual([]);
  });
});
