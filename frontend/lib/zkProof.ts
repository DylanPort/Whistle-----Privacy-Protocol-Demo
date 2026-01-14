/**
 * ZK Proof Generation for Whistle Protocol
 */

const FIELD_P = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583')

function bigintToBytes32BE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 64; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
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
}

export interface ZKProofOutput {
  proof_a: Uint8Array
  proof_b: Uint8Array
  proof_c: Uint8Array
  commitment: Uint8Array
  nullifierHash: Uint8Array
  recipient: Uint8Array
  amount: bigint
  fee: bigint
}

export async function generateWithdrawProof(
  input: ZKProofInput,
  onProgress?: (stage: string, percent: number) => void
): Promise<ZKProofOutput> {
  const snarkjs = await import('snarkjs')
  
  onProgress?.('Loading circuit...', 10)
  
  const recipientTruncated = input.recipient.slice(0, 31)
  const recipientField = BigInt('0x' + Buffer.from(recipientTruncated).toString('hex'))
  
  const circuitInput = {
    commitment: input.commitment.toString(),
    nullifierHash: input.nullifierHash.toString(),
    recipient: recipientField.toString(),
    amount: input.withdrawAmount.toString(),
    relayerFee: input.relayerFee.toString(),
    secret: input.secret.toString(),
    nullifier: input.nullifier.toString(),
    noteAmount: input.noteAmount.toString(),
  }
  
  onProgress?.('Generating proof...', 30)
  
  // Use basePath for production
  const basePath = typeof window !== 'undefined' && window.location.pathname.startsWith('/privacy') ? '/privacy' : ''
  
  const { proof } = await snarkjs.groth16.fullProve(
    circuitInput,
    `${basePath}/circuits/withdraw_simple.wasm`,
    `${basePath}/circuits/withdraw_simple_final.zkey`
  )
  
  onProgress?.('Formatting proof...', 80)
  
  const proof_a = formatG1BE([proof.pi_a[0], proof.pi_a[1]], true)
  const proof_b = formatG2BE_Swapped(proof.pi_b)
  const proof_c = formatG1BE([proof.pi_c[0], proof.pi_c[1]], false)
  
  const commitmentBytes = bigintToBytes32BE(input.commitment)
  const nullifierHashBytes = bigintToBytes32BE(input.nullifierHash)
  
  const recipientPadded = new Uint8Array(32)
  recipientPadded.set(recipientTruncated, 1)
  
  onProgress?.('Done!', 100)
  
  return {
    proof_a,
    proof_b,
    proof_c,
    commitment: commitmentBytes,
    nullifierHash: nullifierHashBytes,
    recipient: recipientPadded,
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
  
  const innerHash = poseidon.F.toObject(poseidon([nullifier, amount]))
  const commitment = poseidon.F.toObject(poseidon([secret, innerHash]))
  const nullifierHash = poseidon.F.toObject(poseidon([nullifier, BigInt(0)]))
  
  return { commitment, nullifierHash }
}

 * ZK Proof Generation for Whistle Protocol
 */

const FIELD_P = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583')

function bigintToBytes32BE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 64; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
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
}

export interface ZKProofOutput {
  proof_a: Uint8Array
  proof_b: Uint8Array
  proof_c: Uint8Array
  commitment: Uint8Array
  nullifierHash: Uint8Array
  recipient: Uint8Array
  amount: bigint
  fee: bigint
}

export async function generateWithdrawProof(
  input: ZKProofInput,
  onProgress?: (stage: string, percent: number) => void
): Promise<ZKProofOutput> {
  const snarkjs = await import('snarkjs')
  
  onProgress?.('Loading circuit...', 10)
  
  const recipientTruncated = input.recipient.slice(0, 31)
  const recipientField = BigInt('0x' + Buffer.from(recipientTruncated).toString('hex'))
  
  const circuitInput = {
    commitment: input.commitment.toString(),
    nullifierHash: input.nullifierHash.toString(),
    recipient: recipientField.toString(),
    amount: input.withdrawAmount.toString(),
    relayerFee: input.relayerFee.toString(),
    secret: input.secret.toString(),
    nullifier: input.nullifier.toString(),
    noteAmount: input.noteAmount.toString(),
  }
  
  onProgress?.('Generating proof...', 30)
  
  // Use basePath for production
  const basePath = typeof window !== 'undefined' && window.location.pathname.startsWith('/privacy') ? '/privacy' : ''
  
  const { proof } = await snarkjs.groth16.fullProve(
    circuitInput,
    `${basePath}/circuits/withdraw_simple.wasm`,
    `${basePath}/circuits/withdraw_simple_final.zkey`
  )
  
  onProgress?.('Formatting proof...', 80)
  
  const proof_a = formatG1BE([proof.pi_a[0], proof.pi_a[1]], true)
  const proof_b = formatG2BE_Swapped(proof.pi_b)
  const proof_c = formatG1BE([proof.pi_c[0], proof.pi_c[1]], false)
  
  const commitmentBytes = bigintToBytes32BE(input.commitment)
  const nullifierHashBytes = bigintToBytes32BE(input.nullifierHash)
  
  const recipientPadded = new Uint8Array(32)
  recipientPadded.set(recipientTruncated, 1)
  
  onProgress?.('Done!', 100)
  
  return {
    proof_a,
    proof_b,
    proof_c,
    commitment: commitmentBytes,
    nullifierHash: nullifierHashBytes,
    recipient: recipientPadded,
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
  
  const innerHash = poseidon.F.toObject(poseidon([nullifier, amount]))
  const commitment = poseidon.F.toObject(poseidon([secret, innerHash]))
  const nullifierHash = poseidon.F.toObject(poseidon([nullifier, BigInt(0)]))
  
  return { commitment, nullifierHash }
}
