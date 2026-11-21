import React, { useState } from "react";
import {
  Sparkles,
  Search,
  Phone,
  ArrowUpRight,
  ArrowDownLeft,
  PhoneMissed,
  PhoneOff,
  Wallet,
  User as UserIcon,
  Copy,
  Check,
  RotateCcw,
} from "lucide-react";
import { CallHistoryItem, RecentCallItem } from "../services/calling.service";
import { AuthenticatedUser } from "../services/auth.service";

interface HomeScreenProps {
  user: AuthenticatedUser | null;
  onConnectWallet: () => void;
  onSelectAddress: (address: string) => void;
  onOpenProfile: () => void;
  historyCalls?: CallHistoryItem[];
  recentCalls?: RecentCallItem[];
  isLoadingHistory?: boolean;
  historyError?: string | null;
  onRefreshHistory?: () => void;
  hasMoreHistory?: boolean;
  onLoadMoreHistory?: () => void;
  activeNavTab: "call" | "recents" | "me";
  onChangeNavTab: (tab: "call" | "recents" | "me") => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  user,
  onConnectWallet,
  onSelectAddress,
  onOpenProfile,
  historyCalls,
  recentCalls = [],
  isLoadingHistory = false,
  historyError = null,
  onRefreshHistory,
  hasMoreHistory = false,
  onLoadMoreHistory,
  activeNavTab,
  onChangeNavTab,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const handleCopyAddress = (e: React.MouseEvent, addr: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(addr);
    setCopiedAddress(addr);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const formatShortAddress = (addr: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    if (!query.startsWith("0x") || query.length !== 42) {
      setSearchError("Enter a valid 42-character EVM address (0x...)");
      return;
    }

    setSearchError(null);
    onSelectAddress(query);
  };

  const renderCallIcon = (direction: string) => {
    switch (direction) {
      case "incoming":
        return <ArrowDownLeft size={13} color="#FFFFFF" />;
      case "missed":
        return <PhoneMissed size={13} color="#A1A1AA" />;
      default:
        return <ArrowUpRight size={13} color="#E4E4E7" />;
    }
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="topHeroWindow">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: "#141418",
                border: "1px solid #26262E",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#FFFFFF",
              }}
            >
              <Sparkles size={16} />
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.01em" }}>
                wallet-voice-call
              </div>
              <div style={{ fontSize: 11, color: "#A1A1AA" }}>
                peer-to-peer EVM voice dialer
              </div>
            </div>
          </div>

          {user ? (
            <button
              onClick={onOpenProfile}
              className="glass-pill"
              style={{ gap: 6, padding: "6px 12px", fontSize: 12 }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: "#FFFFFF",
                }}
              />
              <span>{formatShortAddress(user.walletAddress)}</span>
            </button>
          ) : (
            <button
              onClick={onConnectWallet}
              className="glass-pill"
              style={{
                gap: 6,
                padding: "6px 14px",
                fontSize: 12,
                background: "#FFFFFF",
                color: "#000000",
                borderColor: "#FFFFFF",
              }}
            >
              <Wallet size={14} color="#000000" />
              <span>Connect</span>
            </button>
          )}
        </div>

        <form onSubmit={handleSearchSubmit} style={{ marginTop: "auto" }}>
          <div
            style={{
              height: 44,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 14px",
              background: "#141418",
              border: "1px solid #26262E",
              borderRadius: 22,
            }}
          >
            <Search size={16} color="#71717A" style={{ flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Dial EVM wallet address (0x...)"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchError(null);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#FFFFFF",
                fontSize: 13,
                fontWeight: 500,
              }}
            />
            {searchQuery && (
              <button
                type="submit"
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #FFFFFF",
                  borderRadius: 12,
                  padding: "4px 12px",
                  color: "#000000",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Dial
              </button>
            )}
          </div>
          {searchError && (
            <div style={{ fontSize: 11, color: "#E4E4E7", marginTop: 6, paddingLeft: 12 }}>
              {searchError}
            </div>
          )}
        </form>
      </div>

      <div className="bottomCurvedWindow">
        <div
          style={{
            padding: "16px 20px 10px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #26262E",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#FFFFFF" }}>
              Call History
            </span>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 10,
                backgroundColor: "#141418",
                border: "1px solid #26262E",
                color: "#E4E4E7",
              }}
            >
              {historyCalls ? historyCalls.length : recentCalls.length}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {onRefreshHistory && (
              <button
                onClick={onRefreshHistory}
                disabled={isLoadingHistory}
                style={{
                  background: "none",
                  border: "none",
                  color: "#A1A1AA",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  padding: 4,
                }}
                title="Refresh call history"
              >
                <RotateCcw size={13} />
              </button>
            )}
            <div style={{ fontSize: 11, color: "#71717A" }}>
              SIWE + WebRTC Opus
            </div>
          </div>
        </div>

        <div className="mainScrollableArea">
          {isLoadingHistory && (!historyCalls || historyCalls.length === 0) ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                color: "#A1A1AA",
                padding: "40px 20px",
              }}
            >
              <RotateCcw size={22} />
              <span style={{ fontSize: 13 }}>Loading call history...</span>
            </div>
          ) : historyError ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: "40px 20px",
                color: "#E4E4E7",
                gap: 12,
              }}
            >
              <PhoneOff size={26} />
              <div style={{ fontSize: 13, color: "#A1A1AA" }}>{historyError}</div>
              {onRefreshHistory && (
                <button
                  onClick={onRefreshHistory}
                  className="glass-pill"
                  style={{ fontSize: 12, padding: "6px 14px" }}
                >
                  Retry
                </button>
              )}
            </div>
          ) : historyCalls && historyCalls.length > 0 ? (
            <>
              {historyCalls.map((call) => {
                const targetAddress = call.counterpartyWallet;
                const isCopied = copiedAddress === targetAddress;
                const isGenuinelyConnected = Boolean(call.connectedAt) && call.durationSeconds > 0;

                let displayStatus = call.state;
                if (call.state === "ended") {
                  if (isGenuinelyConnected) displayStatus = "Completed";
                  else if (call.terminalReason?.includes("cancel")) displayStatus = "Cancelled";
                  else if (call.terminalReason?.includes("decline") || call.terminalReason?.includes("reject")) displayStatus = "Declined";
                  else displayStatus = "Unconnected";
                } else if (call.state === "missed") {
                  displayStatus = "Missed";
                } else if (call.state === "rejected") {
                  displayStatus = "Declined";
                } else if (call.state === "failed") {
                  displayStatus = "Failed";
                }

                const durationDisplay = isGenuinelyConnected
                  ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s`
                  : displayStatus;

                return (
                  <div
                    key={call.id}
                    onClick={() => onSelectAddress(targetAddress)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      borderRadius: 14,
                      background: "#0B0B0E",
                      border: "1px solid #26262E",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <img
                        src="/liquid-orb.jpg"
                        alt="avatar"
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          objectFit: "cover",
                          filter: "grayscale(100%)",
                          border: "1px solid #26262E",
                        }}
                      />

                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>
                            {formatShortAddress(targetAddress)}
                          </span>
                          <button
                            onClick={(e) => handleCopyAddress(e, targetAddress)}
                            style={{
                              background: "none",
                              border: "none",
                              color: isCopied ? "#FFFFFF" : "#71717A",
                              padding: 2,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                            }}
                            title="Copy full wallet address"
                          >
                            {isCopied ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          {renderCallIcon(call.state === "missed" ? "missed" : call.direction)}
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              textTransform: "uppercase",
                              color: "#E4E4E7",
                              letterSpacing: "0.03em",
                            }}
                          >
                            {displayStatus}
                          </span>
                          <span style={{ fontSize: 11, color: "#71717A" }}>
                            · {durationDisplay}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAddress(targetAddress);
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: "#141418",
                        border: "1px solid #26262E",
                        color: "#FFFFFF",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                      title="Call again"
                    >
                      <Phone size={14} />
                    </button>
                  </div>
                );
              })}

              {hasMoreHistory && onLoadMoreHistory && (
                <button
                  onClick={onLoadMoreHistory}
                  disabled={isLoadingHistory}
                  className="glass-pill"
                  style={{ alignSelf: "center", margin: "8px 0", fontSize: 12, padding: "6px 16px" }}
                >
                  {isLoadingHistory ? "Loading older calls..." : "Load older calls"}
                </button>
              )}
            </>
          ) : recentCalls.length > 0 ? (
            recentCalls.map((call) => (
              <div
                key={call.id}
                onClick={() => onSelectAddress(call.address)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderRadius: 14,
                  background: "#0B0B0E",
                  border: "1px solid #26262E",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <img
                    src="/liquid-orb.jpg"
                    alt="avatar"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      objectFit: "cover",
                      filter: "grayscale(100%)",
                      border: "1px solid #26262E",
                    }}
                  />

                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>
                        {formatShortAddress(call.address)}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                      {renderCallIcon(call.direction)}
                      <span style={{ fontSize: 11, color: "#A1A1AA", textTransform: "capitalize" }}>
                        {call.direction}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectAddress(call.address);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "#141418",
                    border: "1px solid #26262E",
                    color: "#FFFFFF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <Phone size={14} />
                </button>
              </div>
            ))
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: "40px 20px",
                color: "#71717A",
              }}
            >
              <Phone size={30} style={{ marginBottom: 12, opacity: 0.4 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: "#E4E4E7" }}>
                No call history yet
              </div>
              <div style={{ fontSize: 12, marginTop: 4, maxWidth: 240 }}>
                Paste any EVM wallet address above to place an encrypted voice call.
              </div>
            </div>
          )}
        </div>
      </div>

      <nav className="floatingNavCapsule" aria-label="Bottom Navigation">
        <button
          onClick={() => onChangeNavTab("call")}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            color: activeNavTab === "call" ? "#FFFFFF" : "#71717A",
            cursor: "pointer",
          }}
        >
          <Phone size={18} />
          <span style={{ fontSize: 10, fontWeight: 600 }}>Call</span>
        </button>

        <button
          onClick={() => onChangeNavTab("recents")}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            color: activeNavTab === "recents" ? "#FFFFFF" : "#71717A",
            cursor: "pointer",
          }}
        >
          <Sparkles size={18} />
          <span style={{ fontSize: 10, fontWeight: 600 }}>Recents</span>
        </button>

        <button
          onClick={() => {
            if (!user) onConnectWallet();
            else onOpenProfile();
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            color: activeNavTab === "me" ? "#FFFFFF" : "#71717A",
            cursor: "pointer",
          }}
        >
          <UserIcon size={18} />
          <span style={{ fontSize: 10, fontWeight: 600 }}>Me</span>
        </button>
      </nav>
    </div>
  );
};
