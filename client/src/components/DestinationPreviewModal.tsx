import React, { useState } from "react";
import { ArrowLeft, Phone, Copy, Check, AlertCircle } from "lucide-react";
import { CelestialOrb } from "./CelestialOrb";
import { PublicCallingProfile } from "../services/calling.service";

interface DestinationPreviewModalProps {
  profile: PublicCallingProfile;
  onBack: () => void;
  onInitiateCall: () => void;
  isCalling: boolean;
}

export const DestinationPreviewModal: React.FC<DestinationPreviewModalProps> = ({
  profile,
  onBack,
  onInitiateCall,
  isCalling,
}) => {
  const [copied, setCopied] = useState(false);

  const formatShortAddress = (addr: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(profile.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusText = () => {
    if (profile.isBusy) return "Busy in another call";
    if (!profile.isOnline) return "Offline";
    if (!profile.isAcceptingCalls) return "Not accepting calls";
    return "Available for calls";
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
        padding: "calc(max(env(safe-area-inset-top, 14px), 14px) + 12px) 24px calc(max(env(safe-area-inset-bottom, 20px), 20px) + 24px) 24px",
        zIndex: 60,
        background: "#0B0B0E",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={onBack}
          style={{
            background: "#141418",
            border: "1px solid #26262E",
            borderRadius: "50%",
            width: 36,
            height: 36,
            color: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <ArrowLeft size={18} />
        </button>

        <div className="glass-pill" style={{ fontSize: 11, padding: "5px 12px" }}>
          Wallet Call
        </div>

        <div style={{ width: 36 }} />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          textAlign: "center",
          marginTop: -20,
        }}
      >
        <CelestialOrb size={120} isConnected={profile.isCallable} />

        <div
          onClick={handleCopy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 14,
            background: "#141418",
            border: "1px solid #26262E",
            color: "#FFFFFF",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <span>{formatShortAddress(profile.address)}</span>
          {copied ? <Check size={14} color="#FFFFFF" /> : <Copy size={14} color="#A1A1AA" />}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: profile.isCallable ? "#FFFFFF" : "#71717A",
            }}
          />
          <span style={{ fontSize: 13, color: profile.isCallable ? "#FFFFFF" : "#A1A1AA", fontWeight: 500 }}>
            {getStatusText()}
          </span>
        </div>

        <div style={{ marginTop: 8 }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: "#FFFFFF" }}>
            Talk to this wallet.
          </h2>
          <p style={{ fontSize: 13, color: "#A1A1AA", marginTop: 6, maxWidth: 280 }}>
            Peer-to-peer WebRTC voice call using EVM wallet identity.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {!profile.isCallable && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "10px",
              borderRadius: 12,
              background: "#141418",
              border: "1px solid #26262E",
              color: "#E4E4E7",
              fontSize: 12,
            }}
          >
            <AlertCircle size={15} />
            <span>
              {profile.isBusy
                ? "Wallet is currently busy on another call."
                : !profile.isOnline
                ? "Wallet is offline right now."
                : "Wallet is not accepting incoming calls."}
            </span>
          </div>
        )}

        <button
          className="primary-action-pill"
          disabled={!profile.isCallable || isCalling}
          onClick={onInitiateCall}
        >
          <Phone size={18} />
          <span>{isCalling ? "Initiating Call..." : "Call wallet"}</span>
        </button>
      </div>
    </div>
  );
};
