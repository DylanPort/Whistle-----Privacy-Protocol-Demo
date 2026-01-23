/**
 * ZK Proof Generation for Whistle Protocol
 * Production version using withdraw_merkle circuit
 */

import { Connection, PublicKey } from '@solana/web3.js'

const FIELD_P = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583')
const POOL_PROGRAM_ID = new PublicKey('AMtxCTW99zCBfhukVdN8YvA3AsdSJ7nsgnUdHpth7QTD')

function bigintToBytes32BE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 64; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToBigintBE(bytes: Uint8Array): bigint {
  return BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''))
}

function formatG1BE(point: string[], negate: boolean): Uint8Array {
  let x = BigInt(point[0])
  let y = BigInt(point[1])
  if (negate) y = FIELD_P - y
  const result = new Uint8Array(64)
  result.set(bigintToBytes32BE(x), 0)
  result.set(bigintToBytes32BE(y), 32)
  return result
}

function formatG2BE_Swapped(point: string[][]): Uint8Array {
  const result = new Uint8Array(128)
  result.set(bigintToBytes32BE(BigInt(point[0][1])), 0)
  result.set(bigintToBytes32BE(BigInt(point[0][0])), 32)
  result.set(bigintToBytes32BE(BigInt(point[1][1])), 64)
  result.set(bigintToBytes32BE(BigInt(point[1][0])), 96)
  return result
}

export interface ZKProofInput {
  secret: bigint
  nullifier: bigint
  noteAmount: bigint
  commitment: bigint
  nullifierHash: bigint
  recipient: Uint8Array
  withdrawAmount: bigint
  relayerFee: bigint
  // For production circuit
  leafIndex?: number
  connection?: Connection
}

export interface ZKProofOutput {
  proof_a: Uint8Array
  proof_b: Uint8Array
  proof_c: Uint8Array
  nullifierHash: Uint8Array
  recipient: Uint8Array
  merkleRoot: Uint8Array
  amount: bigint
  fee: bigint
}

// Fetch merkle tree state and build merkle proof
async function buildMerkleProof(
  connection: Connection,
  leafIndex: number
): Promise<{ merkleRoot: bigint; pathElements: bigint[]; pathIndices: number[] }> {
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from('pool')], POOL_PROGRAM_ID)
  const [merkleTreePda] = PublicKey.findProgramAddressSync([Buffer.from('merkle_tree')], POOL_PROGRAM_ID)

  const poolAccount = await connection.getAccountInfo(poolPda)
  const merkleTreeAccount = await connection.getAccountInfo(merkleTreePda)

  if (!poolAccount || !merkleTreeAccount) {
    throw new Error('Pool or Merkle tree not found on-chain')
  }

  const poolData = poolAccount.data
  const merkleLevels = poolData[8] // merkle_levels at offset 8
  const merkleRootBytes = poolData.slice(17, 49) // current_root at offset 17
  const merkleRoot = bytesToBigintBE(new Uint8Array(merkleRootBytes))

  const merkleData = merkleTreeAccount.data
  const nodesOffset = 16 // 8 discriminator + 1 levels + 7 padding
  const nodeSize = 32

  function readNode(index: number): Uint8Array {
    if (index < 0 || index >= 256) return new Uint8Array(32)
    const start = nodesOffset + index * nodeSize
    return new Uint8Array(merkleData.slice(start, start + nodeSize))
  }

  const leafOffset = (1 << merkleLevels) - 1
  let currentIndex = leafOffset + leafIndex
  const pathElements: bigint[] = []
  const pathIndices: number[] = []

  for (let level = 0; level < merkleLevels; level++) {
    const isLeft = currentIndex % 2 === 1
    const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1
    pathElements.push(bytesToBigintBE(readNode(siblingIndex)))
    pathIndices.push(isLeft ? 0 : 1)
    currentIndex = Math.floor((currentIndex - 1) / 2)
  }

  return { merkleRoot, pathElements, pathIndices }
}

export async function generateWithdrawProof(
  input: ZKProofInput,
  onProgress?: (stage: string, percent: number) => void
): Promise<ZKProofOutput> {
  const snarkjs = await import('snarkjs')
  
  onProgress?.('Loading circuit...', 10)
  
  // Prepare recipient field element (truncate to 31 bytes, prepend 0)
  const recipientTruncated = input.recipient.slice(0, 31)
  const recipientFieldBuf = new Uint8Array(32)
  recipientFieldBuf[0] = 0
  recipientFieldBuf.set(recipientTruncated, 1)
  const recipientField = bytesToBigintBE(recipientFieldBuf)
  
  let merkleRoot: bigint
  let pathElements: bigint[]
  let pathIndices: number[]

  // If we have connection and leafIndex, fetch merkle proof from chain
  if (input.connection && input.leafIndex !== undefined) {
    onProgress?.('Fetching Merkle proof...', 15)
    const merkleData = await buildMerkleProof(input.connection, input.leafIndex)
    merkleRoot = merkleData.merkleRoot
    pathElements = merkleData.pathElements
    pathIndices = merkleData.pathIndices
  } else {
    // Fallback: use zero merkle path (won't verify on-chain but useful for testing)
    merkleRoot = BigInt(0)
    pathElements = Array(7).fill(BigInt(0))
    pathIndices = Array(7).fill(0)
  }

  const circuitInput = {
    // Public inputs
    merkleRoot: merkleRoot.toString(),
    nullifierHash: input.nullifierHash.toString(),
    recipient: recipientField.toString(),
    amount: input.withdrawAmount.toString(),
    relayerFee: input.relayerFee.toString(),
    // Private inputs
    secret: input.secret.toString(),
    nullifier: input.nullifier.toString(),
    noteAmount: input.noteAmount.toString(),
    pathElements: pathElements.map(e => e.toString()),
    pathIndices: pathIndices.map(i => i.toString()),
  }
  
  onProgress?.('Generating ZK proof...', 30)
  
  // Use basePath for production deployments
  const basePath = typeof window !== 'undefined' && window.location.pathname.startsWith('/privacy') ? '/privacy' : ''
  
  const { proof } = await snarkjs.groth16.fullProve(
    circuitInput,
    `${basePath}/circuits/withdraw_merkle.wasm`,
    `${basePath}/circuits/withdraw_merkle_final.zkey`
  )
  
  onProgress?.('Formatting proof...', 80)
  
  const proof_a = formatG1BE([proof.pi_a[0], proof.pi_a[1]], true)
  const proof_b = formatG2BE_Swapped(proof.pi_b)
  const proof_c = formatG1BE([proof.pi_c[0], proof.pi_c[1]], false)
  
  const nullifierHashBytes = bigintToBytes32BE(input.nullifierHash)
  const merkleRootBytes = bigintToBytes32BE(merkleRoot)
  
  onProgress?.('Done!', 100)
  
  return {
    proof_a,
    proof_b,
    proof_c,
    nullifierHash: nullifierHashBytes,
    recipient: recipientFieldBuf,
    merkleRoot: merkleRootBytes,
    amount: input.withdrawAmount,
    fee: input.relayerFee,
  }
}

export async function computeNoteHashes(
  secret: bigint,
  nullifier: bigint,
  amount: bigint
): Promise<{ commitment: bigint; nullifierHash: bigint }> {
  const { buildPoseidon } = await import('circomlibjs')
  const poseidon = await buildPoseidon()
  
  // commitment = Poseidon(secret, Poseidon(nullifier, amount))
  const innerHash = poseidon.F.toObject(poseidon([nullifier, amount]))
  const commitment = poseidon.F.toObject(poseidon([secret, innerHash]))
  
  // nullifierHash = Poseidon(nullifier, 0)
  const nullifierHash = poseidon.F.toObject(poseidon([nullifier, BigInt(0)]))
  
  return { commitment, nullifierHash }
}

// Helper to get leaf index for a commitment from on-chain events
export async function findLeafIndex(
  connection: Connection,
  commitment: bigint
): Promise<number | null> {
  // In production, you would:
  // 1. Query transaction history for Shield events
  // 2. Parse the commitment and leaf_index from each event
  // 3. Return the matching leaf_index
  
  // For now, we store the leaf index when shielding
  // This is a simplified approach - production would use an indexer
  return null
}
