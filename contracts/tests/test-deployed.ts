import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL 
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Program IDs
const POOL_PROGRAM_ID = new PublicKey("7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV");
const MERKLE_PROGRAM_ID = new PublicKey("C81ewP6VfPibPEYWirQ9A18bCoceRdCXmMbXv33zm9vC");
const VERIFIER_PROGRAM_ID = new PublicKey("7vBdkq62GbtXjoJydEEjn996kkr8kcbgrZcGbe7zSj1u");

async function main() {
  console.log("=".repeat(60));
  console.log("WHISTLE PROTOCOL - DEVNET TEST");
  console.log("=".repeat(60));

  // Load wallet
  const walletPath = path.join(__dirname, "../../keys/deploy-wallet.json");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  
  console.log("\n📍 Wallet:", walletKeypair.publicKey.toBase58());

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("💰 Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  // Verify programs are deployed
  console.log("\n📋 VERIFYING DEPLOYED PROGRAMS...\n");

  const programs = [
    { name: "whistle_pool", id: POOL_PROGRAM_ID },
    { name: "whistle_merkle", id: MERKLE_PROGRAM_ID },
    { name: "whistle_verifier", id: VERIFIER_PROGRAM_ID },
  ];

  for (const prog of programs) {
    const accountInfo = await connection.getAccountInfo(prog.id);
    if (accountInfo) {
      console.log(`✅ ${prog.name}: ${prog.id.toBase58()}`);
      console.log(`   Owner: ${accountInfo.owner.toBase58()}`);
      console.log(`   Executable: ${accountInfo.executable}`);
      console.log(`   Data Length: ${accountInfo.data.length} bytes`);
      console.log(`   Solscan: https://solscan.io/account/${prog.id.toBase58()}?cluster=devnet`);
    } else {
      console.log(`❌ ${prog.name}: NOT FOUND`);
    }
    console.log();
  }

  // Try to initialize a pool (this will test if the program is callable)
  console.log("=".repeat(60));
  console.log("TESTING POOL INITIALIZATION...");
  console.log("=".repeat(60));

  try {
    // Generate PDAs (simple seeds as per contract)
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

    console.log("\n📍 PDAs Generated:");
    console.log("   Pool PDA:", poolPda.toBase58());
    console.log("   Vault PDA:", vaultPda.toBase58());
    console.log("   Merkle Tree PDA:", merkleTreePda.toBase58());
    console.log("   Roots History PDA:", rootsHistoryPda.toBase58());
    console.log("   Nullifiers PDA:", nullifiersPda.toBase58());

    // Check if pool already exists
    const poolAccount = await connection.getAccountInfo(poolPda);
    
    if (poolAccount) {
      console.log("\n✅ Pool already initialized!");
      console.log("   Solscan: https://solscan.io/account/" + poolPda.toBase58() + "?cluster=devnet");
    } else {
      console.log("\n⏳ Pool not initialized yet. Attempting initialization...");
      
      // Build the initialization instruction manually
      // Since we don't have the IDL, we'll use a raw transaction
      
      // The instruction data for initialize:
      // - discriminator (8 bytes): sha256("global:initialize")[0..8]
      // - merkle_levels: u8 (1 byte) = 20
      
      const crypto = require("crypto");
      const discriminator = crypto.createHash("sha256")
        .update("global:initialize")
        .digest()
        .slice(0, 8);
      
      const levelsBuffer = Buffer.from([20]); // merkle_levels = 20
      
      const instructionData = Buffer.concat([discriminator, levelsBuffer]);
      
      // Account order must match Initialize struct in the contract:
      // 1. pool, 2. merkle_tree, 3. roots_history, 4. nullifiers, 5. pool_vault, 6. payer, 7. system_program
      const tx = new anchor.web3.Transaction().add({
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: merkleTreePda, isSigner: false, isWritable: true },
          { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
          { pubkey: nullifiersPda, isSigner: false, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: false },
          { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: POOL_PROGRAM_ID,
        data: instructionData,
      });
      
      console.log("\n📤 Sending initialization transaction...");
      
      const signature = await connection.sendTransaction(tx, [walletKeypair], {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      
      console.log("✅ Transaction sent!");
      console.log("   Signature:", signature);
      console.log("   Solscan: https://solscan.io/tx/" + signature + "?cluster=devnet");
      
      // Wait for confirmation
      await connection.confirmTransaction(signature, "confirmed");
      console.log("✅ Transaction confirmed!");
    }

  } catch (error: any) {
    console.log("\n⚠️  Initialization test result:", error.message);
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("TEST COMPLETE");
  console.log("=".repeat(60));
  
  console.log("\n🔗 SOLSCAN LINKS:");
  console.log(`   Pool Program: https://solscan.io/account/${POOL_PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`   Merkle Program: https://solscan.io/account/${MERKLE_PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`   Verifier Program: https://solscan.io/account/${VERIFIER_PROGRAM_ID.toBase58()}?cluster=devnet`);
}

main().catch(console.error);




import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL 
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Program IDs
const POOL_PROGRAM_ID = new PublicKey("7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV");
const MERKLE_PROGRAM_ID = new PublicKey("C81ewP6VfPibPEYWirQ9A18bCoceRdCXmMbXv33zm9vC");
const VERIFIER_PROGRAM_ID = new PublicKey("7vBdkq62GbtXjoJydEEjn996kkr8kcbgrZcGbe7zSj1u");

async function main() {
  console.log("=".repeat(60));
  console.log("WHISTLE PROTOCOL - DEVNET TEST");
  console.log("=".repeat(60));

  // Load wallet
  const walletPath = path.join(__dirname, "../../keys/deploy-wallet.json");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  
  console.log("\n📍 Wallet:", walletKeypair.publicKey.toBase58());

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("💰 Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  // Verify programs are deployed
  console.log("\n📋 VERIFYING DEPLOYED PROGRAMS...\n");

  const programs = [
    { name: "whistle_pool", id: POOL_PROGRAM_ID },
    { name: "whistle_merkle", id: MERKLE_PROGRAM_ID },
    { name: "whistle_verifier", id: VERIFIER_PROGRAM_ID },
  ];

  for (const prog of programs) {
    const accountInfo = await connection.getAccountInfo(prog.id);
    if (accountInfo) {
      console.log(`✅ ${prog.name}: ${prog.id.toBase58()}`);
      console.log(`   Owner: ${accountInfo.owner.toBase58()}`);
      console.log(`   Executable: ${accountInfo.executable}`);
      console.log(`   Data Length: ${accountInfo.data.length} bytes`);
      console.log(`   Solscan: https://solscan.io/account/${prog.id.toBase58()}?cluster=devnet`);
    } else {
      console.log(`❌ ${prog.name}: NOT FOUND`);
    }
    console.log();
  }

  // Try to initialize a pool (this will test if the program is callable)
  console.log("=".repeat(60));
  console.log("TESTING POOL INITIALIZATION...");
  console.log("=".repeat(60));

  try {
    // Generate PDAs (simple seeds as per contract)
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

    console.log("\n📍 PDAs Generated:");
    console.log("   Pool PDA:", poolPda.toBase58());
    console.log("   Vault PDA:", vaultPda.toBase58());
    console.log("   Merkle Tree PDA:", merkleTreePda.toBase58());
    console.log("   Roots History PDA:", rootsHistoryPda.toBase58());
    console.log("   Nullifiers PDA:", nullifiersPda.toBase58());

    // Check if pool already exists
    const poolAccount = await connection.getAccountInfo(poolPda);
    
    if (poolAccount) {
      console.log("\n✅ Pool already initialized!");
      console.log("   Solscan: https://solscan.io/account/" + poolPda.toBase58() + "?cluster=devnet");
    } else {
      console.log("\n⏳ Pool not initialized yet. Attempting initialization...");
      
      // Build the initialization instruction manually
      // Since we don't have the IDL, we'll use a raw transaction
      
      // The instruction data for initialize:
      // - discriminator (8 bytes): sha256("global:initialize")[0..8]
      // - merkle_levels: u8 (1 byte) = 20
      
      const crypto = require("crypto");
      const discriminator = crypto.createHash("sha256")
        .update("global:initialize")
        .digest()
        .slice(0, 8);
      
      const levelsBuffer = Buffer.from([20]); // merkle_levels = 20
      
      const instructionData = Buffer.concat([discriminator, levelsBuffer]);
      
      // Account order must match Initialize struct in the contract:
      // 1. pool, 2. merkle_tree, 3. roots_history, 4. nullifiers, 5. pool_vault, 6. payer, 7. system_program
      const tx = new anchor.web3.Transaction().add({
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: merkleTreePda, isSigner: false, isWritable: true },
          { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
          { pubkey: nullifiersPda, isSigner: false, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: false },
          { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: POOL_PROGRAM_ID,
        data: instructionData,
      });
      
      console.log("\n📤 Sending initialization transaction...");
      
      const signature = await connection.sendTransaction(tx, [walletKeypair], {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      
      console.log("✅ Transaction sent!");
      console.log("   Signature:", signature);
      console.log("   Solscan: https://solscan.io/tx/" + signature + "?cluster=devnet");
      
      // Wait for confirmation
      await connection.confirmTransaction(signature, "confirmed");
      console.log("✅ Transaction confirmed!");
    }

  } catch (error: any) {
    console.log("\n⚠️  Initialization test result:", error.message);
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("TEST COMPLETE");
  console.log("=".repeat(60));
  
  console.log("\n🔗 SOLSCAN LINKS:");
  console.log(`   Pool Program: https://solscan.io/account/${POOL_PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`   Merkle Program: https://solscan.io/account/${MERKLE_PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`   Verifier Program: https://solscan.io/account/${VERIFIER_PROGRAM_ID.toBase58()}?cluster=devnet`);
}

main().catch(console.error);


import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL 
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Program IDs
const POOL_PROGRAM_ID = new PublicKey("7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV");
const MERKLE_PROGRAM_ID = new PublicKey("C81ewP6VfPibPEYWirQ9A18bCoceRdCXmMbXv33zm9vC");
const VERIFIER_PROGRAM_ID = new PublicKey("7vBdkq62GbtXjoJydEEjn996kkr8kcbgrZcGbe7zSj1u");

async function main() {
  console.log("=".repeat(60));
  console.log("WHISTLE PROTOCOL - DEVNET TEST");
  console.log("=".repeat(60));

  // Load wallet
  const walletPath = path.join(__dirname, "../../keys/deploy-wallet.json");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  
  console.log("\n📍 Wallet:", walletKeypair.publicKey.toBase58());

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("💰 Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  // Verify programs are deployed
  console.log("\n📋 VERIFYING DEPLOYED PROGRAMS...\n");

  const programs = [
    { name: "whistle_pool", id: POOL_PROGRAM_ID },
    { name: "whistle_merkle", id: MERKLE_PROGRAM_ID },
    { name: "whistle_verifier", id: VERIFIER_PROGRAM_ID },
  ];

  for (const prog of programs) {
    const accountInfo = await connection.getAccountInfo(prog.id);
    if (accountInfo) {
      console.log(`✅ ${prog.name}: ${prog.id.toBase58()}`);
      console.log(`   Owner: ${accountInfo.owner.toBase58()}`);
      console.log(`   Executable: ${accountInfo.executable}`);
      console.log(`   Data Length: ${accountInfo.data.length} bytes`);
      console.log(`   Solscan: https://solscan.io/account/${prog.id.toBase58()}?cluster=devnet`);
    } else {
      console.log(`❌ ${prog.name}: NOT FOUND`);
    }
    console.log();
  }

  // Try to initialize a pool (this will test if the program is callable)
  console.log("=".repeat(60));
  console.log("TESTING POOL INITIALIZATION...");
  console.log("=".repeat(60));

  try {
    // Generate PDAs (simple seeds as per contract)
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

    console.log("\n📍 PDAs Generated:");
    console.log("   Pool PDA:", poolPda.toBase58());
    console.log("   Vault PDA:", vaultPda.toBase58());
    console.log("   Merkle Tree PDA:", merkleTreePda.toBase58());
    console.log("   Roots History PDA:", rootsHistoryPda.toBase58());
    console.log("   Nullifiers PDA:", nullifiersPda.toBase58());

    // Check if pool already exists
    const poolAccount = await connection.getAccountInfo(poolPda);
    
    if (poolAccount) {
      console.log("\n✅ Pool already initialized!");
      console.log("   Solscan: https://solscan.io/account/" + poolPda.toBase58() + "?cluster=devnet");
    } else {
      console.log("\n⏳ Pool not initialized yet. Attempting initialization...");
      
      // Build the initialization instruction manually
      // Since we don't have the IDL, we'll use a raw transaction
      
      // The instruction data for initialize:
      // - discriminator (8 bytes): sha256("global:initialize")[0..8]
      // - merkle_levels: u8 (1 byte) = 20
      
      const crypto = require("crypto");
      const discriminator = crypto.createHash("sha256")
        .update("global:initialize")
        .digest()
        .slice(0, 8);
      
      const levelsBuffer = Buffer.from([20]); // merkle_levels = 20
      
      const instructionData = Buffer.concat([discriminator, levelsBuffer]);
      
      // Account order must match Initialize struct in the contract:
      // 1. pool, 2. merkle_tree, 3. roots_history, 4. nullifiers, 5. pool_vault, 6. payer, 7. system_program
      const tx = new anchor.web3.Transaction().add({
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: merkleTreePda, isSigner: false, isWritable: true },
          { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
          { pubkey: nullifiersPda, isSigner: false, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: false },
          { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: POOL_PROGRAM_ID,
        data: instructionData,
      });
      
      console.log("\n📤 Sending initialization transaction...");
      
      const signature = await connection.sendTransaction(tx, [walletKeypair], {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      
      console.log("✅ Transaction sent!");
      console.log("   Signature:", signature);
      console.log("   Solscan: https://solscan.io/tx/" + signature + "?cluster=devnet");
      
      // Wait for confirmation
      await connection.confirmTransaction(signature, "confirmed");
      console.log("✅ Transaction confirmed!");
    }

  } catch (error: any) {
    console.log("\n⚠️  Initialization test result:", error.message);
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("TEST COMPLETE");
  console.log("=".repeat(60));
  
  console.log("\n🔗 SOLSCAN LINKS:");
  console.log(`   Pool Program: https://solscan.io/account/${POOL_PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`   Merkle Program: https://solscan.io/account/${MERKLE_PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`   Verifier Program: https://solscan.io/account/${VERIFIER_PROGRAM_ID.toBase58()}?cluster=devnet`);
}

main().catch(console.error);




import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL 
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Program IDs
const POOL_PROGRAM_ID = new PublicKey("7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV");
const MERKLE_PROGRAM_ID = new PublicKey("C81ewP6VfPibPEYWirQ9A18bCoceRdCXmMbXv33zm9vC");
const VERIFIER_PROGRAM_ID = new PublicKey("7vBdkq62GbtXjoJydEEjn996kkr8kcbgrZcGbe7zSj1u");

async function main() {
  console.log("=".repeat(60));
  console.log("WHISTLE PROTOCOL - DEVNET TEST");
  console.log("=".repeat(60));

  // Load wallet
  const walletPath = path.join(__dirname, "../../keys/deploy-wallet.json");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  
  console.log("\n📍 Wallet:", walletKeypair.publicKey.toBase58());

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("💰 Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  // Verify programs are deployed
  console.log("\n📋 VERIFYING DEPLOYED PROGRAMS...\n");

  const programs = [
    { name: "whistle_pool", id: POOL_PROGRAM_ID },
    { name: "whistle_merkle", id: MERKLE_PROGRAM_ID },
    { name: "whistle_verifier", id: VERIFIER_PROGRAM_ID },
  ];

  for (const prog of programs) {
    const accountInfo = await connection.getAccountInfo(prog.id);
    if (accountInfo) {
      console.log(`✅ ${prog.name}: ${prog.id.toBase58()}`);
      console.log(`   Owner: ${accountInfo.owner.toBase58()}`);
      console.log(`   Executable: ${accountInfo.executable}`);
      console.log(`   Data Length: ${accountInfo.data.length} bytes`);
      console.log(`   Solscan: https://solscan.io/account/${prog.id.toBase58()}?cluster=devnet`);
    } else {
      console.log(`❌ ${prog.name}: NOT FOUND`);
    }
    console.log();
  }

  // Try to initialize a pool (this will test if the program is callable)
  console.log("=".repeat(60));
  console.log("TESTING POOL INITIALIZATION...");
  console.log("=".repeat(60));

  try {
    // Generate PDAs (simple seeds as per contract)
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

    console.log("\n📍 PDAs Generated:");
    console.log("   Pool PDA:", poolPda.toBase58());
    console.log("   Vault PDA:", vaultPda.toBase58());
    console.log("   Merkle Tree PDA:", merkleTreePda.toBase58());
    console.log("   Roots History PDA:", rootsHistoryPda.toBase58());
    console.log("   Nullifiers PDA:", nullifiersPda.toBase58());

    // Check if pool already exists
    const poolAccount = await connection.getAccountInfo(poolPda);
    
    if (poolAccount) {
      console.log("\n✅ Pool already initialized!");
      console.log("   Solscan: https://solscan.io/account/" + poolPda.toBase58() + "?cluster=devnet");
    } else {
      console.log("\n⏳ Pool not initialized yet. Attempting initialization...");
      
      // Build the initialization instruction manually
      // Since we don't have the IDL, we'll use a raw transaction
      
      // The instruction data for initialize:
      // - discriminator (8 bytes): sha256("global:initialize")[0..8]
      // - merkle_levels: u8 (1 byte) = 20
      
      const crypto = require("crypto");
      const discriminator = crypto.createHash("sha256")
        .update("global:initialize")
        .digest()
        .slice(0, 8);
      
      const levelsBuffer = Buffer.from([20]); // merkle_levels = 20
      
      const instructionData = Buffer.concat([discriminator, levelsBuffer]);
      
      // Account order must match Initialize struct in the contract:
      // 1. pool, 2. merkle_tree, 3. roots_history, 4. nullifiers, 5. pool_vault, 6. payer, 7. system_program
      const tx = new anchor.web3.Transaction().add({
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: merkleTreePda, isSigner: false, isWritable: true },
          { pubkey: rootsHistoryPda, isSigner: false, isWritable: true },
          { pubkey: nullifiersPda, isSigner: false, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: false },
          { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: POOL_PROGRAM_ID,
        data: instructionData,
      });
      
      console.log("\n📤 Sending initialization transaction...");
      
      const signature = await connection.sendTransaction(tx, [walletKeypair], {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      
      console.log("✅ Transaction sent!");
      console.log("   Signature:", signature);
      console.log("   Solscan: https://solscan.io/tx/" + signature + "?cluster=devnet");
      
      // Wait for confirmation
      await connection.confirmTransaction(signature, "confirmed");
      console.log("✅ Transaction confirmed!");
    }

  } catch (error: any) {
    console.log("\n⚠️  Initialization test result:", error.message);
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("TEST COMPLETE");
  console.log("=".repeat(60));
  
  console.log("\n🔗 SOLSCAN LINKS:");
  console.log(`   Pool Program: https://solscan.io/account/${POOL_PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`   Merkle Program: https://solscan.io/account/${MERKLE_PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`   Verifier Program: https://solscan.io/account/${VERIFIER_PROGRAM_ID.toBase58()}?cluster=devnet`);
}

main().catch(console.error);

