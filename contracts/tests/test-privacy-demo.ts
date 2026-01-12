import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as crypto from "crypto";

// Program IDs
const POOL_PROGRAM_ID = new PublicKey("8A6rYQ7Kf7aqg8JkU7z6W83wCZvmohND7wiXPBhkpowx");

async function main() {
  // Setup connection
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  
  // Load wallet
  const walletPath = "../keys/deploy-wallet.json";
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(require("fs").readFileSync(walletPath, "utf-8")))
  );
  
  console.log("=".repeat(60));
  console.log("WHISTLE PROTOCOL - PRIVACY TEST");
  console.log("=".repeat(60));
  console.log(`Wallet: ${walletKeypair.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
  const [merkleTreePda] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree")], POOL_PROGRAM_ID);
  const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
  const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);
  
  console.log("\n--- PDAs ---");
  console.log(`Pool: ${poolPda.toBase58()}`);
  console.log(`Vault: ${vaultPda.toBase58()}`);
  console.log(`Merkle Tree: ${merkleTreePda.toBase58()}`);
  console.log(`Roots History: ${rootsHistoryPda.toBase58()}`);
  console.log(`Nullifiers: ${nullifiersPda.toBase58()}`);
  
  // Check if pool is initialized
  const poolAccount = await connection.getAccountInfo(poolPda);
  
  if (!poolAccount) {
    console.log("\n--- STEP 1: Initialize Pool ---");
    
    const initIx = createInitializeInstruction(
      walletKeypair.publicKey,
      poolPda,
      merkleTreePda,
      rootsHistoryPda,
      nullifiersPda,
      vaultPda,
      16 // merkle levels
    );
    
    const initTx = new anchor.web3.Transaction().add(initIx);
    initTx.feePayer = walletKeypair.publicKey;
    initTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    initTx.sign(walletKeypair);
    
    try {
      const initSig = await connection.sendRawTransaction(initTx.serialize());
      await connection.confirmTransaction(initSig, "confirmed");
      console.log(`✓ Pool initialized!`);
      console.log(`  TX: https://solscan.io/tx/${initSig}?cluster=devnet`);
    } catch (e: any) {
      console.log(`Pool init error (may already exist): ${e.message}`);
    }
  } else {
    console.log("\n✓ Pool already initialized");
  }
  
  // Generate commitment for deposit
  console.log("\n--- STEP 2: Generate Private Note ---");
  const secret = crypto.randomBytes(32);
  const nullifier = crypto.randomBytes(32);
  
  // Commitment = hash(secret || nullifier)
  const commitmentPreimage = Buffer.concat([secret, nullifier]);
  const commitment = crypto.createHash("sha256").update(commitmentPreimage).digest();
  
  console.log(`Secret (KEEP PRIVATE): ${secret.toString("hex").substring(0, 16)}...`);
  console.log(`Nullifier: ${nullifier.toString("hex").substring(0, 16)}...`);
  console.log(`Commitment: ${commitment.toString("hex").substring(0, 32)}...`);
  
  // Deposit
  console.log("\n--- STEP 3: Deposit 1 SOL ---");
  const depositAmount = 1 * LAMPORTS_PER_SOL;
  
  const depositIx = createDepositInstruction(
    walletKeypair.publicKey,
    poolPda,
    merkleTreePda,
    rootsHistoryPda,
    vaultPda,
    Array.from(commitment),
    depositAmount
  );
  
  const depositTx = new anchor.web3.Transaction().add(depositIx);
  depositTx.feePayer = walletKeypair.publicKey;
  depositTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  depositTx.sign(walletKeypair);
  
  try {
    const depositSig = await connection.sendRawTransaction(depositTx.serialize());
    await connection.confirmTransaction(depositSig, "confirmed");
    console.log(`✓ Deposited 1 SOL with commitment!`);
    console.log(`  TX: https://solscan.io/tx/${depositSig}?cluster=devnet`);
    
    // Get transaction details
    const txDetails = await connection.getTransaction(depositSig, { commitment: "confirmed" });
    if (txDetails) {
      console.log(`  Slot: ${txDetails.slot}`);
      console.log(`  Fee: ${txDetails.meta?.fee} lamports`);
    }
  } catch (e: any) {
    console.log(`Deposit error: ${e.message}`);
    if (e.logs) {
      console.log("Logs:", e.logs.slice(-5));
    }
  }
  
  // Check vault balance
  const vaultBalance = await connection.getBalance(vaultPda);
  console.log(`\nVault balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL`);
  
  // Generate withdrawal proof (dummy for demo - real proof would come from snarkjs)
  console.log("\n--- STEP 4: Generate ZK Withdrawal Proof ---");
  const nullifierHash = crypto.createHash("sha256").update(nullifier).digest();
  console.log(`Nullifier Hash: ${nullifierHash.toString("hex").substring(0, 32)}...`);
  
  // In production, this proof would be generated by snarkjs
  // For demo, we create placeholder proof bytes
  const proofA = new Uint8Array(64).fill(1);
  const proofB = new Uint8Array(128).fill(2);
  const proofC = new Uint8Array(64).fill(3);
  
  console.log("✓ ZK proof generated (placeholder for demo)");
  console.log("  Proof A (G1): 64 bytes");
  console.log("  Proof B (G2): 128 bytes");
  console.log("  Proof C (G1): 64 bytes");
  
  // Attempt withdrawal (will validate proof on-chain)
  console.log("\n--- STEP 5: Attempt Anonymous Withdrawal ---");
  const recipientKeypair = Keypair.generate();
  console.log(`New anonymous recipient: ${recipientKeypair.publicKey.toBase58()}`);
  
  // Get current merkle root from pool
  const poolInfo = await connection.getAccountInfo(poolPda);
  let merkleRoot = new Uint8Array(32);
  if (poolInfo) {
    // Pool structure: merkle_levels(1) + next_index(8) + current_root(32) + ...
    merkleRoot = new Uint8Array(poolInfo.data.slice(8 + 1 + 8, 8 + 1 + 8 + 32));
    console.log(`Current Merkle Root: ${Buffer.from(merkleRoot).toString("hex").substring(0, 32)}...`);
  }
  
  const withdrawIx = createWithdrawInstruction(
    poolPda,
    nullifiersPda,
    rootsHistoryPda,
    vaultPda,
    recipientKeypair.publicKey,
    walletKeypair.publicKey, // relayer
    Array.from(proofA),
    Array.from(proofB),
    Array.from(proofC),
    Array.from(nullifierHash),
    Array.from(merkleRoot),
    depositAmount,
    0 // no relayer fee
  );
  
  const withdrawTx = new anchor.web3.Transaction().add(withdrawIx);
  withdrawTx.feePayer = walletKeypair.publicKey;
  withdrawTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  withdrawTx.sign(walletKeypair);
  
  try {
    const withdrawSig = await connection.sendRawTransaction(withdrawTx.serialize());
    await connection.confirmTransaction(withdrawSig, "confirmed");
    console.log(`✓ Withdrawal successful!`);
    console.log(`  TX: https://solscan.io/tx/${withdrawSig}?cluster=devnet`);
  } catch (e: any) {
    console.log(`Withdrawal error (expected - proof validation): ${e.message?.substring(0, 100)}`);
    // This is expected to fail because we're using placeholder proofs
    // Real proofs would be verified by the Groth16 verifier
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("TEST COMPLETE");
  console.log("=".repeat(60));
  
  // Final balances
  const finalBalance = await connection.getBalance(walletKeypair.publicKey);
  const finalVaultBalance = await connection.getBalance(vaultPda);
  console.log(`\nWallet balance: ${finalBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`Vault balance: ${finalVaultBalance / LAMPORTS_PER_SOL} SOL`);
}

// Instruction builders
function createInitializeInstruction(
  payer: PublicKey,
  pool: PublicKey,
  merkleTree: PublicKey,
  rootsHistory: PublicKey,
  nullifiers: PublicKey,
  vault: PublicKey,
  merkleLevels: number
) {
  // Anchor discriminator for "initialize"
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  const data = Buffer.concat([discriminator, Buffer.from([merkleLevels])]);
  
  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: merkleTree, isSigner: false, isWritable: true },
      { pubkey: rootsHistory, isSigner: false, isWritable: true },
      { pubkey: nullifiers, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data,
  });
}

function createDepositInstruction(
  depositor: PublicKey,
  pool: PublicKey,
  merkleTree: PublicKey,
  rootsHistory: PublicKey,
  vault: PublicKey,
  commitment: number[],
  amount: number
) {
  // Anchor discriminator for "deposit"
  const discriminator = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]);
  const commitmentBuf = Buffer.from(commitment);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(BigInt(amount));
  const data = Buffer.concat([discriminator, commitmentBuf, amountBuf]);
  
  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: merkleTree, isSigner: false, isWritable: true },
      { pubkey: rootsHistory, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data,
  });
}

function createWithdrawInstruction(
  pool: PublicKey,
  nullifiers: PublicKey,
  rootsHistory: PublicKey,
  vault: PublicKey,
  recipient: PublicKey,
  relayer: PublicKey,
  proofA: number[],
  proofB: number[],
  proofC: number[],
  nullifierHash: number[],
  merkleRoot: number[],
  amount: number,
  relayerFee: number
) {
  // Anchor discriminator for "withdraw"
  const discriminator = Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]);
  
  const proofABuf = Buffer.from(proofA);
  const proofBBuf = Buffer.from(proofB);
  const proofCBuf = Buffer.from(proofC);
  const nullifierHashBuf = Buffer.from(nullifierHash);
  const recipientBuf = recipient.toBuffer();
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(BigInt(amount));
  const relayerFeeBuf = Buffer.alloc(8);
  relayerFeeBuf.writeBigUInt64LE(BigInt(relayerFee));
  const merkleRootBuf = Buffer.from(merkleRoot);
  
  const data = Buffer.concat([
    discriminator,
    proofABuf,
    proofBBuf,
    proofCBuf,
    nullifierHashBuf,
    recipientBuf,
    amountBuf,
    relayerFeeBuf,
    merkleRootBuf,
  ]);
  
  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: nullifiers, isSigner: false, isWritable: true },
      { pubkey: rootsHistory, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: relayer, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data,
  });
}

main().catch(console.error);

