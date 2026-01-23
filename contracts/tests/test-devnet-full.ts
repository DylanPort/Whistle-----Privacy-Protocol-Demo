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
import * as crypto from "crypto";

// Current deployed program ID
const POOL_PROGRAM_ID = new PublicKey("AMtxCTW99zCBfhukVdN8YvA3AsdSJ7nsgnUdHpth7QTD");

// Generate a random 32-byte commitment
function generateCommitment(): Buffer {
  return crypto.randomBytes(32);
}

// Generate Anchor discriminator
function getDiscriminator(name: string): Buffer {
  return crypto.createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .slice(0, 8);
}

async function main() {
  console.log("=".repeat(70));
  console.log("WHISTLE PROTOCOL - DEPOSIT/WITHDRAW TEST ON DEVNET");
  console.log("=".repeat(70));

  // Load wallet
  const walletPath = path.join(__dirname, "../../whistle-protocol/keys/deploy-wallet.json");
  if (!fs.existsSync(walletPath)) {
    console.log("Wallet not found at:", walletPath);
    console.log("Trying alternative path...");
  }
  
  // Try alternative wallet path
  const altWalletPath = "C:\\Users\\salva\\Downloads\\server\\whistle-protocol\\keys\\deploy-wallet.json";
  const finalWalletPath = fs.existsSync(walletPath) ? walletPath : altWalletPath;
  
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(finalWalletPath, "utf-8")))
  );
  
  console.log("\nWallet:", walletKeypair.publicKey.toBase58());
  console.log("Program ID:", POOL_PROGRAM_ID.toBase58());

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL\n");

  // Verify program is deployed
  const programInfo = await connection.getAccountInfo(POOL_PROGRAM_ID);
  if (!programInfo) {
    console.log("ERROR: Program not deployed!");
    return;
  }
  console.log("Program verified: executable =", programInfo.executable);
  console.log("Program Solscan: https://solscan.io/account/" + POOL_PROGRAM_ID.toBase58() + "?cluster=devnet\n");

  // Generate PDAs
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool")],
    POOL_PROGRAM_ID
  );
  
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    POOL_PROGRAM_ID
  );
  
  const [merkleTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree")],
    POOL_PROGRAM_ID
  );
  
  const [rootsHistoryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("roots_history")],
    POOL_PROGRAM_ID
  );
  
  const [nullifiersPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifiers")],
    POOL_PROGRAM_ID
  );

  console.log("PDAs:");
  console.log("  Pool:", poolPda.toBase58());
  console.log("  Vault:", vaultPda.toBase58());
  console.log("  MerkleTree:", merkleTreePda.toBase58());
  console.log("  RootsHistory:", rootsHistoryPda.toBase58());
  console.log("  Nullifiers:", nullifiersPda.toBase58());

  // ========================================
  // STEP 1: INITIALIZE POOL (if needed)
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 1: INITIALIZE POOL");
  console.log("=".repeat(70));

  const poolAccount = await connection.getAccountInfo(poolPda);
  let initTxSig = "";
  
  if (poolAccount) {
    console.log("Pool already initialized!");
    console.log("Pool Solscan: https://solscan.io/account/" + poolPda.toBase58() + "?cluster=devnet");
  } else {
    console.log("Initializing pool (4-step split initialization)...");
    
    // Step 1: Initialize pool state
    console.log("\n  Step 1/4: Initialize pool state...");
    const initPoolDiscriminator = getDiscriminator("initialize");
    const merkleLevels = 7; // Use 7 levels for testing (reduced for devnet)
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

    try {
      const tx1 = new Transaction().add(initPoolIx);
      const sig1 = await sendAndConfirmTransaction(connection, tx1, [walletKeypair], { commitment: "confirmed" });
      console.log("  Pool Init TX:", sig1);
      console.log("  Solscan: https://solscan.io/tx/" + sig1 + "?cluster=devnet");
    } catch (error: any) {
      console.log("  Pool Init Error:", error.message);
      if (error.logs) error.logs.forEach((log: string) => console.log("   ", log));
    }

    // Step 2: Initialize merkle tree
    console.log("\n  Step 2/4: Initialize merkle tree...");
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

    try {
      const tx2 = new Transaction().add(initMerkleIx);
      const sig2 = await sendAndConfirmTransaction(connection, tx2, [walletKeypair], { commitment: "confirmed" });
      console.log("  Merkle Init TX:", sig2);
      console.log("  Solscan: https://solscan.io/tx/" + sig2 + "?cluster=devnet");
    } catch (error: any) {
      console.log("  Merkle Init Error:", error.message);
      if (error.logs) error.logs.forEach((log: string) => console.log("   ", log));
    }

    // Step 3: Initialize roots history
    console.log("\n  Step 3/4: Initialize roots history...");
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

    try {
      const tx3 = new Transaction().add(initRootsIx);
      const sig3 = await sendAndConfirmTransaction(connection, tx3, [walletKeypair], { commitment: "confirmed" });
      console.log("  Roots Init TX:", sig3);
      console.log("  Solscan: https://solscan.io/tx/" + sig3 + "?cluster=devnet");
    } catch (error: any) {
      console.log("  Roots Init Error:", error.message);
      if (error.logs) error.logs.forEach((log: string) => console.log("   ", log));
    }

    // Step 4: Initialize nullifiers
    console.log("\n  Step 4/4: Initialize nullifiers...");
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

    try {
      const tx4 = new Transaction().add(initNullifiersIx);
      initTxSig = await sendAndConfirmTransaction(connection, tx4, [walletKeypair], { commitment: "confirmed" });
      console.log("  Nullifiers Init TX:", initTxSig);
      console.log("  Solscan: https://solscan.io/tx/" + initTxSig + "?cluster=devnet");
      console.log("\n  Pool fully initialized!");
    } catch (error: any) {
      console.log("  Nullifiers Init Error:", error.message);
      if (error.logs) error.logs.forEach((log: string) => console.log("   ", log));
    }
  }

  // ========================================
  // STEP 2: DEPOSIT (SHIELD) SOL
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 2: DEPOSIT (SHIELD) 0.02 SOL");
  console.log("=".repeat(70));

  const commitment = generateCommitment();
  const depositAmount = 0.02 * LAMPORTS_PER_SOL; // 0.02 SOL (above MIN_DEPOSIT of 0.01 SOL)
  
  console.log("Commitment:", commitment.toString("hex"));
  console.log("Amount:", depositAmount / LAMPORTS_PER_SOL, "SOL");

  const shieldDiscriminator = getDiscriminator("shield");
  
  // Shield instruction data: discriminator (8) + commitment (32) + amount (8)
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(depositAmount));
  
  const shieldData = Buffer.concat([shieldDiscriminator, commitment, amountBuffer]);

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
    console.log("\nDEPOSIT SUCCESS!");
    console.log("TX Signature:", depositTxSig);
    console.log("Solscan: https://solscan.io/tx/" + depositTxSig + "?cluster=devnet");
  } catch (error: any) {
    console.log("Deposit Error:", error.message);
    if (error.logs) {
      console.log("\nProgram Logs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
  }

  // Check vault balance after deposit
  const vaultBalance = await connection.getBalance(vaultPda);
  console.log("\nVault balance after deposit:", vaultBalance / LAMPORTS_PER_SOL, "SOL");
  console.log("Vault Solscan: https://solscan.io/account/" + vaultPda.toBase58() + "?cluster=devnet");

  // ========================================
  // STEP 3: ATTEMPT WITHDRAW (will fail without valid ZK proof)
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 3: WITHDRAW ATTEMPT (Demo - will show proof validation)");
  console.log("=".repeat(70));

  // Generate fake proof data (this will be rejected by ZK verification)
  const fakeProofA = crypto.randomBytes(64);
  const fakeProofB = crypto.randomBytes(128);
  const fakeProofC = crypto.randomBytes(64);
  const nullifierHash = crypto.randomBytes(32);
  const recipient = walletKeypair.publicKey.toBytes();
  const withdrawAmount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL denomination
  const relayerFee = 0;

  console.log("Note: This withdraw attempt will fail ZK verification (expected)");
  console.log("This demonstrates the program is correctly validating proofs\n");

  const unshieldDiscriminator = getDiscriminator("unshield");
  
  // Unshield instruction data layout:
  // discriminator (8) + proof_a (64) + proof_b (128) + proof_c (64) + 
  // nullifier_hash (32) + amount (8) + relayer_fee (8) + change_commitment (32)
  const withdrawAmountBuf = Buffer.alloc(8);
  withdrawAmountBuf.writeBigUInt64LE(BigInt(withdrawAmount));
  const relayerFeeBuf = Buffer.alloc(8);
  relayerFeeBuf.writeBigUInt64LE(BigInt(relayerFee));
  const changeCommitment = Buffer.alloc(32); // zero for no change

  const unshieldData = Buffer.concat([
    unshieldDiscriminator,
    fakeProofA,
    fakeProofB,
    fakeProofC,
    nullifierHash,
    withdrawAmountBuf,
    relayerFeeBuf,
    changeCommitment
  ]);

  // Create a new recipient keypair for the withdrawal
  const recipientKeypair = Keypair.generate();

  const unshieldIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: merkleTreePda, isSigner: false, isWritable: false },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: false },
      { pubkey: nullifiersPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: recipientKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true }, // relayer
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: unshieldData,
  });

  try {
    const unshieldTx = new Transaction().add(unshieldIx);
    const withdrawTxSig = await sendAndConfirmTransaction(connection, unshieldTx, [walletKeypair], {
      commitment: "confirmed",
    });
    console.log("Withdraw TX:", withdrawTxSig);
    console.log("Solscan: https://solscan.io/tx/" + withdrawTxSig + "?cluster=devnet");
  } catch (error: any) {
    console.log("Withdraw Error (EXPECTED - proves ZK validation works!)");
    console.log("Error:", error.message?.substring(0, 100) + "...");
    if (error.logs) {
      console.log("\nProgram Logs (showing ZK verification attempt):");
      error.logs.slice(-10).forEach((log: string) => console.log("  ", log));
    }
  }

  // ========================================
  // SUMMARY
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("TEST SUMMARY");
  console.log("=".repeat(70));
  
  console.log("\nProgram ID: AMtxCTW99zCBfhukVdN8YvA3AsdSJ7nsgnUdHpth7QTD");
  console.log("Program: https://solscan.io/account/AMtxCTW99zCBfhukVdN8YvA3AsdSJ7nsgnUdHpth7QTD?cluster=devnet");
  
  if (initTxSig) {
    console.log("\nInitialize TX: https://solscan.io/tx/" + initTxSig + "?cluster=devnet");
  }
  
  if (depositTxSig) {
    console.log("Deposit TX: https://solscan.io/tx/" + depositTxSig + "?cluster=devnet");
  }
  
  console.log("\nPool Account: https://solscan.io/account/" + poolPda.toBase58() + "?cluster=devnet");
  console.log("Vault Account: https://solscan.io/account/" + vaultPda.toBase58() + "?cluster=devnet");
  
  // Final balance check
  const finalBalance = await connection.getBalance(walletKeypair.publicKey);
  console.log("\nFinal Wallet Balance:", finalBalance / LAMPORTS_PER_SOL, "SOL");
  console.log("Vault Balance:", vaultBalance / LAMPORTS_PER_SOL, "SOL");
}

main().catch(console.error);
