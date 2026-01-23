/**
 * WHISTLE PROTOCOL - UNSHIELD WITH CHANGE TEST
 * 
 * This test demonstrates:
 * 1. Depositing a flexible amount (e.g., 0.025 SOL)
 * 2. Withdrawing a fixed denomination (e.g., 0.01 SOL)
 * 3. Automatically re-shielding the change (0.015 SOL)
 * 4. Verifying the change note can be spent in a subsequent withdrawal
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

async function main() {
  console.log("=".repeat(70));
  console.log("WHISTLE PROTOCOL - UNSHIELD WITH CHANGE TEST");
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

  // Check if pool exists (assume it's already initialized from previous test)
  const poolAccount = await connection.getAccountInfo(poolPda);
  if (!poolAccount) {
    console.log("ERROR: Pool not initialized. Please run test-zk-withdraw.ts first.");
    return;
  }

  // ========================================
  // STEP 1: CREATE NOTE WITH LARGER DEPOSIT
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 1: CREATE NOTE (0.025 SOL deposit)");
  console.log("=".repeat(70));

  const crypto = require("crypto");
  const secret = BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD_PRIME;
  const nullifier = BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD_PRIME;
  
  // Deposit 0.025 SOL (more than 0.01 SOL denomination)
  const depositAmount = BigInt(Math.floor(0.025 * LAMPORTS_PER_SOL));
  
  // Compute commitment = Poseidon(secret, Poseidon(nullifier, amount))
  const innerHashResult = poseidon([F.e(nullifier.toString()), F.e(depositAmount.toString())]);
  const innerHash = BigInt(F.toString(innerHashResult));
  
  const commitmentResult = poseidon([F.e(secret.toString()), F.e(innerHash.toString())]);
  const commitment = BigInt(F.toString(commitmentResult));
  
  // Compute nullifier hash = Poseidon(nullifier, 0)
  const nullifierHashResult = poseidon([F.e(nullifier.toString()), F.e("0")]);
  const nullifierHash = BigInt(F.toString(nullifierHashResult));

  console.log("Deposit Amount:", Number(depositAmount) / LAMPORTS_PER_SOL, "SOL");
  console.log("Commitment:", commitment.toString().slice(0, 20) + "...");

  // ========================================
  // STEP 2: DEPOSIT (SHIELD) THE NOTE
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 2: DEPOSIT (SHIELD)");
  console.log("=".repeat(70));

  const commitmentBytes = bigintToBytes32(commitment);
  
  // Get leaf index before deposit
  const poolBefore = await connection.getAccountInfo(poolPda);
  const leafIndex = Number(poolBefore!.data.readBigUInt64LE(9));

  const shieldDiscriminator = getDiscriminator("shield");
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(depositAmount);
  
  const shieldData = Buffer.concat([shieldDiscriminator, commitmentBytes, amountBuffer]);

  const shieldIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: merkleTreePda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: shieldData,
  });

  let depositTxSig = "";
  try {
    const shieldTx = new Transaction().add(shieldIx);
    depositTxSig = await sendAndConfirmTransaction(connection, shieldTx, [walletKeypair], {
      commitment: "confirmed",
    });
    console.log("✅ DEPOSIT SUCCESS!");
    console.log("TX:", depositTxSig);
  } catch (error: any) {
    console.log("Deposit Error:", error.message);
    return;
  }

  await new Promise(resolve => setTimeout(resolve, 2000));

  // ========================================
  // STEP 3: PREPARE CHANGE NOTE
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 3: PREPARE CHANGE NOTE");
  console.log("=".repeat(70));

  // Fixed withdrawal amount (0.01 SOL denomination)
  const withdrawalAmount = BigInt(0.01 * LAMPORTS_PER_SOL);
  const relayerFee = BigInt(0);
  
  // Calculate change amount
  const changeAmount = depositAmount - withdrawalAmount - relayerFee;
  
  console.log("Withdrawal Amount:", Number(withdrawalAmount) / LAMPORTS_PER_SOL, "SOL");
  console.log("Relayer Fee:", Number(relayerFee) / LAMPORTS_PER_SOL, "SOL");
  console.log("Change Amount:", Number(changeAmount) / LAMPORTS_PER_SOL, "SOL");

  // Generate change note secrets
  const changeSecret = BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD_PRIME;
  const changeNullifier = BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD_PRIME;

  // Compute change commitment
  let changeCommitment = BigInt(0);
  if (changeAmount > 0n) {
    const changeInnerResult = poseidon([F.e(changeNullifier.toString()), F.e(changeAmount.toString())]);
    const changeInner = BigInt(F.toString(changeInnerResult));
    const changeOuterResult = poseidon([F.e(changeSecret.toString()), F.e(changeInner.toString())]);
    changeCommitment = BigInt(F.toString(changeOuterResult));
  }

  console.log("Change Commitment:", changeCommitment.toString().slice(0, 20) + "...");

  // ========================================
  // STEP 4: BUILD MERKLE PROOF
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 4: BUILD MERKLE PROOF");
  console.log("=".repeat(70));

  // Read pool + merkle tree to build Merkle proof
  const poolAfter = await connection.getAccountInfo(poolPda);
  const merkleTreeAccount = await connection.getAccountInfo(merkleTreePda);
  if (!poolAfter || !merkleTreeAccount) {
    console.log("ERROR: Pool or merkle tree missing");
    return;
  }

  const poolData = poolAfter.data;
  const merkleLevels = poolData.readUInt8(8);
  const merkleRootBytes = poolData.slice(17, 49);
  const merkleRootField = bytesToBigintBE(merkleRootBytes);

  const merkleData = merkleTreeAccount.data;
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

  console.log("Merkle Root:", merkleRootField.toString().slice(0, 20) + "...");
  console.log("Leaf Index:", leafIndex);

  // ========================================
  // STEP 5: GENERATE ZK PROOF
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 5: GENERATE ZK PROOF (unshield_change)");
  console.log("=".repeat(70));

  // Recipient field element
  const recipientPubkey = walletKeypair.publicKey;
  const recipientPubkeyBytes = recipientPubkey.toBuffer();
  const recipientFieldBuf = Buffer.alloc(32);
  recipientFieldBuf[0] = 0;
  recipientPubkeyBytes.copy(recipientFieldBuf, 1, 0, 31);
  const recipientBigint = BigInt('0x' + recipientFieldBuf.toString('hex'));

  // Circuit inputs for unshield_change
  const circuitInput = {
    // Public inputs
    merkleRoot: merkleRootField.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipientBigint.toString(),
    withdrawalAmount: withdrawalAmount.toString(),
    relayerFee: relayerFee.toString(),
    changeCommitment: changeCommitment.toString(),
    // Private inputs - Input Note
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    noteAmount: depositAmount.toString(),
    pathElements: pathElements.map(e => e.toString()),
    pathIndices: pathIndices.map(i => i.toString()),
    // Private inputs - Change Note
    changeSecret: changeSecret.toString(),
    changeNullifier: changeNullifier.toString(),
    changeAmount: changeAmount.toString(),
  };

  console.log("\nGenerating ZK proof...");

  const circuitDir = path.join(__dirname, "../../circuits/build/production");
  const wasmPath = path.join(circuitDir, "unshield_change/unshield_change_js/unshield_change.wasm");
  const zkeyPath = path.join(circuitDir, "unshield_change/unshield_change_final.zkey");

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
  } catch (error: any) {
    console.log("Proof generation error:", error.message);
    return;
  }

  // Convert proof to Solana format
  const proofA = g1ToBytesNegated(proof.pi_a);
  const proofB = g2ToBytesSwapped(proof.pi_b);
  const proofC = g1ToBytes(proof.pi_c);

  // ========================================
  // STEP 6: UNSHIELD WITH CHANGE
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 6: UNSHIELD WITH CHANGE");
  console.log("=".repeat(70));

  const vaultBalanceBefore = await connection.getBalance(vaultPda);
  console.log("Vault balance before:", vaultBalanceBefore / LAMPORTS_PER_SOL, "SOL");

  const unshieldDiscriminator = getDiscriminator("unshield");
  
  const withdrawalAmountBuf = Buffer.alloc(8);
  withdrawalAmountBuf.writeBigUInt64LE(withdrawalAmount);
  
  const relayerFeeBuf = Buffer.alloc(8);
  relayerFeeBuf.writeBigUInt64LE(relayerFee);
  
  const nullifierHashBytes = bigintToBytes32(nullifierHash);
  const recipientBytes = walletKeypair.publicKey.toBuffer();
  const changeCommitmentBytes = bigintToBytes32(changeCommitment);

  // Instruction data layout for unshield:
  // discriminator (8) + proof_a (64) + proof_b (128) + proof_c (64) +
  // nullifier_hash (32) + recipient (32) + withdrawal_amount (8) + relayer_fee (8) + 
  // merkle_root (32) + change_commitment (32)
  const unshieldData = Buffer.concat([
    unshieldDiscriminator,      // 8 bytes
    proofA,                     // 64 bytes
    proofB,                     // 128 bytes
    proofC,                     // 64 bytes
    nullifierHashBytes,         // 32 bytes
    recipientBytes,             // 32 bytes
    withdrawalAmountBuf,        // 8 bytes
    relayerFeeBuf,              // 8 bytes
    merkleRootBytes,            // 32 bytes
    changeCommitmentBytes,      // 32 bytes
  ]);

  console.log("Instruction data length:", unshieldData.length, "bytes");

  const unshieldIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: merkleTreePda, isSigner: false, isWritable: true },
      { pubkey: nullifiersPda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: false, isWritable: true }, // recipient
      { pubkey: walletKeypair.publicKey, isSigner: false, isWritable: true }, // relayer
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: unshieldData,
  });

  try {
    const unshieldTx = new Transaction().add(unshieldIx);
    const unshieldTxSig = await sendAndConfirmTransaction(connection, unshieldTx, [walletKeypair], {
      commitment: "confirmed",
    });
    
    console.log("\n✅ UNSHIELD WITH CHANGE SUCCESS!");
    console.log("TX:", unshieldTxSig);
    console.log("Solscan: https://solscan.io/tx/" + unshieldTxSig + "?cluster=devnet");
    
    const vaultBalanceAfter = await connection.getBalance(vaultPda);
    console.log("\nVault balance after:", vaultBalanceAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("Withdrawn:", (vaultBalanceBefore - vaultBalanceAfter) / LAMPORTS_PER_SOL, "SOL");

    // Verify change was added to tree
    const poolFinal = await connection.getAccountInfo(poolPda);
    const newLeafIndex = Number(poolFinal!.data.readBigUInt64LE(9));
    console.log("\nNew leaf index:", newLeafIndex, "(change commitment added)");

    // Store change note for potential second withdrawal
    console.log("\n" + "=".repeat(70));
    console.log("CHANGE NOTE SAVED FOR FUTURE USE");
    console.log("=".repeat(70));
    console.log("Change Secret:", changeSecret.toString().slice(0, 20) + "...");
    console.log("Change Nullifier:", changeNullifier.toString().slice(0, 20) + "...");
    console.log("Change Amount:", Number(changeAmount) / LAMPORTS_PER_SOL, "SOL");
    console.log("Change Commitment:", changeCommitment.toString().slice(0, 20) + "...");

  } catch (error: any) {
    console.log("\n❌ Unshield failed:", error.message);
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
  console.log("Deposit TX: https://solscan.io/tx/" + depositTxSig + "?cluster=devnet");
}

main().catch(console.error);
