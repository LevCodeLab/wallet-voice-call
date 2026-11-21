import React from "react";
import { Phone, PhoneOff } from "lucide-react";
import { CelestialOrb } from "./CelestialOrb";
import { IncomingCallEvent } from "../services/realtime.service";

interface IncomingCallModalProps {
  incomingCall: IncomingCallEvent;
  onAccept: () => void;
  onDecline: () => void;
  isAccepting: boolean;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  incomingCall,
  onAccept,
  onDecline,
  isAccepting,
}) => {
  const formatShortAddress = (addr: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        maxWidth: 480,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "calc(max(env(safe-area-inset-top, 14px), 14px) + 24px) 24px calc(max(env(safe-area-inset-bottom, 20px), 20px) + 36px) 24px",
        zIndex: 80,
        background: "#0B0B0E",
        animation: "fadeIn 0.2s ease forwards",
      }}
    >
      <div className="glass-pill" style={{ fontSize: 11, padding: "5px 12px" }}>
        Incoming Wallet Call
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          textAlign: "center",
        }}
      >
        <CelestialOrb size={135} isPulsing={true} isRinging={true} />

        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.02em" }}>
            {formatShortAddress(incomingCall.callerAddress)}
          </h2>
          <p style={{ fontSize: 14, color: "#E4E4E7", marginTop: 6 }}>
            Incoming WebRTC voice call
          </p>
          <p style={{ fontSize: 11, color: "#71717A", marginTop: 4 }}>
            Peer-to-peer Opus audio
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 48,
          width: "100%",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <button
            onClick={onDecline}
            disabled={isAccepting}
            className="call-btn-secondary"
            title="Decline Call"
          >
            <PhoneOff size={26} />
          </button>
          <span style={{ fontSize: 12, color: "#A1A1AA", fontWeight: 500 }}>
            Decline
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <button
            onClick={onAccept}
            disabled={isAccepting}
            className="call-btn-primary"
            title="Accept Call"
          >
            <Phone size={26} />
          </button>
          <span style={{ fontSize: 12, color: "#FFFFFF", fontWeight: 600 }}>
            {isAccepting ? "Connecting..." : "Accept"}
          </span>
        </div>
      </div>
    </div>
  );
};
