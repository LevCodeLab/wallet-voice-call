/**
 * wallet-voice-call Realtime WebSocket Service
 * Handles authenticated WebSocket connection, heartbeats, call actions and signaling relay.
 */

export interface IncomingCallEvent {
  callId: string;
  callerId: string;
  callerAddress: string;
  callerDisplayName?: string | null;
  callerAvatarUrl?: string | null;
  ringingExpiresAt: string;
}

export interface CallStateEvent {
  callId: string;
  status: string;
  terminalReason?: string | null;
}

export interface RealtimeHandlers {
  onIncomingCall?: (event: IncomingCallEvent) => void;
  onCallState?: (event: CallStateEvent) => void;
  onCallReconnecting?: (event: { disconnectedUserId?: string; gracePeriodSeconds?: number }) => void;
  onCallReconnected?: (event: { reconnectedUserId?: string }) => void;
  onWebRtcOffer?: (callId: string, sdp: string) => void;
  onWebRtcAnswer?: (callId: string, sdp: string) => void;
  onWebRtcIceCandidate?: (callId: string, candidate: any) => void;
  onError?: (error: { code: string; message: string }) => void;
  onConnectedChange?: (isConnected: boolean) => void;
}

export class RealtimeService {
  private ws: WebSocket | null = null;
  private pingInterval: any = null;
  private reconnectTimeout: any = null;
  private handlers: RealtimeHandlers = {};
  private sessionToken: string | null = null;
  private isExplicitlyClosed: boolean = false;

  constructor(handlers: RealtimeHandlers) {
    this.handlers = handlers;
  }

  public updateHandlers(handlers: Partial<RealtimeHandlers>) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * Connect to WebSocket using single-use ticket or session cookie.
   */
  public async connect(sessionToken?: string): Promise<void> {
    if (sessionToken) {
      this.sessionToken = sessionToken;
    }
    this.isExplicitlyClosed = false;

    try {
      // 1. Request short-lived single-use ticket from backend
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.sessionToken) {
        headers["Authorization"] = `Bearer ${this.sessionToken}`;
      }

      const res = await fetch("/api/v1/auth/ws-ticket", {
        method: "POST",
        headers,
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Failed to obtain WebSocket ticket from server");
      }

      const { ticket } = await res.json();

      // 2. Form WebSocket URL
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws?ticket=${ticket}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.handlers.onConnectedChange?.(true);
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (err) {
          console.error("Malformed message from server:", err);
        }
      };

      this.ws.onclose = () => {
        this.handlers.onConnectedChange?.(false);
        this.stopHeartbeat();
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.warn("WebSocket transport error:", err);
      };
    } catch (err: any) {
      console.error("WebSocket connection failure:", err);
      if (!this.isExplicitlyClosed) {
        this.scheduleReconnect();
      }
    }
  }

  private handleMessage(msg: { type: string; payload?: any }) {
    switch (msg.type) {
      case "pong":
        break;
      case "call.incoming": {
        const inc = msg.payload || {};
        this.handlers.onIncomingCall?.({
          callId: inc.callId || (msg as any).callId,
          callerId: inc.callerId || "",
          callerAddress: inc.callerAddress || inc.caller?.walletAddress || "",
          callerDisplayName: inc.callerDisplayName || inc.caller?.displayName,
          callerAvatarUrl: inc.callerAvatarUrl || inc.caller?.avatarUrl,
          ringingExpiresAt: inc.ringingExpiresAt || "",
        });
        break;
      }
      case "call.state": {
        const st = msg.payload || {};
        this.handlers.onCallState?.({
          callId: st.callId || (msg as any).callId,
          status: st.status || st.state || "",
          terminalReason: st.terminalReason || null,
        });
        break;
      }
      case "call.reconnecting": {
        this.handlers.onCallReconnecting?.(msg.payload || {});
        break;
      }
      case "call.reconnected": {
        this.handlers.onCallReconnected?.(msg.payload || {});
        break;
      }
      case "webrtc.offer":
        if (msg.payload?.callId && msg.payload?.sdp) {
          this.handlers.onWebRtcOffer?.(msg.payload.callId, msg.payload.sdp);
        }
        break;
      case "webrtc.answer":
        if (msg.payload?.callId && msg.payload?.sdp) {
          this.handlers.onWebRtcAnswer?.(msg.payload.callId, msg.payload.sdp);
        }
        break;
      case "webrtc.ice-candidate":
        if (msg.payload?.callId && msg.payload?.candidate) {
          this.handlers.onWebRtcIceCandidate?.(msg.payload.callId, msg.payload.candidate);
        }
        break;
      case "error":
        this.handlers.onError?.(msg.payload || { code: "SERVER_ERROR", message: "Unknown error" });
        break;
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout || this.isExplicitlyClosed) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect(this.sessionToken || undefined);
    }, 3000);
  }

  public send(type: string, payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  public sendCallAccept(callId: string) {
    this.send("call.accept", { callId });
  }

  public sendCallConnected(callId: string) {
    this.send("call.connected", { callId });
  }

  public sendCallReject(callId: string, reason?: string) {
    this.send("call.reject", { callId, reason });
  }

  public sendCallCancel(callId: string) {
    this.send("call.cancel", { callId });
  }

  public sendCallEnd(callId: string) {
    this.send("call.end", { callId });
  }

  public sendOffer(callId: string, sdp: string) {
    this.send("webrtc.offer", { callId, sdp });
  }

  public sendAnswer(callId: string, sdp: string) {
    this.send("webrtc.answer", { callId, sdp });
  }

  public sendIceCandidate(callId: string, candidate: any) {
    this.send("webrtc.ice-candidate", { callId, candidate });
  }

  public disconnect() {
    this.isExplicitlyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.handlers.onConnectedChange?.(false);
  }
}
