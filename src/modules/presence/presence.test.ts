import { describe, it, expect, vi } from "vitest";
import { PresenceService } from "./presence.service.js";
import { SignalingBroadcaster } from "../realtime/signaling.broadcaster.js";

describe("PresenceService & SignalingBroadcaster Unit Tests", () => {
  it("tracks multi-tab connections and broadcasts signaling payloads to all live sockets", () => {
    const presence = new PresenceService(30);
    const broadcaster = new SignalingBroadcaster(presence);

    const wsTab1 = { readyState: 1, send: vi.fn(), terminate: vi.fn() } as any;
    const wsTab2 = { readyState: 1, send: vi.fn(), terminate: vi.fn() } as any;

    presence.registerConnection("alice-id", "conn-1", wsTab1);
    presence.registerConnection("alice-id", "conn-2", wsTab2);
    expect(presence.isUserOnline("alice-id")).toBe(true);

    const delivered = broadcaster.sendToUser("alice-id", {
      type: "call.incoming",
      callId: "call-42",
      payload: { callerWallet: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" },
    });

    expect(delivered).toBe(true);
    expect(wsTab1.send).toHaveBeenCalledTimes(1);
    expect(wsTab2.send).toHaveBeenCalledTimes(1);

    // Close tab 1: user stays online via tab 2
    presence.removeConnection("alice-id", "conn-1");
    expect(presence.isUserOnline("alice-id")).toBe(true);

    // Close tab 2: user goes offline
    presence.removeConnection("alice-id", "conn-2");
    expect(presence.isUserOnline("alice-id")).toBe(false);
  });
});
