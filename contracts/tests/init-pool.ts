/**
 * Initialize the Whistle Pool on Devnet
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";

const POOL_PROGRAM_ID = new PublicKey("AMtxCTW99zCBfhukVdN8YvA3AsdSJ7nsgnUdHpth7QTD");

function getDiscriminator(name: string): Buffer {
  return crypto.createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .slice(0, 8);
}

async function main() {
  console.log("=".repeat(60));
  console.log("WHISTLE POOL INITIALIZATION");
  console.log("=".repeat(60));

  // Load wallet
  const walletPath = "C:\\Users\\salva\\Downloads\\server\\whistle-protocol\\keys\\deploy-wallet.json";
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  
  console.log("Wallet:", walletKeypair.publicKey.toBase58());

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  // Derive PDAs
  const [poolPda, poolBump] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
  const [merkleTreePda] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree")], POOL_PROGRAM_ID);
  const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
  const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);

  console.log("\nPDAs:");
  console.log("  Pool:", poolPda.toBase58());
  console.log("  Vault:", vaultPda.toBase58());
  console.log("  MerkleTree:", merkleTreePda.toBase58());
  console.log("  RootsHistory:", rootsHistoryPda.toBase58());
  console.log("  Nullifiers:", nullifiersPda.toBase58());

  // Check if already initialized
  const poolAccount = await connection.getAccountInfo(poolPda);
  if (poolAccount) {
    console.log("\n✅ Pool already initialized!");
    console.log("Pool data length:", poolAccount.data.length);
    return;
  }

  console.log("\nInitializing pool...");

  // Step 1: Initialize Pool
  console.log("\n[1/4] Initialize Pool State...");
  const initDiscrim = getDiscriminator("initialize");
  const merkleLevels = Buffer.alloc(1);
  merkleLevels.writeUInt8(7); // 7 levels = 128 leaves

  const initData = Buffer.concat([initDiscrim, merkleLevels]);

  const initIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: initData,
  });

  try {
    const tx1 = new Transaction().add(initIx);
    const sig1 = await sendAndConfirmTransaction(connection, tx1, [walletKeypair]);
    console.log("  ✅ Pool initialized:", sig1);
  } catch (e: any) {
    console.log("  Error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log("    ", l));
  }

  await new Promise(r => setTimeout(r, 2000));

  // Step 2: Initialize Merkle Tree
  console.log("\n[2/4] Initialize Merkle Tree...");
  const initMerkleDiscrim = getDiscriminator("init_merkle");

  const initMerkleIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: merkleTreePda, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: initMerkleDiscrim,
  });

  try {
    const tx2 = new Transaction().add(initMerkleIx);
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [walletKeypair]);
    console.log("  ✅ Merkle tree initialized:", sig2);
  } catch (e: any) {
    console.log("  Error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log("    ", l));
  }

  await new Promise(r => setTimeout(r, 2000));

  // Step 3: Initialize Roots History
  console.log("\n[3/4] Initialize Roots History...");
  const initRootsDiscrim = getDiscriminator("init_roots");

  const initRootsIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: initRootsDiscrim,
  });

  try {
    const tx3 = new Transaction().add(initRootsIx);
    const sig3 = await sendAndConfirmTransaction(connection, tx3, [walletKeypair]);
    console.log("  ✅ Roots history initialized:", sig3);
  } catch (e: any) {
    console.log("  Error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log("    ", l));
  }

  await new Promise(r => setTimeout(r, 2000));

  // Step 4: Initialize Nullifiers
  console.log("\n[4/4] Initialize Nullifiers...");
  const initNullifiersDiscrim = getDiscriminator("init_nullifiers");

  const initNullifiersIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: nullifiersPda, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: initNullifiersDiscrim,
  });

  try {
    const tx4 = new Transaction().add(initNullifiersIx);
    const sig4 = await sendAndConfirmTransaction(connection, tx4, [walletKeypair]);
    console.log("  ✅ Nullifiers initialized:", sig4);
  } catch (e: any) {
    console.log("  Error:", e.message);
    if (e.logs) e.logs.forEach((l: string) => console.log("    ", l));
  }

  console.log("\n" + "=".repeat(60));
  console.log("INITIALIZATION COMPLETE");
  console.log("=".repeat(60));
  console.log("\nPool vault:", vaultPda.toBase58());
  console.log("Solscan:", `https://solscan.io/account/${vaultPda.toBase58()}?cluster=devnet`);
}

main().catch(console.error);
