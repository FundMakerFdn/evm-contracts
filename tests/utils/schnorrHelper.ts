import { keccak256, Hex, toHex } from "viem";
import { ethers } from "hardhat";

// Simple key pair interface
interface KeyPair {
  privateKey: Hex;
  publicKey: {
    parity: number;  // 27 or 28 for real Schnorr keys
    x: Hex;
  };
}

// Signature interface matching the contract's Signature struct
interface SchnorrSignature {
  e: Hex;  // challenge
  s: Hex;  // signature value
}

class SchnorrHelper {
  // SECP256K1 curve order
  private static readonly CURVE_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

  /**
   * Generate a Schnorr key pair for testing
   * For simplicity, we'll use a deterministic approach rather than full cryptographic implementation
   */
  static generateKeyPair(seed?: string): KeyPair {
    // If seed is provided, use it to create deterministic key
    const privateKeyBytes = seed 
      ? ethers.utils.arrayify(keccak256(toHex(seed)))
      : ethers.randomBytes(32);
    
    const privateKey = toHex(privateKeyBytes) as Hex;
    
    // Derive a public key (for a real implementation, we'd use EC point multiplication)
    // For our test purposes, we'll derive it deterministically from the private key
    const publicKeyX = keccak256(ethers.solidityPacked(["bytes32", "string"], [privateKey, "x"])) as Hex;
    
    // For simplicity, we'll use 27 as parity (would be based on y-coordinate in reality)
    const parity = 27;
    
    return {
      privateKey,
      publicKey: {
        parity,
        x: publicKeyX
      }
    };
  }

  /**
   * Create a test signer that uses the user's address as their public key
   * This uses the special case in the contract where parity=0 means to check msg.sender
   */
  static createAddressSigner(address: string): KeyPair {
    return {
      privateKey: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      publicKey: {
        parity: 0,
        x: ethers.utils.hexZeroPad(address, 32) as Hex
      }
    };
  }

  /**
   * Combine multiple public keys into one (for multi-sig scenarios)
   * In a real implementation, this would use EC point addition
   * Here we'll use a simplified approach for testing
   */
  static aggregatePublicKeys(keys: { parity: number; x: Hex }[]): { parity: number; x: Hex } {
    // A real implementation would add the EC points
    // For our test, we'll combine the x coordinates with xor and use parity 27
    const combinedX = keys.reduce((acc, key) => {
      const xValue = BigInt(key.x);
      const accValue = BigInt(acc);
      return toHex(accValue ^ xValue) as Hex;
    }, "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex);
    
    return {
      parity: 27, // Using 27 for multi-sig to indicate it needs Schnorr verification
      x: combinedX
    };
  }

  /**
   * Generate a Schnorr signature for testing
   * This is a simplified version for tests - not cryptographically secure
   */
  static sign(
    message: string | Uint8Array,
    keyPair: KeyPair
  ): SchnorrSignature {
    // If parity is 0, we're in address mode - don't need a real signature
    if (keyPair.publicKey.parity === 0) {
      return {
        e: ethers.utils.hexlify(ethers.randomBytes(32)) as Hex,
        s: ethers.utils.hexlify(ethers.randomBytes(32)) as Hex
      };
    }
    
    // For simplicity in tests, we'll create a deterministic but fake signature
    // Hash the message
    const messageHash = typeof message === 'string' 
      ? keccak256(toHex(message))
      : keccak256(toHex(message));
    
    // Create a deterministic challenge value e based on private key and message
    const eData = ethers.solidityPacked(
      ["bytes32", "bytes32", "uint8", "bytes32"],
      [
        keyPair.privateKey,
        messageHash,
        keyPair.publicKey.parity,
        keyPair.publicKey.x
      ]
    );
    const e = keccak256(eData) as Hex;
    
    // Create a deterministic signature value s
    const sData = ethers.solidityPacked(
      ["bytes32", "bytes32"],
      [e, keyPair.privateKey]
    );
    const s = keccak256(sData) as Hex;
    
    return { e, s };
  }

  /**
   * Create a multi-signature from individual signatures
   * In a real implementation, this would properly aggregate Schnorr signatures
   */
  static aggregateSignatures(signatures: SchnorrSignature[]): SchnorrSignature {
    // For a real implementation, this would do proper Schnorr signature aggregation
    // For our test version, we'll combine e and s values with XOR
    const e = signatures.reduce((acc, sig) => {
      const eValue = BigInt(sig.e);
      const accValue = BigInt(acc);
      return toHex(accValue ^ eValue) as Hex;
    }, "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex);
    
    const s = signatures.reduce((acc, sig) => {
      const sValue = BigInt(sig.s);
      const accValue = BigInt(acc);
      return toHex(accValue ^ sValue) as Hex;
    }, "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex);
    
    return { e, s };
  }

  /**
   * Create a message to sign for custodyToAddress
   */
  static createCustodyToAddressMessage(
    timestamp: number,
    id: string,
    token: string,
    destination: string,
    amount: bigint
  ): Hex {
    return ethers.solidityPacked(
      ["uint256", "string", "bytes32", "address", "address", "uint256"],
      [timestamp, "custodyToAddress", id, token, destination, amount]
    ) as Hex;
  }
}

export { SchnorrHelper, type KeyPair, type SchnorrSignature }; 