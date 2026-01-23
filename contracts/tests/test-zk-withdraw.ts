/**
 * WHISTLE PROTOCOL - FULL ZK WITHDRAWAL TEST
 * 
 * This test demonstrates:
 * 1. Creating a note with Poseidon commitment
 * 2. Depositing to the privacy pool
 * 3. Generating a valid ZK proof
 * 4. Withdrawing with the proof
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
// Scalar field (Fr) for circuit inputs
const FIELD_PRIME = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
// Base field (Fq) for curve points
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

// Convert G1 point to 64 bytes
function g1ToBytes(point: string[]): Buffer {
  const x = bigintToBytes32(BigInt(point[0]));
  const y = bigintToBytes32(BigInt(point[1]));
  return Buffer.concat([x, y]);
}

// Convert G1 point to 64 bytes with negated y (required by groth16-solana)
function g1ToBytesNegated(point: string[]): Buffer {
  const x = BigInt(point[0]);
  const y = BigInt(point[1]) % BN254_BASE_FIELD;
  const yNeg = y === 0n ? 0n : BN254_BASE_FIELD - y;
  const xBytes = bigintToBytes32(x);
  const yBytes = bigintToBytes32(yNeg);
  return Buffer.concat([xBytes, yBytes]);
}

// Convert G2 point to 128 bytes (swapped for Solana)
function g2ToBytesSwapped(point: string[][]): Buffer {
  const x0 = bigintToBytes32(BigInt(point[0][0]));
  const x1 = bigintToBytes32(BigInt(point[0][1]));
  const y0 = bigintToBytes32(BigInt(point[1][0]));
  const y1 = bigintToBytes32(BigInt(point[1][1]));
  return Buffer.concat([x1, x0, y1, y0]);
}

// Convert G2 point to 128 bytes (unswapped)
function g2ToBytesUnswapped(point: string[][]): Buffer {
  const x0 = bigintToBytes32(BigInt(point[0][0]));
  const x1 = bigintToBytes32(BigInt(point[0][1]));
  const y0 = bigintToBytes32(BigInt(point[1][0]));
  const y1 = bigintToBytes32(BigInt(point[1][1]));
  return Buffer.concat([x0, x1, y0, y1]);
}

async function main() {
  console.log("=".repeat(70));
  console.log("WHISTLE PROTOCOL - FULL ZK WITHDRAWAL TEST");
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

  // ========================================
  // STEP 0: INITIALIZE POOL (if needed)
  // ========================================
  const poolAccountBeforeInit = await connection.getAccountInfo(poolPda);
  if (!poolAccountBeforeInit) {
    console.log("\nInitializing pool (4-step split initialization)...");

    const initPoolDiscriminator = getDiscriminator("initialize");
    const merkleLevels = 7;
    const initPoolData = Buffer.concat([initPoolDiscriminator, Buffer.from([merkleLevels])]);

    const initPoolIx = new TransactionInstruction({
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: POOL_PROGRAM_ID,
      data: initPoolData,
    });

    await sendAndConfirmTransaction(connection, new Transaction().add(initPoolIx), [walletKeypair]);

    const initMerkleDiscriminator = getDiscriminator("init_merkle");
    const initMerkleIx = new TransactionInstruction({
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: false },
        { pubkey: merkleTreePda, isSigner: false, isWritable: true },
        { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: POOL_PROGRAM_ID,
      data: initMerkleDiscriminator,
    });
    await sendAndConfirmTransaction(connection, new Transaction().add(initMerkleIx), [walletKeypair]);

    const initRootsDiscriminator = getDiscriminator("init_roots");
    const initRootsIx = new TransactionInstruction({
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: false },
        { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
        { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: POOL_PROGRAM_ID,
      data: initRootsDiscriminator,
    });
    await sendAndConfirmTransaction(connection, new Transaction().add(initRootsIx), [walletKeypair]);

    const initNullifiersDiscriminator = getDiscriminator("init_nullifiers");
    const initNullifiersIx = new TransactionInstruction({
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: false },
        { pubkey: nullifiersPda, isSigner: false, isWritable: true },
        { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: POOL_PROGRAM_ID,
      data: initNullifiersDiscriminator,
    });
    await sendAndConfirmTransaction(connection, new Transaction().add(initNullifiersIx), [walletKeypair]);
  }

  // ========================================
  // STEP 1: CREATE NOTE WITH POSEIDON COMMITMENT
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 1: CREATE NOTE WITH POSEIDON COMMITMENT");
  console.log("=".repeat(70));

  // Generate random secret and nullifier
  const crypto = require("crypto");
  const secretBytes = crypto.randomBytes(31);
  const nullifierBytes = crypto.randomBytes(31);
  
  const secret = BigInt('0x' + secretBytes.toString('hex')) % FIELD_PRIME;
  const nullifier = BigInt('0x' + nullifierBytes.toString('hex')) % FIELD_PRIME;
  
  // Amount in lamports (0.01 SOL = 10,000,000 lamports)
  const noteAmount = BigInt(0.01 * LAMPORTS_PER_SOL);
  
  // Compute commitment = Poseidon(secret, Poseidon(nullifier, noteAmount))
  const innerHashResult = poseidon([F.e(nullifier.toString()), F.e(noteAmount.toString())]);
  const innerHash = BigInt(F.toString(innerHashResult));
  
  const commitmentResult = poseidon([F.e(secret.toString()), F.e(innerHash.toString())]);
  const commitment = BigInt(F.toString(commitmentResult));
  
  // Compute nullifier hash = Poseidon(nullifier, 0)
  const nullifierHashResult = poseidon([F.e(nullifier.toString()), F.e("0")]);
  const nullifierHash = BigInt(F.toString(nullifierHashResult));

  console.log("Secret:", secret.toString().slice(0, 20) + "...");
  console.log("Nullifier:", nullifier.toString().slice(0, 20) + "...");
  console.log("Note Amount:", Number(noteAmount) / LAMPORTS_PER_SOL, "SOL");
  console.log("Commitment:", commitment.toString().slice(0, 20) + "...");
  console.log("Nullifier Hash:", nullifierHash.toString().slice(0, 20) + "...");

  // ========================================
  // STEP 2: DEPOSIT (SHIELD) THE NOTE
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 2: DEPOSIT (SHIELD) THE NOTE");
  console.log("=".repeat(70));

  // Convert commitment to 32-byte buffer
  const commitmentBytes = bigintToBytes32(commitment);
  
  // Read pool state before deposit to get leaf index
  const poolBefore = await connection.getAccountInfo(poolPda);
  if (!poolBefore) {
    console.log("ERROR: Pool not found after init");
    return;
  }
  const poolDataBefore = poolBefore.data;
  const leafIndex = Number(poolDataBefore.readBigUInt64LE(9));

  const shieldDiscriminator = getDiscriminator("shield");
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(noteAmount);
  
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
    console.log("\n✅ DEPOSIT SUCCESS!");
    console.log("TX:", depositTxSig);
    console.log("Solscan: https://solscan.io/tx/" + depositTxSig + "?cluster=devnet");
  } catch (error: any) {
    console.log("Deposit Error:", error.message);
    if (error.logs) {
      error.logs.forEach((log: string) => console.log("  ", log));
    }
    return;
  }

  // Wait for confirmation
  await new Promise(resolve => setTimeout(resolve, 2000));

  // ========================================
  // STEP 3: GENERATE ZK PROOF
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 3: GENERATE ZK PROOF");
  console.log("=".repeat(70));

  // Withdrawal parameters
  const withdrawAmount = noteAmount; // Full withdrawal
  const relayerFee = BigInt(0);
  const recipientPubkey = walletKeypair.publicKey;
  
  // Match the contract's recipient field computation:
  // Takes first 31 bytes of pubkey and puts them in bytes 1-31 of 32-byte array
  const recipientPubkeyBytes = recipientPubkey.toBuffer();
  const recipientFieldBuf = Buffer.alloc(32);
  recipientFieldBuf[0] = 0;
  recipientPubkeyBytes.copy(recipientFieldBuf, 1, 0, 31);
  const recipientBigint = BigInt('0x' + recipientFieldBuf.toString('hex'));

  console.log("Withdraw Amount:", Number(withdrawAmount) / LAMPORTS_PER_SOL, "SOL");
  console.log("Relayer Fee:", Number(relayerFee) / LAMPORTS_PER_SOL, "SOL");
  console.log("Recipient:", recipientPubkey.toBase58());

  // Read pool + merkle tree to build Merkle proof
  const poolAfter = await connection.getAccountInfo(poolPda);
  const merkleTreeAccount = await connection.getAccountInfo(merkleTreePda);
  if (!poolAfter || !merkleTreeAccount) {
    console.log("ERROR: Pool or merkle tree missing");
    return;
  }

  const poolDataAfter = poolAfter.data;
  const merkleLevels = poolDataAfter.readUInt8(8);
  const merkleRootBytes = poolDataAfter.slice(17, 49);
  const merkleRootField = bytesToBigintBE(merkleRootBytes);

  const merkleData = merkleTreeAccount.data;
  const nodesOffset = 16; // 8 discriminator + 1 levels + 7 padding
  const nodeSize = 32;
  const totalNodes = 255;

  function readNode(index: number): Buffer {
    if (index < 0 || index >= totalNodes) {
      return Buffer.alloc(32);
    }
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

  // Prepare circuit inputs
  const circuitInput = {
    // Public inputs
    merkleRoot: merkleRootField.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipientBigint.toString(),
    amount: withdrawAmount.toString(),
    relayerFee: relayerFee.toString(),
    // Private inputs
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    noteAmount: noteAmount.toString(),
    pathElements: pathElements.map(e => e.toString()),
    pathIndices: pathIndices.map(i => i.toString()),
  };

  console.log("\nGenerating ZK proof (this may take a moment)...");

  // Circuit paths
  const circuitDir = path.join(__dirname, "../../circuits/build/production");
  const wasmPath = path.join(circuitDir, "withdraw_merkle/withdraw_merkle_js/withdraw_merkle.wasm");
  const zkeyPath = path.join(circuitDir, "withdraw_merkle/withdraw_merkle_final.zkey");

  // Check if circuit files exist
  if (!fs.existsSync(wasmPath)) {
    console.log("ERROR: WASM file not found at:", wasmPath);
    console.log("Please compile the circuit first.");
    return;
  }
  if (!fs.existsSync(zkeyPath)) {
    console.log("ERROR: zkey file not found at:", zkeyPath);
    console.log("Please run trusted setup first.");
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
  const proofB_swapped = g2ToBytesSwapped(proof.pi_b);
  const proofB_unswapped = g2ToBytesUnswapped(proof.pi_b);
  const proofC = g1ToBytes(proof.pi_c);

  console.log("\nProof A (64 bytes):", proofA.toString('hex').slice(0, 40) + "...");
  console.log("Proof B swapped (128 bytes):", proofB_swapped.toString('hex').slice(0, 40) + "...");
  console.log("Proof B unswapped (128 bytes):", proofB_unswapped.toString('hex').slice(0, 40) + "...");
  console.log("Proof C (64 bytes):", proofC.toString('hex').slice(0, 40) + "...");

  // ========================================
  // STEP 4: WITHDRAW WITH ZK PROOF
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 4: WITHDRAW WITH ZK PROOF");
  console.log("=".repeat(70));

  // Get vault balance before
  const vaultBalanceBefore = await connection.getBalance(vaultPda);
  console.log("Vault balance before:", vaultBalanceBefore / LAMPORTS_PER_SOL, "SOL");

  // Use current Merkle root from Step 3
  const merkleRoot = merkleRootBytes;
  console.log("Current Merkle Root:", merkleRoot.toString('hex'));

  // Build withdraw instruction (withdraw_merkle circuit)
  const withdrawDiscriminator = getDiscriminator("withdraw");
  
  const withdrawAmountBuf = Buffer.alloc(8);
  withdrawAmountBuf.writeBigUInt64LE(withdrawAmount);
  
  const relayerFeeBuf = Buffer.alloc(8);
  relayerFeeBuf.writeBigUInt64LE(relayerFee);
  
  const nullifierHashBytes = bigintToBytes32(nullifierHash);

  // Recipient pubkey as bytes
  const recipientBytes = walletKeypair.publicKey.toBuffer();

  async function tryWithdraw(proofB: Buffer, label: string): Promise<{ success: boolean; retryable: boolean }> {
    // Instruction data layout for withdraw:
    // discriminator (8) + proof_a (64) + proof_b (128) + proof_c (64) +
    // nullifier_hash (32) + recipient (32) + amount (8) + relayer_fee (8) + merkle_root (32)
    const withdrawData = Buffer.concat([
      withdrawDiscriminator,  // 8 bytes
      proofA,                 // 64 bytes
      proofB,                 // 128 bytes
      proofC,                 // 64 bytes
      nullifierHashBytes,     // 32 bytes
      recipientBytes,         // 32 bytes
      withdrawAmountBuf,      // 8 bytes
      relayerFeeBuf,          // 8 bytes
      merkleRoot,             // 32 bytes
    ]);

    console.log(`\nAttempt withdraw (${label}) - data length:`, withdrawData.length, "bytes");

    const withdrawIx = new TransactionInstruction({
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: true },              // 1. pool
        { pubkey: merkleTreePda, isSigner: false, isWritable: true },        // 2. merkle_tree
        { pubkey: nullifiersPda, isSigner: false, isWritable: true },        // 3. nullifiers
        { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },      // 4. roots_history
        { pubkey: vaultPda, isSigner: false, isWritable: true },             // 5. pool_vault
        { pubkey: walletKeypair.publicKey, isSigner: false, isWritable: true }, // 6. recipient
        { pubkey: walletKeypair.publicKey, isSigner: false, isWritable: true }, // 7. relayer
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 8. system_program
      ],
      programId: POOL_PROGRAM_ID,
      data: withdrawData,
    });

    try {
      const withdrawTx = new Transaction().add(withdrawIx);
      const withdrawTxSig = await sendAndConfirmTransaction(connection, withdrawTx, [walletKeypair], {
        commitment: "confirmed",
      });
      
      console.log(`\n✅ WITHDRAWAL SUCCESS (${label})!`);
      console.log("TX:", withdrawTxSig);
      console.log("Solscan: https://solscan.io/tx/" + withdrawTxSig + "?cluster=devnet");
      
      // Check vault balance after
      const vaultBalanceAfter = await connection.getBalance(vaultPda);
      console.log("\nVault balance after:", vaultBalanceAfter / LAMPORTS_PER_SOL, "SOL");
      console.log("Withdrawn:", (vaultBalanceBefore - vaultBalanceAfter) / LAMPORTS_PER_SOL, "SOL");
      
      return { success: true, retryable: false };
    } catch (error: any) {
      console.log(`\n❌ Withdrawal failed (${label}):`, error.message);
      if (error.logs) {
        console.log("\nProgram Logs:");
        error.logs.forEach((log: string) => console.log("  ", log));
      }
      const logsText = (error.logs || []).join(" ");
      const retryable = logsText.includes("InvalidProof") || logsText.includes("ProofVerificationFailed");
      return { success: false, retryable };
    }
  }

  // Try swapped proof_b first (expected by groth16-solana)
  const swappedResult = await tryWithdraw(proofB_swapped, "swapped");
  if (!swappedResult.success && swappedResult.retryable) {
    // Try unswapped proof_b if proof verification failed
    await tryWithdraw(proofB_unswapped, "unswapped");
  }

  // ========================================
  // SUMMARY
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("TEST SUMMARY");
  console.log("=".repeat(70));
  
  console.log("\nProgram: https://solscan.io/account/" + POOL_PROGRAM_ID.toBase58() + "?cluster=devnet");
  console.log("Vault: https://solscan.io/account/" + vaultPda.toBase58() + "?cluster=devnet");
  
  if (depositTxSig) {
    console.log("\nDeposit TX: https://solscan.io/tx/" + depositTxSig + "?cluster=devnet");
  }
}

main().catch(console.error);
