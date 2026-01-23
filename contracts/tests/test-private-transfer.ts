/**
 * WHISTLE PROTOCOL - PRIVATE TRANSFER TEST
 * 
 * This test demonstrates:
 * 1. Creating two shielded notes with deposits
 * 2. Privately transferring/merging them into new notes
 * 3. Value conservation without revealing amounts
 * 
 * Use cases:
 * - Split: 1 note → 2 notes (e.g., 0.02 SOL → 0.01 + 0.01 SOL)
 * - Merge: 2 notes → 1 note (e.g., 0.01 + 0.01 → 0.02 SOL)
 * - Transfer: Send to new commitment (recipient generates secrets)
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
// @ts-ignore
import { groth16 } from "snarkjs";
// @ts-ignore
import { buildPoseidon } from "circomlibjs";

// Program ID
const POOL_PROGRAM_ID = new PublicKey("AMtxCTW99zCBfhukVdN8YvA3AsdSJ7nsgnUdHpth7QTD");

// BN254 field prime
const FIELD_PRIME = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const BN254_BASE_FIELD = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');

// Generate Anchor discriminator
function getDiscriminator(name: string): Buffer {
  const crypto = require("crypto");
  return crypto.createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .slice(0, 8);
}

// Convert bigint to 32-byte big-endian buffer
function bigintToBytes32(n: bigint): Buffer {
  const hex = n.toString(16).padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

function bytesToBigintBE(bytes: Buffer): bigint {
  return BigInt('0x' + bytes.toString('hex'));
}

// Convert G1 point to 64 bytes with negated y (required by groth16-solana)
function g1ToBytesNegated(point: string[]): Buffer {
  const x = BigInt(point[0]);
  const y = BigInt(point[1]) % BN254_BASE_FIELD;
  const yNeg = y === 0n ? 0n : BN254_BASE_FIELD - y;
  return Buffer.concat([bigintToBytes32(x), bigintToBytes32(yNeg)]);
}

// Convert G1 point to 64 bytes
function g1ToBytes(point: string[]): Buffer {
  return Buffer.concat([bigintToBytes32(BigInt(point[0])), bigintToBytes32(BigInt(point[1]))]);
}

// Convert G2 point to 128 bytes (swapped for Solana)
function g2ToBytesSwapped(point: string[][]): Buffer {
  const x0 = bigintToBytes32(BigInt(point[0][0]));
  const x1 = bigintToBytes32(BigInt(point[0][1]));
  const y0 = bigintToBytes32(BigInt(point[1][0]));
  const y1 = bigintToBytes32(BigInt(point[1][1]));
  return Buffer.concat([x1, x0, y1, y0]);
}

interface Note {
  secret: bigint;
  nullifier: bigint;
  amount: bigint;
  commitment: bigint;
  nullifierHash: bigint;
  leafIndex: number;
}

async function createNote(
  poseidon: any, 
  F: any, 
  amount: bigint
): Promise<Note> {
  const crypto = require("crypto");
  const secret = BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD_PRIME;
  const nullifier = BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD_PRIME;
  
  // commitment = Poseidon(secret, Poseidon(nullifier, amount))
  const innerHashResult = poseidon([F.e(nullifier.toString()), F.e(amount.toString())]);
  const innerHash = BigInt(F.toString(innerHashResult));
  const commitmentResult = poseidon([F.e(secret.toString()), F.e(innerHash.toString())]);
  const commitment = BigInt(F.toString(commitmentResult));
  
  // nullifierHash = Poseidon(nullifier, 0)
  const nullifierHashResult = poseidon([F.e(nullifier.toString()), F.e("0")]);
  const nullifierHash = BigInt(F.toString(nullifierHashResult));

  return { secret, nullifier, amount, commitment, nullifierHash, leafIndex: -1 };
}

async function depositNote(
  connection: Connection,
  wallet: Keypair,
  poolPda: PublicKey,
  merkleTreePda: PublicKey,
  rootsHistoryPda: PublicKey,
  vaultPda: PublicKey,
  note: Note
): Promise<Note> {
  const poolBefore = await connection.getAccountInfo(poolPda);
  const leafIndex = Number(poolBefore!.data.readBigUInt64LE(9));

  const shieldDiscriminator = getDiscriminator("shield");
  const commitmentBytes = bigintToBytes32(note.commitment);
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(note.amount);
  
  const shieldData = Buffer.concat([shieldDiscriminator, commitmentBytes, amountBuffer]);

  const shieldIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: merkleTreePda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: shieldData,
  });

  const tx = new Transaction().add(shieldIx);
  await sendAndConfirmTransaction(connection, tx, [wallet], { commitment: "confirmed" });
  
  return { ...note, leafIndex };
}

function buildMerkleProof(
  merkleData: Buffer,
  merkleLevels: number,
  leafIndex: number
): { pathElements: bigint[], pathIndices: number[] } {
  const nodesOffset = 16;
  const nodeSize = 32;

  function readNode(index: number): Buffer {
    if (index < 0 || index >= 256) return Buffer.alloc(32);
    const start = nodesOffset + index * nodeSize;
    return merkleData.slice(start, start + nodeSize);
  }

  const leafOffset = (1 << merkleLevels) - 1;
  let currentIndex = leafOffset + leafIndex;
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];

  for (let level = 0; level < merkleLevels; level++) {
    const isLeft = currentIndex % 2 === 1;
    const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;
    pathElements.push(bytesToBigintBE(readNode(siblingIndex)));
    pathIndices.push(isLeft ? 0 : 1);
    currentIndex = Math.floor((currentIndex - 1) / 2);
  }

  return { pathElements, pathIndices };
}

async function main() {
  console.log("=".repeat(70));
  console.log("WHISTLE PROTOCOL - PRIVATE TRANSFER TEST");
  console.log("=".repeat(70));

  // Initialize Poseidon
  console.log("\nInitializing Poseidon hasher...");
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // Load wallet
  const walletPath = "C:\\Users\\salva\\Downloads\\server\\whistle-protocol\\keys\\deploy-wallet.json";
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  
  console.log("Wallet:", walletKeypair.publicKey.toBase58());

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  // Generate PDAs
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
  const [merkleTreePda] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree")], POOL_PROGRAM_ID);
  const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
  const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);

  // Check if pool exists
  const poolAccount = await connection.getAccountInfo(poolPda);
  if (!poolAccount) {
    console.log("ERROR: Pool not initialized. Please run test-zk-withdraw.ts first.");
    return;
  }

  // ========================================
  // STEP 1: CREATE AND DEPOSIT TWO NOTES
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 1: CREATE AND DEPOSIT TWO NOTES");
  console.log("=".repeat(70));

  // Note 1: 0.01 SOL
  const note1Amount = BigInt(Math.floor(0.01 * LAMPORTS_PER_SOL));
  let note1 = await createNote(poseidon, F, note1Amount);
  console.log("\nNote 1 Amount:", Number(note1.amount) / LAMPORTS_PER_SOL, "SOL");
  
  note1 = await depositNote(connection, walletKeypair, poolPda, merkleTreePda, rootsHistoryPda, vaultPda, note1);
  console.log("Note 1 deposited at leaf index:", note1.leafIndex);

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Note 2: 0.01 SOL
  const note2Amount = BigInt(Math.floor(0.01 * LAMPORTS_PER_SOL));
  let note2 = await createNote(poseidon, F, note2Amount);
  console.log("\nNote 2 Amount:", Number(note2.amount) / LAMPORTS_PER_SOL, "SOL");
  
  note2 = await depositNote(connection, walletKeypair, poolPda, merkleTreePda, rootsHistoryPda, vaultPda, note2);
  console.log("Note 2 deposited at leaf index:", note2.leafIndex);

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log("\n✅ Both notes deposited!");
  console.log("Total value in notes:", Number(note1.amount + note2.amount) / LAMPORTS_PER_SOL, "SOL");

  // ========================================
  // STEP 2: CREATE OUTPUT NOTES
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 2: CREATE OUTPUT NOTES (Merge into one)");
  console.log("=".repeat(70));

  // Output 1: Combined value (0.02 SOL)
  const totalInput = note1.amount + note2.amount;
  const outNote1 = await createNote(poseidon, F, totalInput);
  console.log("Output Note 1 Amount:", Number(outNote1.amount) / LAMPORTS_PER_SOL, "SOL");

  // Output 2: Zero (not used in merge)
  const outNote2 = await createNote(poseidon, F, BigInt(0));
  // Zero amount means zero commitment
  const outNote2Commitment = BigInt(0);
  const outNote2NullifierHash = BigInt(0);

  console.log("Output Note 2 Amount:", 0, "SOL (unused)");
  console.log("Value conservation:", Number(note1.amount + note2.amount) / LAMPORTS_PER_SOL, 
              "→", Number(outNote1.amount) / LAMPORTS_PER_SOL, "SOL");

  // ========================================
  // STEP 3: BUILD MERKLE PROOFS
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 3: BUILD MERKLE PROOFS");
  console.log("=".repeat(70));

  const poolData = (await connection.getAccountInfo(poolPda))!.data;
  const merkleLevels = poolData.readUInt8(8);
  const merkleRootBytes = poolData.slice(17, 49);
  const merkleRoot = bytesToBigintBE(merkleRootBytes);

  const merkleTreeAccount = await connection.getAccountInfo(merkleTreePda);
  const merkleData = merkleTreeAccount!.data;

  const proof1 = buildMerkleProof(merkleData, merkleLevels, note1.leafIndex);
  const proof2 = buildMerkleProof(merkleData, merkleLevels, note2.leafIndex);

  console.log("Merkle Root:", merkleRoot.toString().slice(0, 20) + "...");
  console.log("Note 1 leaf index:", note1.leafIndex);
  console.log("Note 2 leaf index:", note2.leafIndex);

  // ========================================
  // STEP 4: GENERATE ZK PROOF
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 4: GENERATE ZK PROOF (private_transfer)");
  console.log("=".repeat(70));

  // Circuit inputs for private_transfer (2-in-2-out)
  const circuitInput = {
    // Public inputs
    merkleRoot: merkleRoot.toString(),
    inputNullifierHashes: [note1.nullifierHash.toString(), note2.nullifierHash.toString()],
    outputCommitments: [outNote1.commitment.toString(), outNote2Commitment.toString()],
    
    // Private inputs - Input Note 1
    inSecret1: note1.secret.toString(),
    inNullifier1: note1.nullifier.toString(),
    inAmount1: note1.amount.toString(),
    inPathElements1: proof1.pathElements.map(e => e.toString()),
    inPathIndices1: proof1.pathIndices.map(i => i.toString()),
    
    // Private inputs - Input Note 2
    inSecret2: note2.secret.toString(),
    inNullifier2: note2.nullifier.toString(),
    inAmount2: note2.amount.toString(),
    inPathElements2: proof2.pathElements.map(e => e.toString()),
    inPathIndices2: proof2.pathIndices.map(i => i.toString()),
    
    // Private inputs - Output Note 1
    outSecret1: outNote1.secret.toString(),
    outNullifier1: outNote1.nullifier.toString(),
    outAmount1: outNote1.amount.toString(),
    
    // Private inputs - Output Note 2 (zero)
    outSecret2: outNote2.secret.toString(),
    outNullifier2: outNote2.nullifier.toString(),
    outAmount2: "0",
  };

  console.log("\nGenerating ZK proof...");

  const circuitDir = path.join(__dirname, "../../circuits/build/production");
  const wasmPath = path.join(circuitDir, "private_transfer/private_transfer_js/private_transfer.wasm");
  const zkeyPath = path.join(circuitDir, "private_transfer/private_transfer_final.zkey");

  if (!fs.existsSync(wasmPath)) {
    console.log("ERROR: WASM file not found at:", wasmPath);
    return;
  }
  if (!fs.existsSync(zkeyPath)) {
    console.log("ERROR: zkey file not found at:", zkeyPath);
    return;
  }

  let proof: any;
  let publicSignals: any;
  
  try {
    const result = await groth16.fullProve(circuitInput, wasmPath, zkeyPath);
    proof = result.proof;
    publicSignals = result.publicSignals;
    console.log("✅ Proof generated successfully!");
    console.log("Public signals:", publicSignals.length);
  } catch (error: any) {
    console.log("Proof generation error:", error.message);
    return;
  }

  // Convert proof to Solana format
  const proofA = g1ToBytesNegated(proof.pi_a);
  const proofB = g2ToBytesSwapped(proof.pi_b);
  const proofC = g1ToBytes(proof.pi_c);

  // ========================================
  // STEP 5: EXECUTE PRIVATE TRANSFER
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 5: EXECUTE PRIVATE TRANSFER");
  console.log("=".repeat(70));

  const transferDiscriminator = getDiscriminator("private_transfer");
  
  const nullifierHash1Bytes = bigintToBytes32(note1.nullifierHash);
  const nullifierHash2Bytes = bigintToBytes32(note2.nullifierHash);
  const outCommitment1Bytes = bigintToBytes32(outNote1.commitment);
  const outCommitment2Bytes = bigintToBytes32(outNote2Commitment);

  // Instruction data layout:
  // discriminator (8) + proof_a (64) + proof_b (128) + proof_c (64) +
  // input_nullifier_hashes (64) + output_commitments (64) + merkle_root (32)
  const transferData = Buffer.concat([
    transferDiscriminator,        // 8 bytes
    proofA,                       // 64 bytes
    proofB,                       // 128 bytes
    proofC,                       // 64 bytes
    nullifierHash1Bytes,          // 32 bytes
    nullifierHash2Bytes,          // 32 bytes
    outCommitment1Bytes,          // 32 bytes
    outCommitment2Bytes,          // 32 bytes
    merkleRootBytes,              // 32 bytes
  ]);

  console.log("Instruction data length:", transferData.length, "bytes");

  const transferIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: merkleTreePda, isSigner: false, isWritable: true },
      { pubkey: nullifiersPda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
    ],
    programId: POOL_PROGRAM_ID,
    data: transferData,
  });

  try {
    const transferTx = new Transaction().add(transferIx);
    const transferTxSig = await sendAndConfirmTransaction(connection, transferTx, [walletKeypair], {
      commitment: "confirmed",
    });
    
    console.log("\n✅ PRIVATE TRANSFER SUCCESS!");
    console.log("TX:", transferTxSig);
    console.log("Solscan: https://solscan.io/tx/" + transferTxSig + "?cluster=devnet");

    // Verify new notes were added
    const poolFinal = await connection.getAccountInfo(poolPda);
    const newLeafIndex = Number(poolFinal!.data.readBigUInt64LE(9));
    console.log("\nNew leaf index:", newLeafIndex, "(output commitments added)");

    // ========================================
    // OUTPUT NOTES FOR FUTURE USE
    // ========================================
    console.log("\n" + "=".repeat(70));
    console.log("OUTPUT NOTES SAVED FOR FUTURE USE");
    console.log("=".repeat(70));
    console.log("\nMerged Note:");
    console.log("  Secret:", outNote1.secret.toString().slice(0, 20) + "...");
    console.log("  Nullifier:", outNote1.nullifier.toString().slice(0, 20) + "...");
    console.log("  Amount:", Number(outNote1.amount) / LAMPORTS_PER_SOL, "SOL");
    console.log("  Commitment:", outNote1.commitment.toString().slice(0, 20) + "...");
    console.log("  Can be withdrawn with withdraw_merkle circuit");

  } catch (error: any) {
    console.log("\n❌ Private transfer failed:", error.message);
    if (error.logs) {
      console.log("\nProgram Logs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
  }

  // ========================================
  // SUMMARY
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("TEST SUMMARY");
  console.log("=".repeat(70));
  
  console.log("\nProgram:", POOL_PROGRAM_ID.toBase58());
  console.log("Input: 2 notes of 0.01 SOL each");
  console.log("Output: 1 merged note of 0.02 SOL");
  console.log("\nPrivate transfers enable:");
  console.log("  - Split: 1 → 2 notes");
  console.log("  - Merge: 2 → 1 note");
  console.log("  - Transfer: Move value to new commitment");
  console.log("  - All without revealing amounts!");
}

main().catch(console.error);
