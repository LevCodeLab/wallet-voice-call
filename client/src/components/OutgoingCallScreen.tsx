import React from "react";
import { PhoneOff } from "lucide-react";
import { CelestialOrb } from "./CelestialOrb";

interface OutgoingCallScreenProps {
  recipientAddress: string;
  status: string;
  onCancel: () => void;
}

export const OutgoingCallScreen: React.FC<OutgoingCallScreenProps> = ({
  recipientAddress,
  status,
  onCancel,
}) => {
  const formatShortAddress = (addr: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getStatusText = () => {
    if (status === "connecting") return "Negotiating WebRTC audio stream...";
    if (status === "ringing") return "Waiting for wallet owner to answer...";
    return "Dialing wallet...";
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
        zIndex: 70,
        background: "#0B0B0E",
      }}
    >
      <div className="glass-pill" style={{ fontSize: 11, padding: "5px 12px" }}>
        Outgoing Voice Call
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          textAlign: "center",
        }}
      >
        <CelestialOrb size={135} isPulsing={true} isRinging={true} />

        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.02em" }}>
            {formatShortAddress(recipientAddress)}
          </h2>
          <p style={{ fontSize: 14, color: "#E4E4E7", fontWeight: 600, marginTop: 6 }}>
            {status === "ringing" ? "Ringing..." : "Initiating..."}
          </p>
          <p style={{ fontSize: 12, color: "#A1A1AA", marginTop: 4 }}>
            {getStatusText()}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <button
          onClick={onCancel}
          className="glass-pill"
          style={{
            padding: "14px 32px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <PhoneOff size={18} />
          <span>Cancel call</span>
        </button>
        <span style={{ fontSize: 11, color: "#71717A" }}>
          30-second ringing timeout
        </span>
      </div>
    </div>
  );
};
