import { isAddress, verifyMessage, getAddress } from "viem";
import { env } from "../../../config/env.js";
import type { WalletVerifierFn, WalletVerificationResult } from "../auth.service.js";

/**
 * EVM (Ethereum / Base / L2s) signature verification implementation
 * Verifies EIP-191 personal_sign signatures against wallet address, nonce, and domain
 */
export const verifyEvmSignature: WalletVerifierFn = async ({
  walletAddress,
  message,
  signature,
  nonce,
}): Promise<WalletVerificationResult> => {
  try {
    // 1. Validate EVM address format
    if (!isAddress(walletAddress)) {
      return {
        isValid: false,
        walletAddress,
        error: "Invalid EVM wallet address format",
      };
    }

    const checksumAddress = getAddress(walletAddress);

    // 2. Ensure the signed message includes the issued nonce
    if (!message.includes(nonce)) {
      return {
        isValid: false,
        walletAddress: checksumAddress,
        error: "Message does not contain the issued nonce",
      };
    }

    // 3. Ensure the signed message references the configured auth domain
    if (!message.includes(env.AUTH_DOMAIN)) {
      return {
        isValid: false,
        walletAddress: checksumAddress,
        error: `Message must bind to the authorized domain (${env.AUTH_DOMAIN})`,
      };
    }

    // 4. Verify cryptographic signature using viem
    const isValid = await verifyMessage({
      address: checksumAddress,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      return {
        isValid: false,
        walletAddress: checksumAddress,
        error: "Cryptographic signature does not match wallet address",
      };
    }

    return {
      isValid: true,
      walletAddress: checksumAddress.toLowerCase(),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Signature verification failed";
    return {
      isValid: false,
      walletAddress,
      error: `Signature verification exception: ${errorMessage}`,
    };
  }
};
