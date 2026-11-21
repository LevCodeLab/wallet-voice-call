import React, { useState, useEffect } from "react";
import { Mic, MicOff, Volume2, VolumeX, PhoneOff } from "lucide-react";
import { CelestialOrb } from "./CelestialOrb";

interface ActiveCallScreenProps {
  remoteAddress: string;
  onEndCall: () => void;
  onToggleMute: () => boolean;
  onToggleSpeaker: () => boolean;
  isMuted: boolean;
  isSpeakerMuted: boolean;
  isReconnecting?: boolean;
}

export const ActiveCallScreen: React.FC<ActiveCallScreenProps> = ({
  remoteAddress,
  onEndCall,
  onToggleMute,
  onToggleSpeaker,
  isMuted,
  isSpeakerMuted,
  isReconnecting = false,
}) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

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
        zIndex: 90,
        background: "#0B0B0E",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <div
          className="glass-pill"
          style={{ fontSize: 11, padding: "5px 12px" }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: isReconnecting ? "#A1A1AA" : "#FFFFFF",
            }}
          />
          <span>{isReconnecting ? "PEER RECONNECTING..." : "VOICE CONNECTED"}</span>
        </div>
        {isReconnecting && (
          <div style={{ fontSize: 11, color: "#A1A1AA", marginTop: 4 }}>
            Network drop detected. Holding call session open...
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          textAlign: "center",
        }}
      >
        <CelestialOrb size={136} isConnected={true} />

        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.02em" }}>
            {formatShortAddress(remoteAddress)}
          </h2>
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: "#FFFFFF",
              letterSpacing: "-0.03em",
              marginTop: 10,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatDuration(seconds)}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <button
            onClick={onToggleMute}
            className="glass-pill"
            style={{
              width: 54,
              height: 54,
              borderRadius: "50%",
              padding: 0,
              background: isMuted ? "#FFFFFF" : "#141418",
              borderColor: isMuted ? "#FFFFFF" : "#26262E",
              color: isMuted ? "#000000" : "#FFFFFF",
            }}
            title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
          >
            {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>

          <button
            onClick={onToggleSpeaker}
            className="glass-pill"
            style={{
              width: 54,
              height: 54,
              borderRadius: "50%",
              padding: 0,
              background: isSpeakerMuted ? "#FFFFFF" : "#141418",
              borderColor: isSpeakerMuted ? "#FFFFFF" : "#26262E",
              color: isSpeakerMuted ? "#000000" : "#FFFFFF",
            }}
            title={isSpeakerMuted ? "Unmute Audio Output" : "Mute Audio Output"}
          >
            {isSpeakerMuted ? <VolumeX size={22} /> : <Volume2 size={22} />}
          </button>
        </div>

        <button
          onClick={onEndCall}
          className="call-btn-primary"
          style={{ width: 72, height: 72 }}
          title="End Call"
        >
          <PhoneOff size={28} />
        </button>
      </div>
    </div>
  );
};
