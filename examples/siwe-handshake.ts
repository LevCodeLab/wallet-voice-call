/**
 * Minimal CLI example showing how two EVM wallets sign SIWE challenges
 * locally using viem before upgrading to the /ws signaling socket.
 *
 * Run with: npx tsx examples/siwe-handshake.ts
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyEvmSignature } from "../src/modules/auth/verifiers/evm.verifier.js";
import { env } from "../src/config/env.js";

async function main() {
  const caller = privateKeyToAccount(generatePrivateKey());
  const nonce = "9f8e7d6c5b4a39281726354455667788";
  const message = `Sign in to wallet-voice-call (${env.AUTH_DOMAIN}) to authenticate your wallet identity. nonce: ${nonce}`;

  const signature = await caller.signMessage({ message });
  const verified = await verifyEvmSignature({
    walletAddress: caller.address,
    message,
    signature,
    nonce,
  });

  console.log("Caller wallet:", caller.address);
  console.log("Signature valid:", verified.isValid);
}

main().catch(console.error);
