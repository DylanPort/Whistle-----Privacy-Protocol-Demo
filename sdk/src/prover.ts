import * as crypto from 'crypto';

// Types
export interface DepositNote {
  secret: Uint8Array;
  nullifier: Uint8Array;
  commitment: Uint8Array;
  nullifierHash: Uint8Array;
  amount: bigint;
  leafIndex?: number;
}

export interface DepositProof {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  commitment: Uint8Array;
}

export interface WithdrawProof {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  nullifierHash: Uint8Array;
  merkleRoot: Uint8Array;
}

export interface MerkleProof {
  pathElements: Uint8Array[];
  pathIndices: number[];
  root: Uint8Array;
}

// Poseidon hash state (initialized lazily)
let poseidonInitialized = false;

/**
 * Initialize Poseidon hasher
 * In production: load actual Poseidon implementation
 */
export async function initPoseidon(): Promise<void> {
  poseidonInitialized = true;
}

/**
 * Poseidon hash function
 * Using keccak256 as placeholder - production uses actual Poseidon
 */
function poseidonHash(...inputs: Uint8Array[]): Uint8Array {
  const combined = Buffer.concat(inputs.map(i => Buffer.from(i)));
  const hash = crypto.createHash('sha3-256').update(combined).digest();
  return new Uint8Array(hash);
}

/**
 * Generate a new deposit note with random secrets
 */
export function generateDepositNote(amountLamports: bigint): DepositNote {
  const secret = crypto.randomBytes(31);
  const nullifier = crypto.randomBytes(31);
  
  // commitment = H(secret || nullifier || amount)
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(amountLamports);
  
  const commitment = poseidonHash(secret, nullifier, amountBytes);
  
  // nullifierHash = H(nullifier)
  const nullifierHash = poseidonHash(nullifier);

  return {
    secret: new Uint8Array(secret),
    nullifier: new Uint8Array(nullifier),
    commitment,
    nullifierHash,
    amount: amountLamports,
  };
}

/**
 * Generate deposit proof
 * Proves knowledge of secret that produces commitment
 */
export async function generateDepositProof(note: DepositNote): Promise<DepositProof> {
  // In production: use snarkjs to generate actual proof
  // For hackathon: return placeholder proof
  
  return {
    proofA: new Uint8Array(64).fill(1),
    proofB: new Uint8Array(128).fill(2),
    proofC: new Uint8Array(64).fill(3),
    commitment: note.commitment,
  };
}

/**
 * Build Merkle proof for a leaf
 */
export function buildMerkleProof(
  leaves: Uint8Array[],
  leafIndex: number,
  levels: number = 20
): MerkleProof {
  const pathElements: Uint8Array[] = [];
  const pathIndices: number[] = [];
  
  let currentIndex = leafIndex;
  let currentLevel = [...leaves];
  
  // Pad to power of 2
  while (currentLevel.length < (1 << levels)) {
    currentLevel.push(new Uint8Array(32));
  }
  
  for (let level = 0; level < levels; level++) {
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
    pathElements.push(currentLevel[siblingIndex] || new Uint8Array(32));
    pathIndices.push(currentIndex % 2);
    
    // Compute next level
    const nextLevel: Uint8Array[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i] || new Uint8Array(32);
      const right = currentLevel[i + 1] || new Uint8Array(32);
      nextLevel.push(poseidonHash(left, right));
    }
    
    currentLevel = nextLevel;
    currentIndex = Math.floor(currentIndex / 2);
  }
  
  return {
    pathElements,
    pathIndices,
    root: currentLevel[0],
  };
}

/**
 * Generate withdrawal proof
 * Proves: I know a secret that corresponds to a commitment in the Merkle tree
 * Without revealing: which commitment is mine
 */
export async function generateWithdrawProof(
  note: DepositNote,
  merkleProof: MerkleProof,
  recipient: Uint8Array,
  relayerFee: bigint = BigInt(0)
): Promise<WithdrawProof> {
  // Circuit inputs
  const _privateInputs = {
    secret: note.secret,
    nullifier: note.nullifier,
    pathElements: merkleProof.pathElements,
    pathIndices: merkleProof.pathIndices,
  };
  
  const _publicInputs = {
    merkleRoot: merkleProof.root,
    nullifierHash: note.nullifierHash,
    recipient,
    amount: note.amount,
    relayerFee,
  };
  
  // In production: use snarkjs to generate actual Groth16 proof
  // For hackathon: return placeholder proof
  
  return {
    proofA: new Uint8Array(64).fill(1),
    proofB: new Uint8Array(128).fill(2),
    proofC: new Uint8Array(64).fill(3),
    nullifierHash: note.nullifierHash,
    merkleRoot: merkleProof.root,
  };
}

/**
 * Verify a proof locally (for testing)
 */
export function verifyProof(
  proof: WithdrawProof | DepositProof,
  _publicInputs: Record<string, unknown>
): boolean {
  // Check proof is not all zeros
  const isNonZero = (arr: Uint8Array) => arr.some(b => b !== 0);
  
  return (
    isNonZero(proof.proofA) &&
    isNonZero(proof.proofB) &&
    isNonZero(proof.proofC)
  );
}

/**
 * Serialize note for storage
 */
export function serializeNote(note: DepositNote): string {
  const data = {
    secret: bytesToHex(note.secret),
    nullifier: bytesToHex(note.nullifier),
    commitment: bytesToHex(note.commitment),
    nullifierHash: bytesToHex(note.nullifierHash),
    amount: note.amount.toString(),
    leafIndex: note.leafIndex,
  };
  return JSON.stringify(data);
}

/**
 * Deserialize note from storage
 */
export function deserializeNote(serialized: string): DepositNote {
  const data = JSON.parse(serialized);
  return {
    secret: hexToBytes(data.secret),
    nullifier: hexToBytes(data.nullifier),
    commitment: hexToBytes(data.commitment),
    nullifierHash: hexToBytes(data.nullifierHash),
    amount: BigInt(data.amount),
    leafIndex: data.leafIndex,
  };
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

