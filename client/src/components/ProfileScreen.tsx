import React, { useState } from "react";
import { ArrowLeft, Copy, Check, Share2, LogOut } from "lucide-react";
import { CelestialOrb } from "./CelestialOrb";
import { AuthenticatedUser } from "../services/auth.service";

interface ProfileScreenProps {
  user: AuthenticatedUser;
  isAcceptingCalls: boolean;
  onToggleAcceptingCalls: (val: boolean) => Promise<void>;
  onLogout: () => void;
  onBack: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  user,
  isAcceptingCalls,
  onToggleAcceptingCalls,
  onLogout,
  onBack,
}) => {
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const formatShortAddress = (addr: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const callLink = `${window.location.origin}/?call=${user.walletAddress}`;

  const handleCopyAddr = () => {
    navigator.clipboard.writeText(user.walletAddress);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(callLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Call my wallet on wallet-voice-call",
          text: `Voice call my wallet ${user.walletAddress}:`,
          url: callLink,
        });
      } catch {}
    } else {
      handleCopyLink();
    }
  };

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.checked;
    setIsUpdating(true);
    try {
      await onToggleAcceptingCalls(nextVal);
    } finally {
      setIsUpdating(false);
    }
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

        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#FFFFFF" }}>Your call page</h3>

        <div style={{ width: 36 }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        <CelestialOrb size={105} isConnected={isAcceptingCalls} />

        <div
          onClick={handleCopyAddr}
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
          <span>{formatShortAddress(user.walletAddress)}</span>
          {copiedAddr ? <Check size={14} color="#FFFFFF" /> : <Copy size={14} color="#A1A1AA" />}
        </div>

        <div
          style={{
            width: "100%",
            borderRadius: 20,
            background: "#141418",
            border: "1px solid #26262E",
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    backgroundColor: isAcceptingCalls ? "#FFFFFF" : "#71717A",
                  }}
                />
                <span style={{ fontSize: 14, fontWeight: 600, color: "#FFFFFF" }}>Accepting calls</span>
              </div>
              <p style={{ fontSize: 11, color: "#A1A1AA", marginTop: 2 }}>
                Allow wallets to dial your link
              </p>
            </div>

            <label style={{ position: "relative", display: "inline-block", width: 44, height: 24, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={isAcceptingCalls}
                disabled={isUpdating}
                onChange={handleToggle}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: "absolute",
                  cursor: "pointer",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: isAcceptingCalls ? "#FFFFFF" : "#0B0B0E",
                  border: "1px solid #26262E",
                  transition: "0.2s",
                  borderRadius: 24,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    height: 16,
                    width: 16,
                    left: isAcceptingCalls ? 23 : 3,
                    bottom: 3,
                    backgroundColor: isAcceptingCalls ? "#000000" : "#A1A1AA",
                    transition: "0.2s",
                    borderRadius: "50%",
                  }}
                />
              </span>
            </label>
          </div>

          <div style={{ height: 1, backgroundColor: "#26262E" }} />

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#E4E4E7", marginBottom: 8 }}>
              Your call link
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 12,
                background: "#0B0B0E",
                border: "1px solid #26262E",
              }}
            >
              <input
                readOnly
                value={callLink}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  color: "#A1A1AA",
                  fontSize: 12,
                  outline: "none",
                }}
              />
              <button
                onClick={handleCopyLink}
                style={{
                  background: "none",
                  border: "none",
                  color: "#FFFFFF",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {copiedLink ? <Check size={16} color="#FFFFFF" /> : <Copy size={16} />}
              </button>
            </div>

            <button
              onClick={handleShare}
              className="glass-pill"
              style={{ width: "100%", marginTop: 10, padding: "10px", fontSize: 12 }}
            >
              <Share2 size={14} />
              <span>Share link</span>
            </button>
          </div>
        </div>
      </div>

      <button
        onClick={onLogout}
        className="glass-pill"
        style={{ padding: "12px" }}
      >
        <LogOut size={16} />
        <span>Disconnect Wallet</span>
      </button>
    </div>
  );
};
