import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const POOL_PROGRAM_ID = new PublicKey("Dbg3KpPQ1hspRaRxhNMPdDoWwoMTu4DGB9U5k2zq9Tod");

// Circuit hash function: H(a, b) = (a + b + c)^5
const BN254_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const ROUND_CONSTANT = BigInt(305419896);

function simpleHash(left: bigint, right: bigint): bigint {
    const t1 = (left + right + ROUND_CONSTANT) % BN254_MODULUS;
    const t2 = (t1 * t1) % BN254_MODULUS;
    const t3 = (t2 * t2) % BN254_MODULUS;
    const t4 = (t3 * t1) % BN254_MODULUS;
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
    console.log("   WHISTLE PROTOCOL - WITHDRAWAL TEST");
    console.log("═".repeat(70));
    
    // PDAs
    const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
    const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
    const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
    const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);
    
    // Check vault balance
    const vaultBalance = await connection.getBalance(vaultPda);
    console.log(`\n📍 Vault balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL`);
    
    if (vaultBalance === 0) {
        console.log("❌ No funds in vault. Need to deposit first.");
        return;
    }
    
    // Use the note that was deposited earlier
    // NOTE: The commitment on-chain was made with OLD hash function
    // We need to match that exact commitment for the proof
    
    const noteSecret = BigInt("111222333444555666777888999000111");
    const noteNullifier = BigInt("999888777666555444333222111000999");
    const noteAmount = BigInt(20_000_000); // 0.02 SOL
    
    // Compute with NEW hash function (what circuit expects)
    const commitment = noteCommitment(noteSecret, noteNullifier, noteAmount);
    const nullHash = nullifierHash(noteNullifier);
    
    console.log(`\n📝 Note commitment: ${commitment}`);
    console.log(`📝 Nullifier hash: ${nullHash}`);
    
    // Withdrawal
    const withdrawAmount = BigInt(10_000_000); // 0.01 SOL
    const relayerFee = 0n;
    const changeAmount = noteAmount - withdrawAmount - relayerFee;
    
    // Change note secrets
    const changeSecret = BigInt("222333444555666777888999000111222");
    const changeNullifier = BigInt("888777666555444333222111000999888");
    const changeCommit = noteCommitment(changeSecret, changeNullifier, changeAmount);
    
    const recipient = Keypair.generate();
    const recipientBigint = bytes32ToBigint(recipient.publicKey.toBytes());
    
    console.log(`\n💸 Withdrawing: ${Number(withdrawAmount) / LAMPORTS_PER_SOL} SOL`);
    console.log(`💱 Change: ${Number(changeAmount) / LAMPORTS_PER_SOL} SOL`);
    console.log(`📍 To: ${recipient.publicKey.toBase58()}`);
    
    // Generate proof
    const circuitsDir = path.join(__dirname, "../../circuits");
    const input = {
        commitment: commitment.toString(),
        nullifierHash: nullHash.toString(),
        withdrawAmount: withdrawAmount.toString(),
        changeCommitment: changeCommit.toString(),
        recipient: recipientBigint.toString(),
        relayerFee: relayerFee.toString(),
        secret: noteSecret.toString(),
        nullifier: noteNullifier.toString(),
        noteAmount: noteAmount.toString(),
        changeSecret: changeSecret.toString(),
        changeNullifier: changeNullifier.toString(),
    };
    
    fs.writeFileSync(path.join(circuitsDir, "build/withdraw_input.json"), JSON.stringify(input, null, 2));
    
    console.log("\n⚙️  Generating ZK proof...");
    
    try {
        execSync(`node build/unshield_js/generate_witness.js build/unshield_js/unshield.wasm build/withdraw_input.json build/withdraw_witness.wtns`, { cwd: circuitsDir, stdio: "pipe" });
        execSync(`npx snarkjs groth16 prove build/unshield.zkey build/withdraw_witness.wtns build/withdraw_proof.json build/withdraw_public.json`, { cwd: circuitsDir, stdio: "pipe" });
        const verify = execSync(`npx snarkjs groth16 verify build/unshield_vk.json build/withdraw_public.json build/withdraw_proof.json`, { cwd: circuitsDir, encoding: "utf-8" });
        console.log(`✅ Proof verified: ${verify.trim()}`);
    } catch (e: any) {
        console.log(`❌ Proof failed: ${e.message}`);
        return;
    }
    
    // Read proof and execute withdrawal
    const proof = JSON.parse(fs.readFileSync(path.join(circuitsDir, "build/withdraw_proof.json"), "utf-8"));
    const poolData = await connection.getAccountInfo(poolPda);
    const merkleRoot = poolData!.data.slice(8 + 1 + 8, 8 + 1 + 8 + 32);
    
    console.log(`\n📝 Merkle root from pool: 0x${Buffer.from(merkleRoot).toString("hex").slice(0, 16)}...`);
    
    const proofA = proofPointToBytes(proof.pi_a, 64);
    const proofB = proofPointToBytes(proof.pi_b, 128);
    const proofC = proofPointToBytes(proof.pi_c, 64);
    
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
    
    console.log("\n⏳ Sending withdrawal transaction...");
    
    try {
        const withdrawSig = await connection.sendRawTransaction(withdrawTx.serialize());
        await connection.confirmTransaction(withdrawSig, "confirmed");
        
        const recipientBalance = await connection.getBalance(recipient.publicKey);
        
        console.log("\n" + "═".repeat(70));
        console.log("   🎉 WITHDRAWAL SUCCESSFUL!");
        console.log("═".repeat(70));
        console.log(`\n📋 TX: https://solscan.io/tx/${withdrawSig}?cluster=devnet`);
        console.log(`💰 Recipient got: ${recipientBalance / LAMPORTS_PER_SOL} SOL`);
        console.log(`📍 Recipient: ${recipient.publicKey.toBase58()}`);
        
    } catch (e: any) {
        console.log(`\n❌ Withdrawal failed: ${e.message}`);
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

