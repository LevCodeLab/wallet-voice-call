/**
 * wallet-voice-call Authentication & Wallet Service
 * Supports standard browser injected EVM wallets (MetaMask, Rabby) as well as
 * local Hardhat/Anvil test keypairs for multi-tab calling tests.
 * Uses HTTP-only cookie-based sessions for security.
 */

import { createWalletClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

export interface AuthenticatedUser {
  id: string;
  walletAddress: string;
  network: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

function getOrCreateDemoKey(slot: "alice" | "bob"): `0x${string}` {
  try {
    if (typeof localStorage !== "undefined") {
      const storageKey = `wallet_voice_call_demo_${slot}_pk`;
      const existing = localStorage.getItem(storageKey);
      if (existing && existing.startsWith("0x") && existing.length === 66) {
        return existing as `0x${string}`;
      }
      const created = generatePrivateKey();
      localStorage.setItem(storageKey, created);
      return created;
    }
  } catch {}
  return generatePrivateKey();
}

const aliceDemoKey = getOrCreateDemoKey("alice");
const bobDemoKey = getOrCreateDemoKey("bob");

// Ephemeral generated demo accounts (#0 and #1) for 2-tab local browser testing
export const TEST_ACCOUNTS = {
  ALICE: {
    name: "Alice (Test Wallet 1)",
    privateKey: aliceDemoKey,
    address: privateKeyToAccount(aliceDemoKey).address,
  },
  BOB: {
    name: "Bob (Test Wallet 2)",
    privateKey: bobDemoKey,
    address: privateKeyToAccount(bobDemoKey).address,
  },
};

export class AuthService {
  private static USER_STORAGE_KEY = "wallet_voice_call_user_profile";
  private static LEGACY_STORAGE_KEY = "wallet_voice_call_session";
  private static inMemoryToken: string | null = null;

  public static getStoredUser(): AuthenticatedUser | null {
    try {
      // Clear legacy raw token storage if present
      if (localStorage.getItem(this.LEGACY_STORAGE_KEY)) {
        try {
          const legacy = JSON.parse(localStorage.getItem(this.LEGACY_STORAGE_KEY) || "{}");
          if (legacy.user && !localStorage.getItem(this.USER_STORAGE_KEY)) {
            localStorage.setItem(this.USER_STORAGE_KEY, JSON.stringify(legacy.user));
          }
        } catch {}
        localStorage.removeItem(this.LEGACY_STORAGE_KEY);
      }

      const data = localStorage.getItem(this.USER_STORAGE_KEY);
      if (!data) return null;
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  public static getStoredSession(): { user: AuthenticatedUser; token: string } | null {
    const user = this.getStoredUser();
    if (!user) return null;
    return { user, token: this.inMemoryToken || "" };
  }

  public static saveUser(user: AuthenticatedUser, token?: string) {
    if (token) {
      this.inMemoryToken = token;
    }
    localStorage.setItem(this.USER_STORAGE_KEY, JSON.stringify(user));
  }

  public static clearSession() {
    this.inMemoryToken = null;
    localStorage.removeItem(this.USER_STORAGE_KEY);
    localStorage.removeItem(this.LEGACY_STORAGE_KEY);
  }

  public static getActiveToken(): string | null {
    return this.inMemoryToken;
  }

  /**
   * Verify current session against backend using secure HTTP-only cookie.
   */
  public static async verifySession(): Promise<AuthenticatedUser | null> {
    try {
      const headers: Record<string, string> = {};
      if (this.inMemoryToken) {
        headers["Authorization"] = `Bearer ${this.inMemoryToken}`;
      }

      const res = await fetch("/api/v1/auth/me", {
        method: "GET",
        headers,
        credentials: "include",
      });

      if (!res.ok) {
        this.clearSession();
        return null;
      }

      const body = await res.json();
      if (body.user) {
        this.saveUser(body.user);
        return body.user;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Connect using Injected Browser Wallet (MetaMask, Rabby, Brave, etc.)
   */
  public static async connectInjectedWallet(): Promise<{ user: AuthenticatedUser; token: string }> {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      throw new Error("No EVM wallet detected in your browser. Please install MetaMask, Rabby, or use a Test Wallet.");
    }

    const ethereum = (window as any).ethereum;
    const client = createWalletClient({
      chain: mainnet,
      transport: custom(ethereum),
    });

    const [account] = await client.requestAddresses();
    if (!account) {
      throw new Error("Wallet connection was denied by user.");
    }

    return this.authenticateAddress(account, async (message) => {
      return await client.signMessage({
        account,
        message,
      });
    });
  }

  /**
   * Connect using local private key (Alice, Bob, or randomly generated for tab 2 testing)
   */
  public static async connectTestWallet(privateKey: `0x${string}`): Promise<{ user: AuthenticatedUser; token: string }> {
    const account = privateKeyToAccount(privateKey);
    return this.authenticateAddress(account.address, async (message) => {
      return await account.signMessage({ message });
    });
  }

  /**
   * Common Challenge-Response Authentication against Backend
   */
  private static async authenticateAddress(
    walletAddress: string,
    signFn: (message: string) => Promise<string>
  ): Promise<{ user: AuthenticatedUser; token: string }> {
    // 1. Request nonce
    const nonceRes = await fetch("/api/v1/auth/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress,
        network: "evm",
      }),
    });

    if (!nonceRes.ok) {
      const err = await nonceRes.json().catch(() => ({}));
      throw new Error(err.message || "Failed to request authentication nonce");
    }

    const { nonce, statement } = await nonceRes.json();
    const challengeMessage = `${statement} nonce: ${nonce}`;

    // 2. Sign message
    let signature: string;
    try {
      signature = await signFn(challengeMessage);
    } catch (err: any) {
      throw new Error(err.message?.includes("User rejected") ? "Signature prompt was rejected." : "Failed to sign challenge message.");
    }

    // 3. Verify signature and create cookie session
    const verifyRes = await fetch("/api/v1/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        walletAddress,
        network: "evm",
        message: challengeMessage,
        signature,
      }),
    });

    if (!verifyRes.ok) {
      const err = await verifyRes.json().catch(() => ({}));
      throw new Error(err.message || "Signature verification failed on server");
    }

    const { user, sessionToken } = await verifyRes.json();
    this.saveUser(user, sessionToken);

    return { user, token: sessionToken };
  }

  /**
   * Logout and revoke session on server.
   */
  public static async logout(): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (this.inMemoryToken) {
        headers["Authorization"] = `Bearer ${this.inMemoryToken}`;
      }

      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers,
        credentials: "include",
      });
    } catch {}
    this.clearSession();
  }
}
