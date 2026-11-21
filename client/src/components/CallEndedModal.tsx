import React from "react";
import { Phone, CheckCircle, XCircle, PhoneMissed, PhoneOff } from "lucide-react";

interface CallEndedModalProps {
  remoteAddress: string;
  reason?: string | null;
  onDone: () => void;
  onCallAgain: () => void;
}

export const CallEndedModal: React.FC<CallEndedModalProps> = ({
  remoteAddress,
  reason,
  onDone,
  onCallAgain,
}) => {
  const formatShortAddress = (addr: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getReasonDetails = () => {
    switch (reason) {
      case "rejected_by_recipient":
        return { title: "Call Declined", desc: "The recipient declined the call.", icon: <XCircle size={26} color="#FFFFFF" /> };
      case "cancelled_by_caller":
        return { title: "Call Cancelled", desc: "The call was cancelled.", icon: <PhoneOff size={26} color="#E4E4E7" /> };
      case "ringing_timed_out":
      case "ringing_timeout":
        return { title: "Call Missed", desc: "The recipient did not answer in time.", icon: <PhoneMissed size={26} color="#E4E4E7" /> };
      case "recipient_disconnected":
      case "caller_disconnected":
      case "peer_disconnected":
        return { title: "Call Disconnected", desc: "Network connection was closed.", icon: <PhoneOff size={26} color="#E4E4E7" /> };
      default:
        return { title: "Call Ended", desc: "The voice call has completed.", icon: <CheckCircle size={26} color="#FFFFFF" /> };
    }
  };

  const details = getReasonDetails();

  return (
    <div className="screen-dimmer" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#141418",
          borderRadius: 24,
          border: "1px solid #26262E",
          padding: "28px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 16,
          zIndex: 102,
        }}
      >
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: "50%",
            background: "#0B0B0E",
            border: "1px solid #26262E",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {details.icon}
        </div>

        <div>
          <h3 style={{ fontSize: 20, fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.02em" }}>
            {details.title}
          </h3>
          <p style={{ fontSize: 13, color: "#A1A1AA", marginTop: 4 }}>
            {details.desc}
          </p>
          <div style={{ fontSize: 12, color: "#E4E4E7", marginTop: 6, fontWeight: 600 }}>
            {formatShortAddress(remoteAddress)}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, width: "100%", marginTop: 8 }}>
          <button
            onClick={onDone}
            className="glass-pill"
            style={{ flex: 1, padding: "12px", fontSize: 13 }}
          >
            Done
          </button>
          <button
            onClick={onCallAgain}
            className="primary-action-pill"
            style={{ flex: 1.3, padding: "12px", fontSize: 13 }}
          >
            <Phone size={15} />
            <span>Call again</span>
          </button>
        </div>
      </div>
    </div>
  );
};
