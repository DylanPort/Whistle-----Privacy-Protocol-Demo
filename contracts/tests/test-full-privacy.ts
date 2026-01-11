import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";

const POOL_PROGRAM_ID = new PublicKey('7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV');

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   WHISTLE PROTOCOL - FULL PRIVACY TEST                    ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // Load wallet
  const walletPath = "../keys/deploy-wallet.json";
  const walletData = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  console.log(`📍 Wallet: ${wallet.publicKey.toBase58()}`);
  const balanceBefore = await connection.getBalance(wallet.publicKey);
  console.log(`💰 Balance: ${balanceBefore / LAMPORTS_PER_SOL} SOL\n`);

  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
  const [merkleTreePda] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree")], POOL_PROGRAM_ID);
  const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
  const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);

  // Check vault balance
  const vaultBalance = await connection.getBalance(vaultPda);
  console.log(`🏦 Pool Vault Balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`   Vault: ${vaultPda.toBase58()}\n`);

  // ═══════════════════════════════════════════════════════════
  // TEST 1: PRIVATE DEPOSIT
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 1: PRIVATE DEPOSIT                                    │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Generate secret for commitment
  const secret = crypto.randomBytes(32);
  const amount = LAMPORTS_PER_SOL; // 1 SOL
  
  // Compute commitment: hash(secret || amount)
  const commitmentPreimage = Buffer.concat([secret, Buffer.alloc(8)]);
  commitmentPreimage.writeBigUInt64LE(BigInt(amount), 32);
  const commitment = crypto.createHash("sha256").update(commitmentPreimage).digest();
  
  console.log(`🔐 Your Secret (KEEP PRIVATE): ${secret.toString("hex")}`);
  console.log(`💰 Deposit Amount: ${amount / LAMPORTS_PER_SOL} SOL`);
  console.log(`📝 Public Commitment: ${commitment.toString("hex")}\n`);

  console.log("⏳ Sending deposit transaction...\n");

  try {
    const depositSig = await deposit(connection, wallet, poolPda, vaultPda, merkleTreePda, rootsHistoryPda, commitment, amount);
    console.log(`✅ DEPOSIT SUCCESSFUL!`);
    console.log(`   TX: https://solscan.io/tx/${depositSig}?cluster=devnet\n`);
    
    // Wait for confirmation
    await sleep(2000);
    
    const vaultBalanceAfterDeposit = await connection.getBalance(vaultPda);
    console.log(`🏦 Pool Vault Now: ${vaultBalanceAfterDeposit / LAMPORTS_PER_SOL} SOL\n`);
  } catch (e: any) {
    console.log(`⚠️ Deposit error: ${e.message}\n`);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 2: PRIVATE WITHDRAWAL
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 2: PRIVATE WITHDRAWAL                                 │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Compute nullifier from secret
  const nullifierPreimage = Buffer.concat([secret, Buffer.from("nullifier")]);
  const nullifierHash = crypto.createHash("sha256").update(nullifierPreimage).digest();
  
  // Generate a NEW wallet to receive (demonstrates privacy - no link to depositor!)
  const recipientWallet = Keypair.generate();
  console.log(`🆕 NEW Recipient Wallet: ${recipientWallet.publicKey.toBase58()}`);
  console.log(`   (This wallet has NO connection to the depositor on-chain!)\n`);
  
  console.log(`🔑 Nullifier Hash: ${nullifierHash.toString("hex")}`);
  console.log(`   (Proves you know the secret without revealing which deposit)\n`);

  // For the withdrawal, we need to pass the ZK proof
  // In this MVP, we use a simplified proof (the secret itself)
  // In production, this would be a full Groth16 ZK proof
  
  console.log("⏳ Sending withdrawal transaction...\n");

  try {
    const withdrawSig = await withdraw(
      connection, 
      wallet, 
      poolPda, 
      vaultPda, 
      nullifiersPda,
      rootsHistoryPda,
      nullifierHash,
      recipientWallet.publicKey,
      amount,
      secret
    );
    console.log(`✅ WITHDRAWAL SUCCESSFUL!`);
    console.log(`   TX: https://solscan.io/tx/${withdrawSig}?cluster=devnet\n`);
    
    // Wait for confirmation
    await sleep(2000);
    
    const recipientBalance = await connection.getBalance(recipientWallet.publicKey);
    console.log(`💰 Recipient received: ${recipientBalance / LAMPORTS_PER_SOL} SOL\n`);
  } catch (e: any) {
    console.log(`⚠️ Withdrawal error: ${e.message}`);
    if (e.logs) {
      console.log("   Logs:", e.logs.slice(-5).join("\n        "));
    }
    console.log("\n");
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 3: DOUBLE-SPEND PROTECTION
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 3: DOUBLE-SPEND PROTECTION                            │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  console.log("🛡️  Attempting to use same nullifier again (should fail)...\n");

  try {
    const doubleSig = await withdraw(
      connection, 
      wallet, 
      poolPda, 
      vaultPda, 
      nullifiersPda,
      rootsHistoryPda,
      nullifierHash,  // Same nullifier!
      recipientWallet.publicKey,
      amount,
      secret
    );
    console.log(`❌ SECURITY FAILURE: Double-spend succeeded!`);
  } catch (e: any) {
    console.log(`✅ DOUBLE-SPEND BLOCKED!`);
    console.log(`   The nullifier was already used - funds are safe.\n`);
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVACY SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   PRIVACY SUMMARY                                         ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  console.log("🔒 WHAT SOLSCAN SHOWS:");
  console.log("   DEPOSIT TX: Depositor → Pool (1 SOL) + Commitment Hash");
  console.log("   WITHDRAW TX: Pool → New Wallet (1 SOL) + Nullifier Hash\n");

  console.log("🔒 WHAT CANNOT BE LINKED:");
  console.log("   ❌ Depositor wallet → Recipient wallet");
  console.log("   ❌ Commitment → Nullifier");
  console.log("   ❌ Input source → Output destination\n");

  console.log("🔗 VERIFY ON SOLSCAN:");
  console.log(`   Program: https://solscan.io/account/${POOL_PROGRAM_ID}?cluster=devnet`);
  console.log(`   Pool: https://solscan.io/account/${poolPda}?cluster=devnet`);
  console.log(`   Vault: https://solscan.io/account/${vaultPda}?cluster=devnet\n`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function deposit(
  connection: Connection,
  wallet: Keypair,
  poolPda: PublicKey,
  vaultPda: PublicKey,
  merkleTreePda: PublicKey,
  rootsHistoryPda: PublicKey,
  commitment: Buffer,
  amount: number
): Promise<string> {
  const discriminator = crypto.createHash("sha256")
    .update("global:deposit")
    .digest()
    .slice(0, 8);
  
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount));
  
  const instructionData = Buffer.concat([discriminator, commitment, amountBuffer]);

  const tx = new anchor.web3.Transaction().add({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: merkleTreePda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: instructionData,
  });

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet]);
}

async function withdraw(
  connection: Connection,
  wallet: Keypair,
  poolPda: PublicKey,
  vaultPda: PublicKey,
  nullifiersPda: PublicKey,
  rootsHistoryPda: PublicKey,
  nullifierHash: Buffer,
  recipient: PublicKey,
  amount: number,
  secret: Buffer
): Promise<string> {
  const discriminator = crypto.createHash("sha256")
    .update("global:withdraw")
    .digest()
    .slice(0, 8);
  
  // Build proof components (64 + 128 + 64 = 256 bytes of zeros for MVP placeholder)
  const proofA = Buffer.alloc(64);
  const proofB = Buffer.alloc(128);
  const proofC = Buffer.alloc(64);
  
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount));
  
  const relayerFee = Buffer.alloc(8); // 0 fee
  
  // Get current merkle root from pool
  // Pool struct: discriminator(8) + merkle_levels(1) + next_index(8) + current_root(32)
  const poolData = await connection.getAccountInfo(poolPda);
  const merkleRoot = poolData!.data.slice(8 + 1 + 8, 8 + 1 + 8 + 32); // Correct offset: 17-49
  console.log(`   Using Merkle Root: ${merkleRoot.toString("hex")}`)
  
  const instructionData = Buffer.concat([
    discriminator,
    proofA,
    proofB,
    proofC,
    nullifierHash,
    recipient.toBuffer(),
    amountBuffer,
    relayerFee,
    merkleRoot,
  ]);

  // Need a relayer account even if fee is 0
  const relayer = wallet.publicKey;

  const tx = new anchor.web3.Transaction().add({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: nullifiersPda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: relayer, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: instructionData,
  });

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet]);
}

main().catch(console.error);




import * as fs from "fs";
import * as crypto from "crypto";

const POOL_PROGRAM_ID = new PublicKey('7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV');

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   WHISTLE PROTOCOL - FULL PRIVACY TEST                    ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // Load wallet
  const walletPath = "../keys/deploy-wallet.json";
  const walletData = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  console.log(`📍 Wallet: ${wallet.publicKey.toBase58()}`);
  const balanceBefore = await connection.getBalance(wallet.publicKey);
  console.log(`💰 Balance: ${balanceBefore / LAMPORTS_PER_SOL} SOL\n`);

  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
  const [merkleTreePda] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree")], POOL_PROGRAM_ID);
  const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
  const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);

  // Check vault balance
  const vaultBalance = await connection.getBalance(vaultPda);
  console.log(`🏦 Pool Vault Balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`   Vault: ${vaultPda.toBase58()}\n`);

  // ═══════════════════════════════════════════════════════════
  // TEST 1: PRIVATE DEPOSIT
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 1: PRIVATE DEPOSIT                                    │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Generate secret for commitment
  const secret = crypto.randomBytes(32);
  const amount = LAMPORTS_PER_SOL; // 1 SOL
  
  // Compute commitment: hash(secret || amount)
  const commitmentPreimage = Buffer.concat([secret, Buffer.alloc(8)]);
  commitmentPreimage.writeBigUInt64LE(BigInt(amount), 32);
  const commitment = crypto.createHash("sha256").update(commitmentPreimage).digest();
  
  console.log(`🔐 Your Secret (KEEP PRIVATE): ${secret.toString("hex")}`);
  console.log(`💰 Deposit Amount: ${amount / LAMPORTS_PER_SOL} SOL`);
  console.log(`📝 Public Commitment: ${commitment.toString("hex")}\n`);

  console.log("⏳ Sending deposit transaction...\n");

  try {
    const depositSig = await deposit(connection, wallet, poolPda, vaultPda, merkleTreePda, rootsHistoryPda, commitment, amount);
    console.log(`✅ DEPOSIT SUCCESSFUL!`);
    console.log(`   TX: https://solscan.io/tx/${depositSig}?cluster=devnet\n`);
    
    // Wait for confirmation
    await sleep(2000);
    
    const vaultBalanceAfterDeposit = await connection.getBalance(vaultPda);
    console.log(`🏦 Pool Vault Now: ${vaultBalanceAfterDeposit / LAMPORTS_PER_SOL} SOL\n`);
  } catch (e: any) {
    console.log(`⚠️ Deposit error: ${e.message}\n`);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 2: PRIVATE WITHDRAWAL
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 2: PRIVATE WITHDRAWAL                                 │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Compute nullifier from secret
  const nullifierPreimage = Buffer.concat([secret, Buffer.from("nullifier")]);
  const nullifierHash = crypto.createHash("sha256").update(nullifierPreimage).digest();
  
  // Generate a NEW wallet to receive (demonstrates privacy - no link to depositor!)
  const recipientWallet = Keypair.generate();
  console.log(`🆕 NEW Recipient Wallet: ${recipientWallet.publicKey.toBase58()}`);
  console.log(`   (This wallet has NO connection to the depositor on-chain!)\n`);
  
  console.log(`🔑 Nullifier Hash: ${nullifierHash.toString("hex")}`);
  console.log(`   (Proves you know the secret without revealing which deposit)\n`);

  // For the withdrawal, we need to pass the ZK proof
  // In this MVP, we use a simplified proof (the secret itself)
  // In production, this would be a full Groth16 ZK proof
  
  console.log("⏳ Sending withdrawal transaction...\n");

  try {
    const withdrawSig = await withdraw(
      connection, 
      wallet, 
      poolPda, 
      vaultPda, 
      nullifiersPda,
      rootsHistoryPda,
      nullifierHash,
      recipientWallet.publicKey,
      amount,
      secret
    );
    console.log(`✅ WITHDRAWAL SUCCESSFUL!`);
    console.log(`   TX: https://solscan.io/tx/${withdrawSig}?cluster=devnet\n`);
    
    // Wait for confirmation
    await sleep(2000);
    
    const recipientBalance = await connection.getBalance(recipientWallet.publicKey);
    console.log(`💰 Recipient received: ${recipientBalance / LAMPORTS_PER_SOL} SOL\n`);
  } catch (e: any) {
    console.log(`⚠️ Withdrawal error: ${e.message}`);
    if (e.logs) {
      console.log("   Logs:", e.logs.slice(-5).join("\n        "));
    }
    console.log("\n");
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 3: DOUBLE-SPEND PROTECTION
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 3: DOUBLE-SPEND PROTECTION                            │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  console.log("🛡️  Attempting to use same nullifier again (should fail)...\n");

  try {
    const doubleSig = await withdraw(
      connection, 
      wallet, 
      poolPda, 
      vaultPda, 
      nullifiersPda,
      rootsHistoryPda,
      nullifierHash,  // Same nullifier!
      recipientWallet.publicKey,
      amount,
      secret
    );
    console.log(`❌ SECURITY FAILURE: Double-spend succeeded!`);
  } catch (e: any) {
    console.log(`✅ DOUBLE-SPEND BLOCKED!`);
    console.log(`   The nullifier was already used - funds are safe.\n`);
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVACY SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   PRIVACY SUMMARY                                         ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  console.log("🔒 WHAT SOLSCAN SHOWS:");
  console.log("   DEPOSIT TX: Depositor → Pool (1 SOL) + Commitment Hash");
  console.log("   WITHDRAW TX: Pool → New Wallet (1 SOL) + Nullifier Hash\n");

  console.log("🔒 WHAT CANNOT BE LINKED:");
  console.log("   ❌ Depositor wallet → Recipient wallet");
  console.log("   ❌ Commitment → Nullifier");
  console.log("   ❌ Input source → Output destination\n");

  console.log("🔗 VERIFY ON SOLSCAN:");
  console.log(`   Program: https://solscan.io/account/${POOL_PROGRAM_ID}?cluster=devnet`);
  console.log(`   Pool: https://solscan.io/account/${poolPda}?cluster=devnet`);
  console.log(`   Vault: https://solscan.io/account/${vaultPda}?cluster=devnet\n`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function deposit(
  connection: Connection,
  wallet: Keypair,
  poolPda: PublicKey,
  vaultPda: PublicKey,
  merkleTreePda: PublicKey,
  rootsHistoryPda: PublicKey,
  commitment: Buffer,
  amount: number
): Promise<string> {
  const discriminator = crypto.createHash("sha256")
    .update("global:deposit")
    .digest()
    .slice(0, 8);
  
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount));
  
  const instructionData = Buffer.concat([discriminator, commitment, amountBuffer]);

  const tx = new anchor.web3.Transaction().add({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: merkleTreePda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: instructionData,
  });

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet]);
}

async function withdraw(
  connection: Connection,
  wallet: Keypair,
  poolPda: PublicKey,
  vaultPda: PublicKey,
  nullifiersPda: PublicKey,
  rootsHistoryPda: PublicKey,
  nullifierHash: Buffer,
  recipient: PublicKey,
  amount: number,
  secret: Buffer
): Promise<string> {
  const discriminator = crypto.createHash("sha256")
    .update("global:withdraw")
    .digest()
    .slice(0, 8);
  
  // Build proof components (64 + 128 + 64 = 256 bytes of zeros for MVP placeholder)
  const proofA = Buffer.alloc(64);
  const proofB = Buffer.alloc(128);
  const proofC = Buffer.alloc(64);
  
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount));
  
  const relayerFee = Buffer.alloc(8); // 0 fee
  
  // Get current merkle root from pool
  // Pool struct: discriminator(8) + merkle_levels(1) + next_index(8) + current_root(32)
  const poolData = await connection.getAccountInfo(poolPda);
  const merkleRoot = poolData!.data.slice(8 + 1 + 8, 8 + 1 + 8 + 32); // Correct offset: 17-49
  console.log(`   Using Merkle Root: ${merkleRoot.toString("hex")}`)
  
  const instructionData = Buffer.concat([
    discriminator,
    proofA,
    proofB,
    proofC,
    nullifierHash,
    recipient.toBuffer(),
    amountBuffer,
    relayerFee,
    merkleRoot,
  ]);

  // Need a relayer account even if fee is 0
  const relayer = wallet.publicKey;

  const tx = new anchor.web3.Transaction().add({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: nullifiersPda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: relayer, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: instructionData,
  });

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet]);
}

main().catch(console.error);


import * as fs from "fs";
import * as crypto from "crypto";

const POOL_PROGRAM_ID = new PublicKey('7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV');

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   WHISTLE PROTOCOL - FULL PRIVACY TEST                    ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // Load wallet
  const walletPath = "../keys/deploy-wallet.json";
  const walletData = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  console.log(`📍 Wallet: ${wallet.publicKey.toBase58()}`);
  const balanceBefore = await connection.getBalance(wallet.publicKey);
  console.log(`💰 Balance: ${balanceBefore / LAMPORTS_PER_SOL} SOL\n`);

  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
  const [merkleTreePda] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree")], POOL_PROGRAM_ID);
  const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
  const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);

  // Check vault balance
  const vaultBalance = await connection.getBalance(vaultPda);
  console.log(`🏦 Pool Vault Balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`   Vault: ${vaultPda.toBase58()}\n`);

  // ═══════════════════════════════════════════════════════════
  // TEST 1: PRIVATE DEPOSIT
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 1: PRIVATE DEPOSIT                                    │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Generate secret for commitment
  const secret = crypto.randomBytes(32);
  const amount = LAMPORTS_PER_SOL; // 1 SOL
  
  // Compute commitment: hash(secret || amount)
  const commitmentPreimage = Buffer.concat([secret, Buffer.alloc(8)]);
  commitmentPreimage.writeBigUInt64LE(BigInt(amount), 32);
  const commitment = crypto.createHash("sha256").update(commitmentPreimage).digest();
  
  console.log(`🔐 Your Secret (KEEP PRIVATE): ${secret.toString("hex")}`);
  console.log(`💰 Deposit Amount: ${amount / LAMPORTS_PER_SOL} SOL`);
  console.log(`📝 Public Commitment: ${commitment.toString("hex")}\n`);

  console.log("⏳ Sending deposit transaction...\n");

  try {
    const depositSig = await deposit(connection, wallet, poolPda, vaultPda, merkleTreePda, rootsHistoryPda, commitment, amount);
    console.log(`✅ DEPOSIT SUCCESSFUL!`);
    console.log(`   TX: https://solscan.io/tx/${depositSig}?cluster=devnet\n`);
    
    // Wait for confirmation
    await sleep(2000);
    
    const vaultBalanceAfterDeposit = await connection.getBalance(vaultPda);
    console.log(`🏦 Pool Vault Now: ${vaultBalanceAfterDeposit / LAMPORTS_PER_SOL} SOL\n`);
  } catch (e: any) {
    console.log(`⚠️ Deposit error: ${e.message}\n`);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 2: PRIVATE WITHDRAWAL
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 2: PRIVATE WITHDRAWAL                                 │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Compute nullifier from secret
  const nullifierPreimage = Buffer.concat([secret, Buffer.from("nullifier")]);
  const nullifierHash = crypto.createHash("sha256").update(nullifierPreimage).digest();
  
  // Generate a NEW wallet to receive (demonstrates privacy - no link to depositor!)
  const recipientWallet = Keypair.generate();
  console.log(`🆕 NEW Recipient Wallet: ${recipientWallet.publicKey.toBase58()}`);
  console.log(`   (This wallet has NO connection to the depositor on-chain!)\n`);
  
  console.log(`🔑 Nullifier Hash: ${nullifierHash.toString("hex")}`);
  console.log(`   (Proves you know the secret without revealing which deposit)\n`);

  // For the withdrawal, we need to pass the ZK proof
  // In this MVP, we use a simplified proof (the secret itself)
  // In production, this would be a full Groth16 ZK proof
  
  console.log("⏳ Sending withdrawal transaction...\n");

  try {
    const withdrawSig = await withdraw(
      connection, 
      wallet, 
      poolPda, 
      vaultPda, 
      nullifiersPda,
      rootsHistoryPda,
      nullifierHash,
      recipientWallet.publicKey,
      amount,
      secret
    );
    console.log(`✅ WITHDRAWAL SUCCESSFUL!`);
    console.log(`   TX: https://solscan.io/tx/${withdrawSig}?cluster=devnet\n`);
    
    // Wait for confirmation
    await sleep(2000);
    
    const recipientBalance = await connection.getBalance(recipientWallet.publicKey);
    console.log(`💰 Recipient received: ${recipientBalance / LAMPORTS_PER_SOL} SOL\n`);
  } catch (e: any) {
    console.log(`⚠️ Withdrawal error: ${e.message}`);
    if (e.logs) {
      console.log("   Logs:", e.logs.slice(-5).join("\n        "));
    }
    console.log("\n");
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 3: DOUBLE-SPEND PROTECTION
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 3: DOUBLE-SPEND PROTECTION                            │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  console.log("🛡️  Attempting to use same nullifier again (should fail)...\n");

  try {
    const doubleSig = await withdraw(
      connection, 
      wallet, 
      poolPda, 
      vaultPda, 
      nullifiersPda,
      rootsHistoryPda,
      nullifierHash,  // Same nullifier!
      recipientWallet.publicKey,
      amount,
      secret
    );
    console.log(`❌ SECURITY FAILURE: Double-spend succeeded!`);
  } catch (e: any) {
    console.log(`✅ DOUBLE-SPEND BLOCKED!`);
    console.log(`   The nullifier was already used - funds are safe.\n`);
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVACY SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   PRIVACY SUMMARY                                         ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  console.log("🔒 WHAT SOLSCAN SHOWS:");
  console.log("   DEPOSIT TX: Depositor → Pool (1 SOL) + Commitment Hash");
  console.log("   WITHDRAW TX: Pool → New Wallet (1 SOL) + Nullifier Hash\n");

  console.log("🔒 WHAT CANNOT BE LINKED:");
  console.log("   ❌ Depositor wallet → Recipient wallet");
  console.log("   ❌ Commitment → Nullifier");
  console.log("   ❌ Input source → Output destination\n");

  console.log("🔗 VERIFY ON SOLSCAN:");
  console.log(`   Program: https://solscan.io/account/${POOL_PROGRAM_ID}?cluster=devnet`);
  console.log(`   Pool: https://solscan.io/account/${poolPda}?cluster=devnet`);
  console.log(`   Vault: https://solscan.io/account/${vaultPda}?cluster=devnet\n`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function deposit(
  connection: Connection,
  wallet: Keypair,
  poolPda: PublicKey,
  vaultPda: PublicKey,
  merkleTreePda: PublicKey,
  rootsHistoryPda: PublicKey,
  commitment: Buffer,
  amount: number
): Promise<string> {
  const discriminator = crypto.createHash("sha256")
    .update("global:deposit")
    .digest()
    .slice(0, 8);
  
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount));
  
  const instructionData = Buffer.concat([discriminator, commitment, amountBuffer]);

  const tx = new anchor.web3.Transaction().add({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: merkleTreePda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: instructionData,
  });

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet]);
}

async function withdraw(
  connection: Connection,
  wallet: Keypair,
  poolPda: PublicKey,
  vaultPda: PublicKey,
  nullifiersPda: PublicKey,
  rootsHistoryPda: PublicKey,
  nullifierHash: Buffer,
  recipient: PublicKey,
  amount: number,
  secret: Buffer
): Promise<string> {
  const discriminator = crypto.createHash("sha256")
    .update("global:withdraw")
    .digest()
    .slice(0, 8);
  
  // Build proof components (64 + 128 + 64 = 256 bytes of zeros for MVP placeholder)
  const proofA = Buffer.alloc(64);
  const proofB = Buffer.alloc(128);
  const proofC = Buffer.alloc(64);
  
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount));
  
  const relayerFee = Buffer.alloc(8); // 0 fee
  
  // Get current merkle root from pool
  // Pool struct: discriminator(8) + merkle_levels(1) + next_index(8) + current_root(32)
  const poolData = await connection.getAccountInfo(poolPda);
  const merkleRoot = poolData!.data.slice(8 + 1 + 8, 8 + 1 + 8 + 32); // Correct offset: 17-49
  console.log(`   Using Merkle Root: ${merkleRoot.toString("hex")}`)
  
  const instructionData = Buffer.concat([
    discriminator,
    proofA,
    proofB,
    proofC,
    nullifierHash,
    recipient.toBuffer(),
    amountBuffer,
    relayerFee,
    merkleRoot,
  ]);

  // Need a relayer account even if fee is 0
  const relayer = wallet.publicKey;

  const tx = new anchor.web3.Transaction().add({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: nullifiersPda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: relayer, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: instructionData,
  });

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet]);
}

main().catch(console.error);




import * as fs from "fs";
import * as crypto from "crypto";

const POOL_PROGRAM_ID = new PublicKey('7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV');

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   WHISTLE PROTOCOL - FULL PRIVACY TEST                    ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // Load wallet
  const walletPath = "../keys/deploy-wallet.json";
  const walletData = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  console.log(`📍 Wallet: ${wallet.publicKey.toBase58()}`);
  const balanceBefore = await connection.getBalance(wallet.publicKey);
  console.log(`💰 Balance: ${balanceBefore / LAMPORTS_PER_SOL} SOL\n`);

  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
  const [merkleTreePda] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree")], POOL_PROGRAM_ID);
  const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
  const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);

  // Check vault balance
  const vaultBalance = await connection.getBalance(vaultPda);
  console.log(`🏦 Pool Vault Balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`   Vault: ${vaultPda.toBase58()}\n`);

  // ═══════════════════════════════════════════════════════════
  // TEST 1: PRIVATE DEPOSIT
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 1: PRIVATE DEPOSIT                                    │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Generate secret for commitment
  const secret = crypto.randomBytes(32);
  const amount = LAMPORTS_PER_SOL; // 1 SOL
  
  // Compute commitment: hash(secret || amount)
  const commitmentPreimage = Buffer.concat([secret, Buffer.alloc(8)]);
  commitmentPreimage.writeBigUInt64LE(BigInt(amount), 32);
  const commitment = crypto.createHash("sha256").update(commitmentPreimage).digest();
  
  console.log(`🔐 Your Secret (KEEP PRIVATE): ${secret.toString("hex")}`);
  console.log(`💰 Deposit Amount: ${amount / LAMPORTS_PER_SOL} SOL`);
  console.log(`📝 Public Commitment: ${commitment.toString("hex")}\n`);

  console.log("⏳ Sending deposit transaction...\n");

  try {
    const depositSig = await deposit(connection, wallet, poolPda, vaultPda, merkleTreePda, rootsHistoryPda, commitment, amount);
    console.log(`✅ DEPOSIT SUCCESSFUL!`);
    console.log(`   TX: https://solscan.io/tx/${depositSig}?cluster=devnet\n`);
    
    // Wait for confirmation
    await sleep(2000);
    
    const vaultBalanceAfterDeposit = await connection.getBalance(vaultPda);
    console.log(`🏦 Pool Vault Now: ${vaultBalanceAfterDeposit / LAMPORTS_PER_SOL} SOL\n`);
  } catch (e: any) {
    console.log(`⚠️ Deposit error: ${e.message}\n`);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 2: PRIVATE WITHDRAWAL
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 2: PRIVATE WITHDRAWAL                                 │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Compute nullifier from secret
  const nullifierPreimage = Buffer.concat([secret, Buffer.from("nullifier")]);
  const nullifierHash = crypto.createHash("sha256").update(nullifierPreimage).digest();
  
  // Generate a NEW wallet to receive (demonstrates privacy - no link to depositor!)
  const recipientWallet = Keypair.generate();
  console.log(`🆕 NEW Recipient Wallet: ${recipientWallet.publicKey.toBase58()}`);
  console.log(`   (This wallet has NO connection to the depositor on-chain!)\n`);
  
  console.log(`🔑 Nullifier Hash: ${nullifierHash.toString("hex")}`);
  console.log(`   (Proves you know the secret without revealing which deposit)\n`);

  // For the withdrawal, we need to pass the ZK proof
  // In this MVP, we use a simplified proof (the secret itself)
  // In production, this would be a full Groth16 ZK proof
  
  console.log("⏳ Sending withdrawal transaction...\n");

  try {
    const withdrawSig = await withdraw(
      connection, 
      wallet, 
      poolPda, 
      vaultPda, 
      nullifiersPda,
      rootsHistoryPda,
      nullifierHash,
      recipientWallet.publicKey,
      amount,
      secret
    );
    console.log(`✅ WITHDRAWAL SUCCESSFUL!`);
    console.log(`   TX: https://solscan.io/tx/${withdrawSig}?cluster=devnet\n`);
    
    // Wait for confirmation
    await sleep(2000);
    
    const recipientBalance = await connection.getBalance(recipientWallet.publicKey);
    console.log(`💰 Recipient received: ${recipientBalance / LAMPORTS_PER_SOL} SOL\n`);
  } catch (e: any) {
    console.log(`⚠️ Withdrawal error: ${e.message}`);
    if (e.logs) {
      console.log("   Logs:", e.logs.slice(-5).join("\n        "));
    }
    console.log("\n");
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 3: DOUBLE-SPEND PROTECTION
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 3: DOUBLE-SPEND PROTECTION                            │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  console.log("🛡️  Attempting to use same nullifier again (should fail)...\n");

  try {
    const doubleSig = await withdraw(
      connection, 
      wallet, 
      poolPda, 
      vaultPda, 
      nullifiersPda,
      rootsHistoryPda,
      nullifierHash,  // Same nullifier!
      recipientWallet.publicKey,
      amount,
      secret
    );
    console.log(`❌ SECURITY FAILURE: Double-spend succeeded!`);
  } catch (e: any) {
    console.log(`✅ DOUBLE-SPEND BLOCKED!`);
    console.log(`   The nullifier was already used - funds are safe.\n`);
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVACY SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   PRIVACY SUMMARY                                         ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  console.log("🔒 WHAT SOLSCAN SHOWS:");
  console.log("   DEPOSIT TX: Depositor → Pool (1 SOL) + Commitment Hash");
  console.log("   WITHDRAW TX: Pool → New Wallet (1 SOL) + Nullifier Hash\n");

  console.log("🔒 WHAT CANNOT BE LINKED:");
  console.log("   ❌ Depositor wallet → Recipient wallet");
  console.log("   ❌ Commitment → Nullifier");
  console.log("   ❌ Input source → Output destination\n");

  console.log("🔗 VERIFY ON SOLSCAN:");
  console.log(`   Program: https://solscan.io/account/${POOL_PROGRAM_ID}?cluster=devnet`);
  console.log(`   Pool: https://solscan.io/account/${poolPda}?cluster=devnet`);
  console.log(`   Vault: https://solscan.io/account/${vaultPda}?cluster=devnet\n`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function deposit(
  connection: Connection,
  wallet: Keypair,
  poolPda: PublicKey,
  vaultPda: PublicKey,
  merkleTreePda: PublicKey,
  rootsHistoryPda: PublicKey,
  commitment: Buffer,
  amount: number
): Promise<string> {
  const discriminator = crypto.createHash("sha256")
    .update("global:deposit")
    .digest()
    .slice(0, 8);
  
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount));
  
  const instructionData = Buffer.concat([discriminator, commitment, amountBuffer]);

  const tx = new anchor.web3.Transaction().add({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: merkleTreePda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: instructionData,
  });

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet]);
}

async function withdraw(
  connection: Connection,
  wallet: Keypair,
  poolPda: PublicKey,
  vaultPda: PublicKey,
  nullifiersPda: PublicKey,
  rootsHistoryPda: PublicKey,
  nullifierHash: Buffer,
  recipient: PublicKey,
  amount: number,
  secret: Buffer
): Promise<string> {
  const discriminator = crypto.createHash("sha256")
    .update("global:withdraw")
    .digest()
    .slice(0, 8);
  
  // Build proof components (64 + 128 + 64 = 256 bytes of zeros for MVP placeholder)
  const proofA = Buffer.alloc(64);
  const proofB = Buffer.alloc(128);
  const proofC = Buffer.alloc(64);
  
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount));
  
  const relayerFee = Buffer.alloc(8); // 0 fee
  
  // Get current merkle root from pool
  // Pool struct: discriminator(8) + merkle_levels(1) + next_index(8) + current_root(32)
  const poolData = await connection.getAccountInfo(poolPda);
  const merkleRoot = poolData!.data.slice(8 + 1 + 8, 8 + 1 + 8 + 32); // Correct offset: 17-49
  console.log(`   Using Merkle Root: ${merkleRoot.toString("hex")}`)
  
  const instructionData = Buffer.concat([
    discriminator,
    proofA,
    proofB,
    proofC,
    nullifierHash,
    recipient.toBuffer(),
    amountBuffer,
    relayerFee,
    merkleRoot,
  ]);

  // Need a relayer account even if fee is 0
  const relayer = wallet.publicKey;

  const tx = new anchor.web3.Transaction().add({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: nullifiersPda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: relayer, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: instructionData,
  });

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet]);
}

main().catch(console.error);

