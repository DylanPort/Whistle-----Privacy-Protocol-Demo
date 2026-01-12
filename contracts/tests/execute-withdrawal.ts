import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const POOL_PROGRAM_ID = new PublicKey("ESLQ6XdkxFVKZ3Vk22wJw6THS2QhpftSnaWZBWVNKKsr");

// Circuit hash
const BN254_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const ROUND_CONSTANT = BigInt(0x12345678);

function circuitHash(left: bigint, right: bigint): bigint {
    const sum = (left + right + ROUND_CONSTANT) % BN254_MODULUS;
    const sq = (sum * sum) % BN254_MODULUS;
    const sq2 = (sq * sq) % BN254_MODULUS;
    return (sq2 * sum) % BN254_MODULUS;
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

async function main() {
    const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
    
    const walletPath = path.join(__dirname, "../../keys/deploy-wallet.json");
    const walletKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    );
    
    console.log("=".repeat(70));
    console.log("WHISTLE PROTOCOL - EXECUTE ON-CHAIN WITHDRAWAL");
    console.log("=".repeat(70));
    
    // PDAs
    const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
    const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
    const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);
    const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
    
    // Check vault before
    const vaultBefore = await connection.getBalance(vaultPda);
    console.log(`\nVault BEFORE: ${vaultBefore / LAMPORTS_PER_SOL} SOL`);
    
    // Load the proof we generated
    const circuitsDir = path.join(__dirname, "../../circuits");
    const proof = JSON.parse(fs.readFileSync(path.join(circuitsDir, "build/proof_demo.json"), "utf-8"));
    
    // Withdrawal parameters
    const secret = BigInt("12345678901234567890123456789012");
    const nullifier = BigInt("98765432109876543210987654321098");
    const amount = BigInt(1000000000);
    
    const nullifierHash = circuitHash(nullifier, 0n);
    const recipient = Keypair.generate();
    
    console.log(`Recipient: ${recipient.publicKey.toBase58()}`);
    console.log(`Nullifier Hash: ${nullifierHash.toString().substring(0, 30)}...`);
    
    // Get on-chain merkle root
    const poolData = await connection.getAccountInfo(poolPda);
    const merkleRoot = poolData!.data.slice(8 + 1 + 8, 8 + 1 + 8 + 32);
    
    // Convert proof to bytes
    const proofA = proofPointToBytes(proof.pi_a, 64);
    const proofB = proofPointToBytes(proof.pi_b, 128);
    const proofC = proofPointToBytes(proof.pi_c, 64);
    
    // Build withdrawal instruction
    const withdrawIx = createWithdrawInstruction(
        poolPda,
        nullifiersPda,
        rootsHistoryPda,
        vaultPda,
        recipient.publicKey,
        walletKeypair.publicKey,
        Array.from(proofA),
        Array.from(proofB),
        Array.from(proofC),
        Array.from(bigintToBytes32(nullifierHash)),
        Array.from(merkleRoot),
        Number(amount),
        0
    );
    
    const tx = new anchor.web3.Transaction().add(withdrawIx);
    tx.feePayer = walletKeypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(walletKeypair);
    
    console.log("\nSubmitting withdrawal transaction...");
    
    try {
        const sig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(sig, "confirmed");
        
        console.log("\n" + "=".repeat(70));
        console.log("✅ WITHDRAWAL SUCCESSFUL!");
        console.log("=".repeat(70));
        console.log(`\nTransaction: https://solscan.io/tx/${sig}?cluster=devnet`);
        
        // Check balances after
        const vaultAfter = await connection.getBalance(vaultPda);
        const recipientBalance = await connection.getBalance(recipient.publicKey);
        
        console.log(`\nVault AFTER: ${vaultAfter / LAMPORTS_PER_SOL} SOL`);
        console.log(`Recipient received: ${recipientBalance / LAMPORTS_PER_SOL} SOL`);
        console.log(`\nRecipient address: ${recipient.publicKey.toBase58()}`);
        
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
        const x = bigintToBytes32(BigInt(point[0]));
        const y = bigintToBytes32(BigInt(point[1]));
        bytes.set(x, 0);
        bytes.set(y, 32);
    } else if (size === 128) {
        bytes.set(bigintToBytes32(BigInt(point[0][0])), 0);
        bytes.set(bigintToBytes32(BigInt(point[0][1])), 32);
        bytes.set(bigintToBytes32(BigInt(point[1][0])), 64);
        bytes.set(bigintToBytes32(BigInt(point[1][1])), 96);
    }
    return bytes;
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

