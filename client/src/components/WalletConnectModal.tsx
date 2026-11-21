import React, { useState } from "react";
import { Sparkles, Wallet, X, AlertCircle, ShieldCheck } from "lucide-react";
import { AuthService, TEST_ACCOUNTS, AuthenticatedUser } from "../services/auth.service";
import { generatePrivateKey } from "viem/accounts";

interface WalletConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: AuthenticatedUser, token: string) => void;
}

export const WalletConnectModal: React.FC<WalletConnectModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConnectInjected = async () => {
    setLoading("injected");
    setError(null);
    try {
      const { user, token } = await AuthService.connectInjectedWallet();
      onSuccess(user, token);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to connect browser wallet");
    } finally {
      setLoading(null);
    }
  };

  const handleConnectTest = async (keyName: "ALICE" | "BOB" | "RANDOM") => {
    setLoading(keyName);
    setError(null);
    try {
      let privateKey: `0x${string}`;
      if (keyName === "ALICE") {
        privateKey = TEST_ACCOUNTS.ALICE.privateKey;
      } else if (keyName === "BOB") {
        privateKey = TEST_ACCOUNTS.BOB.privateKey;
      } else {
        privateKey = generatePrivateKey();
      }

      const { user, token } = await AuthService.connectTestWallet(privateKey);
      onSuccess(user, token);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to authenticate test wallet");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="screen-dimmer" style={{ display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#141418",
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          borderTop: "1px solid #26262E",
          padding: "20px 24px calc(max(env(safe-area-inset-bottom, 20px), 20px) + 20px) 24px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          animation: "slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          zIndex: 101,
          position: "relative",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: "#26262E" }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "#0B0B0E",
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
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.02em" }}>
                Sign in with wallet
              </h3>
              <p style={{ fontSize: 12, color: "#A1A1AA" }}>
                Sign a free message to verify wallet identity
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "#0B0B0E",
              border: "1px solid #26262E",
              borderRadius: "50%",
              width: 30,
              height: 30,
              color: "#E4E4E7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderRadius: 12,
              background: "#0B0B0E",
              border: "1px solid #26262E",
              color: "#FFFFFF",
              fontSize: 13,
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={handleConnectInjected}
            disabled={loading !== null}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderRadius: 14,
              background: "#FFFFFF",
              border: "1px solid #FFFFFF",
              color: "#000000",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Wallet size={20} color="#000000" />
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Browser Wallet</div>
                <div style={{ fontSize: 11, color: "#3F3F46" }}>
                  MetaMask, Rabby, Brave, or Injected EVM
                </div>
              </div>
            </div>
            {loading === "injected" && <span style={{ fontSize: 12, fontWeight: 600 }}>Signing...</span>}
          </button>

          <button
            onClick={() => handleConnectTest("ALICE")}
            disabled={loading !== null}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderRadius: 14,
              background: "#0B0B0E",
              border: "1px solid #26262E",
              color: "#FFFFFF",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "#141418",
                  border: "1px solid #26262E",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                A
              </div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Alice (Hardhat Account #0)</div>
                <div style={{ fontSize: 11, color: "#A1A1AA" }}>0xf39F...2266</div>
              </div>
            </div>
            <span style={{ fontSize: 11, color: "#A1A1AA" }}>
              {loading === "ALICE" ? "Connecting..." : "Instant SIWE"}
            </span>
          </button>

          <button
            onClick={() => handleConnectTest("BOB")}
            disabled={loading !== null}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderRadius: 14,
              background: "#0B0B0E",
              border: "1px solid #26262E",
              color: "#FFFFFF",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "#141418",
                  border: "1px solid #26262E",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                B
              </div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Bob (Hardhat Account #1)</div>
                <div style={{ fontSize: 11, color: "#A1A1AA" }}>0x7099...79C8</div>
              </div>
            </div>
            <span style={{ fontSize: 11, color: "#A1A1AA" }}>
              {loading === "BOB" ? "Connecting..." : "Instant SIWE"}
            </span>
          </button>

          <button
            onClick={() => handleConnectTest("RANDOM")}
            disabled={loading !== null}
            style={{
              padding: "11px 16px",
              borderRadius: 12,
              background: "#141418",
              border: "1px dashed #26262E",
              color: "#E4E4E7",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            {loading === "RANDOM" ? "Generating..." : "+ Generate Ephemeral Test Wallet"}
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 11,
            color: "#A1A1AA",
            marginTop: 4,
          }}
        >
          <ShieldCheck size={14} color="#FFFFFF" />
          <span>Zero gas fees. Signature only verifies wallet ownership.</span>
        </div>
      </div>
    </div>
  );
};
