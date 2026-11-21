import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyEvmSignature } from "./evm.verifier.js";
import { env } from "../../../config/env.js";
import { AuthService } from "../auth.service.js";

describe("EVM SIWE Verifier & Single-Use WS Ticket Unit Tests", () => {
  it("verifies a genuine EIP-191 wallet signature bound to domain and nonce", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const message = `Sign in to wallet-voice-call (${env.AUTH_DOMAIN}) to authenticate your wallet identity. nonce: ${nonce}`;
    const signature = await account.signMessage({ message });

    const res = await verifyEvmSignature({
      walletAddress: account.address,
      message,
      signature,
      nonce,
    });

    expect(res.isValid).toBe(true);
    expect(res.walletAddress).toBe(account.address.toLowerCase());
  });

  it("rejects signature signed by a different EVM keypair", async () => {
    const victim = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const nonce = "ff00112233445566778899aabbccdde0";
    const message = `Sign in to wallet-voice-call (${env.AUTH_DOMAIN}) to authenticate your wallet identity. nonce: ${nonce}`;
    const forgedSig = await attacker.signMessage({ message });

    const res = await verifyEvmSignature({
      walletAddress: victim.address,
      message,
      signature: forgedSig,
      nonce,
    });

    expect(res.isValid).toBe(false);
    expect(res.error).toContain("does not match");
  });

  it("rejects message missing the issued nonce or authorized domain", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = "1234567890abcdef1234567890abcdef";
    const badDomainMsg = `Sign in to evil-phishing.example to authenticate. nonce: ${nonce}`;
    const sig = await account.signMessage({ message: badDomainMsg });

    const res = await verifyEvmSignature({
      walletAddress: account.address,
      message: badDomainMsg,
      signature: sig,
      nonce,
    });

    expect(res.isValid).toBe(false);
    expect(res.error).toContain("authorized domain");
  });

  it("issues and atomically consumes single-use WebSocket upgrade tickets", () => {
    const auth = new AuthService();
    const { ticket } = auth.createWsTicket("user-uuid-1", 60);

    expect(auth.consumeWsTicket(ticket)).toBe("user-uuid-1");
    // Second use must fail to prevent replay
    expect(auth.consumeWsTicket(ticket)).toBeNull();
  });
});
