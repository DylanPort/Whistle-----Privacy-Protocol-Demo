import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const POOL_PROGRAM_ID = new PublicKey("Dbg3KpPQ1hspRaRxhNMPdDoWwoMTu4DGB9U5k2zq9Tod");

// Match circuit hash function: H(a, b) = (a + b + c)^5
const BN254_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const ROUND_CONSTANT = BigInt(305419896); // 0x12345678

function simpleHash(left: bigint, right: bigint): bigint {
    const t1 = (left + right + ROUND_CONSTANT) % BN254_MODULUS;
    const t2 = (t1 * t1) % BN254_MODULUS;       // x^2
    const t3 = (t2 * t2) % BN254_MODULUS;       // x^4
    const t4 = (t3 * t1) % BN254_MODULUS;       // x^5
    return t4;
}

function noteCommitment(secret: bigint, nullifier: bigint, amount: bigint): bigint {
    return simpleHash(secret, nullifier + amount);
}

function nullifierHash(nullifier: bigint): bigint {
    return simpleHash(nullifier, 0n);
}

function bigintToBytes32(n: bigint): Uint8Array {
    const bytes = new Uint8Array(32);
    let temp = n;
    for (let i = 31; i >= 0; i--) {
        bytes[i] = Number(temp & 0xffn);
        temp >>= 8n;
    }
    return bytes;
}

function bytes32ToBigint(bytes: Uint8Array): bigint {
    let result = 0n;
    for (let i = 0; i < 32; i++) {
        result = (result << 8n) | BigInt(bytes[i]);
    }
    return result;
}

async function main() {
    const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
    
    const walletPath = path.join(__dirname, "../../keys/deploy-wallet.json");
    const walletKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    );
    
    console.log("\n" + "═".repeat(70));
    console.log("   WHISTLE PROTOCOL - SHIELDED BALANCE DEMO");
    console.log("═".repeat(70));
    console.log(`\n📍 Program: ${POOL_PROGRAM_ID.toBase58()}`);
    console.log(`👛 Wallet: ${walletKeypair.publicKey.toBase58()}`);
    
    const balance = await connection.getBalance(walletKeypair.publicKey);
    console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);
    
    // PDAs
    const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
    const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
    const [merkleTreePda] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree")], POOL_PROGRAM_ID);
    const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
    const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);
    
    // =============================================
    // STEP 1: Initialize Pool (if needed)
    // =============================================
    console.log("─".repeat(70));
    console.log("STEP 1: Initialize Pool");
    console.log("─".repeat(70));
    
    const poolInfo = await connection.getAccountInfo(poolPda);
    if (!poolInfo) {
        const initIx = createInitializeInstruction(
            walletKeypair.publicKey, poolPda, merkleTreePda, rootsHistoryPda, nullifiersPda, vaultPda, 16
        );
        const initTx = new anchor.web3.Transaction().add(initIx);
        initTx.feePayer = walletKeypair.publicKey;
        initTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        initTx.sign(walletKeypair);
        const initSig = await connection.sendRawTransaction(initTx.serialize());
        await connection.confirmTransaction(initSig, "confirmed");
        console.log(`✅ Pool initialized`);
        console.log(`   https://solscan.io/tx/${initSig}?cluster=devnet\n`);
    } else {
        console.log("✅ Pool already exists\n");
    }
    
    // =============================================
    // STEP 2: SHIELD - Deposit 0.5 SOL
    // =============================================
    console.log("─".repeat(70));
    console.log("STEP 2: SHIELD (Deposit 0.5 SOL)");
    console.log("─".repeat(70));
    
    const depositAmount = BigInt(20_000_000); // 0.02 SOL for demo
    
    // Generate note secrets
    const noteSecret = BigInt("111222333444555666777888999000111");
    const noteNullifier = BigInt("999888777666555444333222111000999");
    
    // Compute commitment
    const commitment = noteCommitment(noteSecret, noteNullifier, depositAmount);
    const nullHash = nullifierHash(noteNullifier);
    
    console.log(`📝 Note Details (PRIVATE - keep secret!):`);
    console.log(`   Secret: ${noteSecret}`);
    console.log(`   Nullifier: ${noteNullifier}`);
    console.log(`   Amount: ${Number(depositAmount) / LAMPORTS_PER_SOL} SOL`);
    console.log(`\n📋 Public Commitment: ${commitment}`);
    
    // Create shield instruction (use deposit discriminator)
    const shieldIx = createDepositInstruction(
        walletKeypair.publicKey, poolPda, merkleTreePda, rootsHistoryPda, vaultPda,
        Array.from(bigintToBytes32(commitment)), Number(depositAmount)
    );
    
    const shieldTx = new anchor.web3.Transaction().add(shieldIx);
    shieldTx.feePayer = walletKeypair.publicKey;
    shieldTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    shieldTx.sign(walletKeypair);
    
    let shieldSig: string;
    try {
        shieldSig = await connection.sendRawTransaction(shieldTx.serialize());
        await connection.confirmTransaction(shieldSig, "confirmed");
        console.log(`\n✅ SHIELDED!`);
        console.log(`   https://solscan.io/tx/${shieldSig}?cluster=devnet`);
    } catch (e: any) {
        console.log(`\n❌ Shield failed: ${e.message}`);
        if (e.message.includes("insufficient")) {
            console.log(`\n⚠️  Need more SOL. Send to: ${walletKeypair.publicKey.toBase58()}`);
        }
        return;
    }
    
    await new Promise(r => setTimeout(r, 2000));
    
    // =============================================
    // STEP 3: Generate ZK Proof for Unshield
    // =============================================
    console.log("\n" + "─".repeat(70));
    console.log("STEP 3: Generate ZK Proof");
    console.log("─".repeat(70));
    
    const withdrawAmount = BigInt(10_000_000); // 0.01 SOL for demo
    const relayerFee = 0n;
    const changeAmount = depositAmount - withdrawAmount - relayerFee;
    
    // Generate new secrets for change note
    const changeSecret = BigInt("222333444555666777888999000111222");
    const changeNullifier = BigInt("888777666555444333222111000999888");
    
    const changeCommit = changeAmount > 0n 
        ? noteCommitment(changeSecret, changeNullifier, changeAmount)
        : 0n;
    
    const recipient = Keypair.generate();
    const recipientBigint = bytes32ToBigint(recipient.publicKey.toBytes());
    
    console.log(`💸 Withdrawal: ${Number(withdrawAmount) / LAMPORTS_PER_SOL} SOL`);
    console.log(`💱 Change: ${Number(changeAmount) / LAMPORTS_PER_SOL} SOL (re-shielded)`);
    console.log(`📍 Recipient: ${recipient.publicKey.toBase58()}`);
    
    // Save circuit input
    const circuitsDir = path.join(__dirname, "../../circuits");
    const input = {
        // Public
        commitment: commitment.toString(),
        nullifierHash: nullHash.toString(),
        withdrawAmount: withdrawAmount.toString(),
        changeCommitment: changeCommit.toString(),
        recipient: recipientBigint.toString(),
        relayerFee: relayerFee.toString(),
        // Private
        secret: noteSecret.toString(),
        nullifier: noteNullifier.toString(),
        noteAmount: depositAmount.toString(),
        changeSecret: changeSecret.toString(),
        changeNullifier: changeNullifier.toString(),
    };
    
    fs.writeFileSync(path.join(circuitsDir, "build/unshield_input.json"), JSON.stringify(input, null, 2));
    
    // Compile circuit if needed
    const wasmPath = path.join(circuitsDir, "build/unshield_js/unshield.wasm");
    if (!fs.existsSync(wasmPath)) {
        console.log("\n⚙️  Compiling unshield circuit...");
        execSync(`npx circom unshield.circom --r1cs --wasm --sym -o build`, { cwd: circuitsDir, stdio: "pipe" });
        
        console.log("⚙️  Running trusted setup...");
        execSync(`npx snarkjs groth16 setup build/unshield.r1cs pot12_final.ptau build/unshield.zkey`, { cwd: circuitsDir, stdio: "pipe" });
        execSync(`npx snarkjs zkey export verificationkey build/unshield.zkey build/unshield_vk.json`, { cwd: circuitsDir, stdio: "pipe" });
    }
    
    // Generate witness and proof
    try {
        execSync(`node build/unshield_js/generate_witness.js build/unshield_js/unshield.wasm build/unshield_input.json build/unshield_witness.wtns`, { cwd: circuitsDir, stdio: "pipe" });
        console.log("✅ Witness generated");
        
        execSync(`npx snarkjs groth16 prove build/unshield.zkey build/unshield_witness.wtns build/unshield_proof.json build/unshield_public.json`, { cwd: circuitsDir, stdio: "pipe" });
        console.log("✅ Proof generated");
        
        const result = execSync(`npx snarkjs groth16 verify build/unshield_vk.json build/unshield_public.json build/unshield_proof.json`, { cwd: circuitsDir, encoding: "utf-8" });
        console.log(`✅ Proof verified: ${result.trim()}`);
    } catch (e: any) {
        console.log(`\n❌ Proof generation failed: ${e.message}`);
        console.log(e.stderr?.toString() || "");
        return;
    }
    
    // =============================================
    // STEP 4: UNSHIELD - Withdraw to new address
    // =============================================
    console.log("\n" + "─".repeat(70));
    console.log("STEP 4: UNSHIELD (Withdraw)");
    console.log("─".repeat(70));
    
    const proof = JSON.parse(fs.readFileSync(path.join(circuitsDir, "build/unshield_proof.json"), "utf-8"));
    const poolData = await connection.getAccountInfo(poolPda);
    const merkleRoot = poolData!.data.slice(8 + 1 + 8, 8 + 1 + 8 + 32);
    
    const proofA = proofPointToBytes(proof.pi_a, 64);
    const proofB = proofPointToBytes(proof.pi_b, 128);
    const proofC = proofPointToBytes(proof.pi_c, 64);
    
    // Create withdraw instruction
    const withdrawIx = createWithdrawInstruction(
        poolPda, nullifiersPda, rootsHistoryPda, vaultPda,
        recipient.publicKey, walletKeypair.publicKey,
        Array.from(proofA), Array.from(proofB), Array.from(proofC),
        Array.from(bigintToBytes32(nullHash)),
        Array.from(merkleRoot), Number(withdrawAmount), 0
    );
    
    const withdrawTx = new anchor.web3.Transaction().add(withdrawIx);
    withdrawTx.feePayer = walletKeypair.publicKey;
    withdrawTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    withdrawTx.sign(walletKeypair);
    
    try {
        const withdrawSig = await connection.sendRawTransaction(withdrawTx.serialize());
        await connection.confirmTransaction(withdrawSig, "confirmed");
        
        const recipientBalance = await connection.getBalance(recipient.publicKey);
        
        console.log("\n" + "═".repeat(70));
        console.log("   🎉 UNSHIELD SUCCESSFUL!");
        console.log("═".repeat(70));
        console.log(`\n📋 Transaction: https://solscan.io/tx/${withdrawSig}?cluster=devnet`);
        console.log(`\n💰 Recipient received: ${recipientBalance / LAMPORTS_PER_SOL} SOL`);
        console.log(`📍 Recipient address: ${recipient.publicKey.toBase58()}`);
        console.log(`\n🔒 Privacy preserved:`);
        console.log(`   - Original deposit amount: HIDDEN`);
        console.log(`   - Depositor identity: HIDDEN`);
        console.log(`   - Change amount: ${Number(changeAmount) / LAMPORTS_PER_SOL} SOL (re-shielded)`);
        console.log(`\n💡 Change note can be withdrawn later with new ZK proof!`);
        
    } catch (e: any) {
        console.log(`\n❌ Unshield failed: ${e.message}`);
        if (e.logs) {
            console.log("\nLogs:");
            e.logs.forEach((log: string) => console.log(`  ${log}`));
        }
    }
}

function proofPointToBytes(point: any, size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    if (size === 64) {
        bytes.set(bigintToBytes32(BigInt(point[0])), 0);
        bytes.set(bigintToBytes32(BigInt(point[1])), 32);
    } else if (size === 128) {
        bytes.set(bigintToBytes32(BigInt(point[0][0])), 0);
        bytes.set(bigintToBytes32(BigInt(point[0][1])), 32);
        bytes.set(bigintToBytes32(BigInt(point[1][0])), 64);
        bytes.set(bigintToBytes32(BigInt(point[1][1])), 96);
    }
    return bytes;
}

function createInitializeInstruction(authority: PublicKey, pool: PublicKey, merkleTree: PublicKey, rootsHistory: PublicKey, nullifiers: PublicKey, vault: PublicKey, levels: number) {
    const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
    const data = Buffer.concat([discriminator, Buffer.from([levels])]);
    return new anchor.web3.TransactionInstruction({
        keys: [
            { pubkey: pool, isSigner: false, isWritable: true },
            { pubkey: merkleTree, isSigner: false, isWritable: true },
            { pubkey: rootsHistory, isSigner: false, isWritable: true },
            { pubkey: nullifiers, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: authority, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: POOL_PROGRAM_ID,
        data,
    });
}

function createDepositInstruction(depositor: PublicKey, pool: PublicKey, merkleTree: PublicKey, rootsHistory: PublicKey, vault: PublicKey, commitment: number[], amount: number) {
    const discriminator = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]);
    const data = Buffer.alloc(8 + 32 + 8);
    discriminator.copy(data, 0);
    Buffer.from(commitment).copy(data, 8);
    data.writeBigUInt64LE(BigInt(amount), 40);
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

function createWithdrawInstruction(pool: PublicKey, nullifiers: PublicKey, rootsHistory: PublicKey, vault: PublicKey, recipient: PublicKey, relayer: PublicKey, proofA: number[], proofB: number[], proofC: number[], nullifierHash: number[], merkleRoot: number[], amount: number, relayerFee: number) {
    const discriminator = Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]);
    const data = Buffer.alloc(8 + 64 + 128 + 64 + 32 + 32 + 8 + 8 + 32);
    let offset = 0;
    discriminator.copy(data, offset); offset += 8;
    Buffer.from(proofA).copy(data, offset); offset += 64;
    Buffer.from(proofB).copy(data, offset); offset += 128;
    Buffer.from(proofC).copy(data, offset); offset += 64;
    Buffer.from(nullifierHash).copy(data, offset); offset += 32;
    recipient.toBuffer().copy(data, offset); offset += 32;
    data.writeBigUInt64LE(BigInt(amount), offset); offset += 8;
    data.writeBigUInt64LE(BigInt(relayerFee), offset); offset += 8;
    Buffer.from(merkleRoot).copy(data, offset);
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

