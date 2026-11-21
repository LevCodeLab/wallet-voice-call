import React, { useState, useEffect, useRef, useCallback } from "react";
import { AuthService, AuthenticatedUser } from "./services/auth.service";
import { CallingService, PublicCallingProfile, RecentCallItem, CallHistoryItem } from "./services/calling.service";
import { RealtimeService, IncomingCallEvent, CallStateEvent } from "./services/realtime.service";
import { WebRtcService } from "./services/webrtc.service";
import { HomeScreen } from "./components/HomeScreen";
import { DestinationPreviewModal } from "./components/DestinationPreviewModal";
import { WalletConnectModal } from "./components/WalletConnectModal";
import { OutgoingCallScreen } from "./components/OutgoingCallScreen";
import { IncomingCallModal } from "./components/IncomingCallModal";
import { ActiveCallScreen } from "./components/ActiveCallScreen";
import { CallEndedModal } from "./components/CallEndedModal";
import { ProfileScreen } from "./components/ProfileScreen";
import "./styles/design-tokens.css";

interface ActiveCall {
  callId: string;
  remoteAddress: string;
  role: "caller" | "recipient";
  status: string; // "initiated" | "ringing" | "connecting" | "connected"
}

export const App: React.FC = () => {
  // Authentication & User State
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isAcceptingCalls, setIsAcceptingCalls] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  // Navigation State
  const [activeView, setActiveView] = useState<"home" | "profile">("home");
  const [activeNavTab, setActiveNavTab] = useState<"call" | "recents" | "me">("call");

  // Destination & History State
  const [selectedProfile, setSelectedProfile] = useState<PublicCallingProfile | null>(null);
  const [recentCalls, setRecentCalls] = useState<RecentCallItem[]>(() => CallingService.getRecentCalls());
  const [historyCalls, setHistoryCalls] = useState<CallHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);

  // Call Lifecycle & Signaling State
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallEvent | null>(null);
  const [callEndedInfo, setCallEndedInfo] = useState<{ remoteAddress: string; reason?: string | null } | null>(null);
  const [isCallingAction, setIsCallingAction] = useState(false);
  const [isPeerReconnecting, setIsPeerReconnecting] = useState(false);

  // Audio & WebRTC State
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Service References
  const realtimeServiceRef = useRef<RealtimeService | null>(null);
  const webRtcServiceRef = useRef<WebRtcService | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const reconnectWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  activeCallRef.current = activeCall;

  // Fetch Authoritative Call History
  const loadHistory = useCallback(async (reset = false) => {
    if (!user) return;
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const offset = reset ? 0 : historyCalls.length;
      const res = await CallingService.fetchCallHistory(sessionToken || undefined, {
        limit: 20,
        offset,
      });
      setHistoryCalls((prev) => (reset ? res.calls : [...prev, ...res.calls]));
      setHasMoreHistory(res.hasMore);
    } catch (err: any) {
      setHistoryError(err.message || "Failed to load call history");
    } finally {
      setIsLoadingHistory(false);
    }
  }, [user, sessionToken, historyCalls.length]);

  // Teardown Call Helper
  const handleCallTermination = useCallback((reason?: string | null) => {
    if (reconnectWatchdogRef.current) {
      clearTimeout(reconnectWatchdogRef.current);
      reconnectWatchdogRef.current = null;
    }

    const current = activeCallRef.current;
    if (current) {
      CallingService.addRecentCall({
        id: current.callId,
        address: current.remoteAddress,
        direction: current.role === "caller" ? "outgoing" : "incoming",
        status: current.status,
        timestamp: new Date().toISOString(),
      });
      setRecentCalls(CallingService.getRecentCalls());
      setCallEndedInfo({ remoteAddress: current.remoteAddress, reason });
    }

    setIsPeerReconnecting(false);
    webRtcServiceRef.current?.cleanup();
    setActiveCall(null);
    setIncomingCall(null);
    setIsCallingAction(false);

    // Refresh history from backend
    loadHistory(true);
  }, [loadHistory]);

  // Initialize WebRTC Service
  useEffect(() => {
    const webRtc = new WebRtcService({
      onOffer: (sdp) => {
        if (activeCallRef.current?.callId) {
          realtimeServiceRef.current?.sendOffer(activeCallRef.current.callId, sdp);
        }
      },
      onAnswer: (sdp) => {
        if (activeCallRef.current?.callId) {
          realtimeServiceRef.current?.sendAnswer(activeCallRef.current.callId, sdp);
        }
      },
      onIceCandidate: (candidate) => {
        if (activeCallRef.current?.callId) {
          realtimeServiceRef.current?.sendIceCandidate(activeCallRef.current.callId, candidate);
        }
      },
      onConnected: () => {
        if (reconnectWatchdogRef.current) {
          clearTimeout(reconnectWatchdogRef.current);
          reconnectWatchdogRef.current = null;
        }
        setIsPeerReconnecting(false);

        // Authoritatively confirm connection to backend
        if (activeCallRef.current?.callId) {
          realtimeServiceRef.current?.sendCallConnected(activeCallRef.current.callId);
          CallingService.confirmCallConnected(sessionToken || undefined, activeCallRef.current.callId).catch(() => {});
        }
      },
      onConnectionStateChange: (state) => {
        if (state === "failed" || state === "closed") {
          handleCallTermination("peer_disconnected");
        }
      },
      onError: (err) => {
        console.error("WebRTC Audio Error:", err);
      },
    });

    if (remoteAudioRef.current) {
      webRtc.setAudioElement(remoteAudioRef.current);
    }
    webRtcServiceRef.current = webRtc;

    return () => {
      webRtc.cleanup();
    };
  }, [handleCallTermination, sessionToken]);

  // Dynamic ICE / STUN / TURN server configuration
  useEffect(() => {
    CallingService.fetchIceServers(sessionToken || undefined).then((res) => {
      if (res?.iceServers && webRtcServiceRef.current) {
        webRtcServiceRef.current.setIceServers(res.iceServers);
      }
    });
  }, [sessionToken]);

  // Initialize Realtime WebSocket Service
  useEffect(() => {
    const realtime = new RealtimeService({
      onIncomingCall: (event) => {
        setIncomingCall(event);
      },
      onCallState: (event) => {
        if (event.status === "connecting") {
          setActiveCall((prev) => (prev ? { ...prev, status: "connecting" } : null));
          // If caller, initiate WebRTC offer
          if (activeCallRef.current?.role === "caller") {
            webRtcServiceRef.current?.createOffer();
          }
        } else if (event.status === "connected") {
          setIsPeerReconnecting(false);
          setActiveCall((prev) => (prev ? { ...prev, status: "connected" } : null));
        } else if (
          ["ended", "rejected", "cancelled", "missed", "failed"].includes(event.status)
        ) {
          setIsPeerReconnecting(false);
          handleCallTermination(event.terminalReason || event.status);
        }
      },
      onCallReconnecting: () => {
        setIsPeerReconnecting(true);
      },
      onCallReconnected: () => {
        setIsPeerReconnecting(false);

        // Priority 3: Trigger real WebRTC media reconnection via ICE restart
        const current = activeCallRef.current;
        if (current && webRtcServiceRef.current) {
          const isCaller = current.role === "caller";
          webRtcServiceRef.current.restartIceNegotiation(isCaller);

          if (reconnectWatchdogRef.current) {
            clearTimeout(reconnectWatchdogRef.current);
          }
          // Watchdog timer: If media does not recover within 20s, terminate call gracefully
          reconnectWatchdogRef.current = setTimeout(() => {
            if (activeCallRef.current?.status === "connected") {
              console.warn("WebRTC media reconnection timed out after 20 seconds");
              handleCallTermination("reconnection_timed_out");
            }
          }, 20000);
        }
      },
      onWebRtcOffer: async (_callId, sdp) => {
        if (activeCallRef.current) {
          await webRtcServiceRef.current?.handleRemoteOffer(sdp);
        }
      },
      onWebRtcAnswer: async (_callId, sdp) => {
        if (activeCallRef.current) {
          await webRtcServiceRef.current?.handleRemoteAnswer(sdp);
        }
      },
      onWebRtcIceCandidate: async (_callId, candidate) => {
        if (activeCallRef.current) {
          await webRtcServiceRef.current?.handleRemoteCandidate(candidate);
        }
      },
    });

    realtimeServiceRef.current = realtime;

    return () => {
      realtime.disconnect();
    };
  }, [handleCallTermination]);

  // Connect to WebSocket when Session is Active
  useEffect(() => {
    if (user && realtimeServiceRef.current) {
      realtimeServiceRef.current.connect(sessionToken || undefined);
    } else {
      realtimeServiceRef.current?.disconnect();
    }
  }, [user, sessionToken]);

  // Check and Restore Active Session on Boot via Secure Cookie
  useEffect(() => {
    async function bootSession() {
      const verifiedUser = await AuthService.verifySession();
      if (verifiedUser) {
        setUser(verifiedUser);
        const activeToken = AuthService.getActiveToken();
        if (activeToken) setSessionToken(activeToken);

        // Fetch calling settings
        try {
          const settings = await CallingService.getCallingSettings(activeToken || undefined);
          setIsAcceptingCalls(settings.isAcceptingCalls);
        } catch {}
      } else {
        setUser(null);
        setSessionToken(null);
      }
    }
    bootSession();
  }, []);

  // Fetch call history on user load or recents view
  useEffect(() => {
    if (user && activeNavTab === "recents") {
      loadHistory(true);
    }
  }, [user, activeNavTab, loadHistory]);

  // Handle URL Deep Link (?call=0x...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetAddr = params.get("call");
    if (targetAddr) {
      CallingService.resolveProfile(targetAddr).then((profile) => {
        if (profile) setSelectedProfile(profile);
      });
    }
  }, []);

  // Initiate Outgoing Call
  const handleInitiateCall = async () => {
    if (!user || !sessionToken) {
      setIsWalletModalOpen(true);
      return;
    }

    if (!selectedProfile) return;

    setIsCallingAction(true);
    try {
      const res = await CallingService.initiateCall(sessionToken, selectedProfile.address);
      setActiveCall({
        callId: res.callId,
        remoteAddress: selectedProfile.address,
        role: "caller",
        status: res.status, // "ringing"
      });
      setSelectedProfile(null);
    } catch (err: any) {
      alert(err.message || "Failed to initiate call");
      setIsCallingAction(false);
    }
  };

  // Accept Incoming Call
  const handleAcceptIncomingCall = async () => {
    if (!incomingCall || !sessionToken) return;

    setIsCallingAction(true);
    try {
      // 1. Acquire mic
      await webRtcServiceRef.current?.acquireMicrophone();

      // 2. Notify backend of accept
      realtimeServiceRef.current?.sendCallAccept(incomingCall.callId);

      setActiveCall({
        callId: incomingCall.callId,
        remoteAddress: incomingCall.callerAddress,
        role: "recipient",
        status: "connecting",
      });

      setIncomingCall(null);
    } catch (err: any) {
      alert(err.message || "Failed to accept call");
    } finally {
      setIsCallingAction(false);
    }
  };

  // Decline Incoming Call
  const handleDeclineIncomingCall = () => {
    if (!incomingCall) return;
    realtimeServiceRef.current?.sendCallReject(incomingCall.callId, "declined");
    setIncomingCall(null);
  };

  // Cancel Outgoing Call
  const handleCancelOutgoingCall = () => {
    if (!activeCall) return;
    realtimeServiceRef.current?.sendCallCancel(activeCall.callId);
    handleCallTermination("cancelled_by_caller");
  };

  // End Active Call
  const handleEndCall = () => {
    if (!activeCall) return;
    realtimeServiceRef.current?.sendCallEnd(activeCall.callId);
    handleCallTermination("ended_by_user");
  };

  // Toggle Mute
  const handleToggleMute = () => {
    const muted = webRtcServiceRef.current?.toggleMute() ?? false;
    setIsMuted(muted);
    return muted;
  };

  // Toggle Speaker
  const handleToggleSpeaker = () => {
    const muted = webRtcServiceRef.current?.toggleSpeaker() ?? false;
    setIsSpeakerMuted(muted);
    return muted;
  };

  // Toggle Calling Availability
  const handleToggleAcceptingCalls = async (val: boolean) => {
    if (!sessionToken) return;
    const updated = await CallingService.updateCallingSettings(sessionToken, val);
    setIsAcceptingCalls(updated.isAcceptingCalls);
  };

  // Handle Logout
  const handleLogout = async () => {
    await AuthService.logout();
    setUser(null);
    setSessionToken(null);
    setActiveView("home");
  };

  return (
    <div className="deviceFrame">
      <div className="screenContainer">
        {/* Subtle Monochrome Obsidian Background */}
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "#0B0B0E",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

      {/* Hidden Audio Element for Remote WebRTC Audio Stream Playback */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />

      {/* Main View Router */}
      {activeView === "profile" && user ? (
        <ProfileScreen
          user={user}
          isAcceptingCalls={isAcceptingCalls}
          onToggleAcceptingCalls={handleToggleAcceptingCalls}
          onLogout={handleLogout}
          onBack={() => {
            setActiveView("home");
            setActiveNavTab("call");
          }}
        />
      ) : (
        <HomeScreen
          user={user}
          onConnectWallet={() => setIsWalletModalOpen(true)}
          onSelectAddress={async (address) => {
            const profile = await CallingService.resolveProfile(address);
            if (profile) {
              setSelectedProfile(profile);
            } else {
              alert(`Wallet address ${address} has not registered on wallet-voice-call yet.`);
            }
          }}
          onOpenProfile={() => setActiveView("profile")}
          historyCalls={historyCalls}
          recentCalls={recentCalls}
          isLoadingHistory={isLoadingHistory}
          historyError={historyError}
          onRefreshHistory={() => loadHistory(true)}
          hasMoreHistory={hasMoreHistory}
          onLoadMoreHistory={() => loadHistory(false)}
          activeNavTab={activeNavTab}
          onChangeNavTab={(tab) => {
            setActiveNavTab(tab);
            if (tab === "me") {
              if (!user) setIsWalletModalOpen(true);
              else setActiveView("profile");
            } else if (tab === "recents") {
              setActiveView("home");
              loadHistory(true);
            } else {
              setActiveView("home");
            }
          }}
        />
      )}

      {/* Screen B: Destination Call Preview Modal */}
      {selectedProfile && (
        <DestinationPreviewModal
          profile={selectedProfile}
          onBack={() => setSelectedProfile(null)}
          onInitiateCall={handleInitiateCall}
          isCalling={isCallingAction}
        />
      )}

      {/* Screen C: Wallet Connect Modal */}
      <WalletConnectModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        onSuccess={(newUser, newToken) => {
          setUser(newUser);
          setSessionToken(newToken);
          CallingService.getCallingSettings(newToken)
            .then((s) => setIsAcceptingCalls(s.isAcceptingCalls))
            .catch(() => {});
        }}
      />

      {/* Screen D: Outgoing Call Screen */}
      {activeCall && activeCall.role === "caller" && activeCall.status !== "connected" && (
        <OutgoingCallScreen
          recipientAddress={activeCall.remoteAddress}
          status={activeCall.status}
          onCancel={handleCancelOutgoingCall}
        />
      )}

      {/* Screen E: Incoming Call Modal */}
      {incomingCall && (
        <IncomingCallModal
          incomingCall={incomingCall}
          onAccept={handleAcceptIncomingCall}
          onDecline={handleDeclineIncomingCall}
          isAccepting={isCallingAction}
        />
      )}

      {/* Screen F: Active Voice Call Screen */}
      {activeCall && activeCall.status === "connected" && (
        <ActiveCallScreen
          remoteAddress={activeCall.remoteAddress}
          onEndCall={handleEndCall}
          onToggleMute={handleToggleMute}
          onToggleSpeaker={handleToggleSpeaker}
          isMuted={isMuted}
          isSpeakerMuted={isSpeakerMuted}
          isReconnecting={isPeerReconnecting}
        />
      )}

      {/* Screen G: Call Ended Outcome Modal */}
      {callEndedInfo && (
        <CallEndedModal
          remoteAddress={callEndedInfo.remoteAddress}
          reason={callEndedInfo.reason}
          onDone={() => setCallEndedInfo(null)}
          onCallAgain={() => {
            const addr = callEndedInfo.remoteAddress;
            setCallEndedInfo(null);
            CallingService.resolveProfile(addr).then((profile) => {
              if (profile) setSelectedProfile(profile);
            });
          }}
        />
      )}
      </div>
    </div>
  );
};
