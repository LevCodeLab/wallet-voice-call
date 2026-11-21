/**
 * wallet-voice-call Calling & Profile Service
 * Manages identity resolution, availability settings, WebRTC ICE servers, and persistent call history.
 */

export interface PublicCallingProfile {
  address: string;
  network: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOnline: boolean;
  isAcceptingCalls: boolean;
  isBusy: boolean;
  isCallable: boolean;
}

export interface CallingSettings {
  isAcceptingCalls: boolean;
  updatedAt: string;
}

export interface CallHistoryItem {
  id: string;
  callerWallet: string;
  recipientWallet: string;
  direction: "incoming" | "outgoing";
  counterpartyWallet: string;
  counterpartyDisplayName?: string | null;
  counterpartyAvatarUrl?: string | null;
  state: string;
  terminalReason: string | null;
  durationSeconds: number;
  createdAt: string;
  ringingAt: string | null;
  acceptedAt: string | null;
  connectingAt: string | null;
  connectedAt: string | null;
  endedAt: string | null;
}

export interface CallHistoryResponse {
  calls: CallHistoryItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface RecentCallItem {
  id: string;
  address: string;
  displayName?: string | null;
  direction: "incoming" | "outgoing" | "missed";
  status: string;
  timestamp: string;
  durationSeconds?: number;
}

export class CallingService {
  private static RECENTS_KEY = "wallet_voice_call_recents";

  private static getHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Resolve public calling profile of a wallet address.
   */
  public static async resolveProfile(address: string): Promise<PublicCallingProfile | null> {
    const cleanAddress = address.trim().toLowerCase();
    try {
      const res = await fetch(`/api/v1/users/${cleanAddress}/profile`, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error("Failed to resolve wallet profile");
      }
      return await res.json();
    } catch (err) {
      console.error("Profile resolution error:", err);
      return null;
    }
  }

  /**
   * Fetch current authenticated user's calling settings.
   */
  public static async getCallingSettings(token?: string): Promise<CallingSettings> {
    const res = await fetch("/api/v1/users/me/calling-settings", {
      headers: this.getHeaders(token),
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to fetch calling settings");
    return await res.json();
  }

  /**
   * Update incoming-call availability toggle.
   */
  public static async updateCallingSettings(token: string | undefined, isAcceptingCalls: boolean): Promise<CallingSettings> {
    const headers = this.getHeaders(token);
    headers["Content-Type"] = "application/json";

    const res = await fetch("/api/v1/users/me/calling-settings", {
      method: "PATCH",
      headers,
      credentials: "include",
      body: JSON.stringify({ isAcceptingCalls }),
    });
    if (!res.ok) throw new Error("Failed to update calling settings");
    return await res.json();
  }

  /**
   * Dynamic ICE / STUN / TURN server configuration for WebRTC
   */
  public static async fetchIceServers(token?: string): Promise<{ iceServers: RTCIceServer[] }> {
    try {
      const res = await fetch("/api/v1/webrtc/ice-servers", {
        headers: this.getHeaders(token),
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch dynamic ICE servers");
      }
      return await res.json();
    } catch (err) {
      console.warn("Using default fallback STUN servers:", err);
      return {
        iceServers: [
          { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
        ],
      };
    }
  }

  /**
   * Fetch persistent paginated call history from backend PostgreSQL
   */
  public static async fetchCallHistory(
    token?: string,
    query?: { limit?: number; offset?: number; direction?: string }
  ): Promise<CallHistoryResponse> {
    const params = new URLSearchParams();
    if (query?.limit) params.set("limit", String(query.limit));
    if (query?.offset) params.set("offset", String(query.offset));
    if (query?.direction) params.set("direction", query.direction);

    const queryString = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`/api/v1/calls/history${queryString}`, {
      headers: this.getHeaders(token),
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Failed to fetch call history");
    }

    return await res.json();
  }

  /**
   * Authoritative client-to-server confirmation of successful WebRTC connection
   */
  public static async confirmCallConnected(token: string | undefined, callId: string): Promise<any> {
    const res = await fetch(`/api/v1/calls/${callId}/connected`, {
      method: "POST",
      headers: this.getHeaders(token),
      credentials: "include",
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to confirm call connected");
    }
    return await res.json();
  }

  /**
   * Initiate an outgoing voice call.
   */
  public static async initiateCall(token: string | undefined, recipientAddress: string): Promise<any> {
    const headers = this.getHeaders(token);
    headers["Content-Type"] = "application/json";

    const res = await fetch("/api/v1/calls", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ recipientAddress }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to initiate call");
    }
    return await res.json();
  }

  /**
   * HTTP Fallback Call Actions
   */
  public static async acceptCall(token: string | undefined, callId: string): Promise<void> {
    await fetch(`/api/v1/calls/${callId}/accept`, {
      method: "POST",
      headers: this.getHeaders(token),
      credentials: "include",
    });
  }

  public static async rejectCall(token: string | undefined, callId: string, reason?: string): Promise<void> {
    const headers = this.getHeaders(token);
    headers["Content-Type"] = "application/json";

    await fetch(`/api/v1/calls/${callId}/reject`, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ reason }),
    });
  }

  public static async cancelCall(token: string | undefined, callId: string): Promise<void> {
    await fetch(`/api/v1/calls/${callId}/cancel`, {
      method: "POST",
      headers: this.getHeaders(token),
      credentials: "include",
    });
  }

  public static async endCall(token: string | undefined, callId: string): Promise<void> {
    await fetch(`/api/v1/calls/${callId}/end`, {
      method: "POST",
      headers: this.getHeaders(token),
      credentials: "include",
    });
  }

  /**
   * Local Call History Cache Fallback
   */
  public static getRecentCalls(): RecentCallItem[] {
    try {
      const data = localStorage.getItem(this.RECENTS_KEY);
      if (!data) return [];
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  public static addRecentCall(item: RecentCallItem): void {
    try {
      const existing = this.getRecentCalls();
      const updated = [item, ...existing.filter((c) => c.id !== item.id)].slice(0, 20);
      localStorage.setItem(this.RECENTS_KEY, JSON.stringify(updated));
    } catch {}
  }
}
