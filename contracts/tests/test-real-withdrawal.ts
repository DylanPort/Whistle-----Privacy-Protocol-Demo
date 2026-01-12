import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const POOL_PROGRAM_ID = new PublicKey("8A6rYQ7Kf7aqg8JkU7z6W83wCZvmohND7wiXPBhkpowx");

async function main() {
    const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
    
    const walletPath = "../keys/deploy-wallet.json";
    const walletKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    );
    
    console.log("=".repeat(60));
    console.log("WHISTLE PROTOCOL - REAL ZK WITHDRAWAL TEST");
    console.log("=".repeat(60));
    console.log(`Wallet: ${walletKeypair.publicKey.toBase58()}`);
    
    const balance = await connection.getBalance(walletKeypair.publicKey);
    console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    
    // Load the real proof from snarkjs
    const solanaProofPath = path.join(__dirname, "../../circuits/build/solana_proof.json");
    const solanaProof = JSON.parse(fs.readFileSync(solanaProofPath, "utf-8"));
    
    console.log("\n--- LOADED REAL GROTH16 PROOF ---");
    console.log(`Proof A: ${solanaProof.proof.a.length} bytes`);
    console.log(`Proof B: ${solanaProof.proof.b.length} bytes`);
    console.log(`Proof C: ${solanaProof.proof.c.length} bytes`);
    
    // PDAs
    const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
    const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
    const [merkleTreePda] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree")], POOL_PROGRAM_ID);
    const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
    const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);
    
    // Check vault balance
    const vaultBalance = await connection.getBalance(vaultPda);
    console.log(`\nVault balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL`);
    
    if (vaultBalance === 0) {
        console.log("\n--- DEPOSITING FIRST ---");
        
        // The commitment from the circuit: secret * nullifier + amount
        const secret = BigInt("12345678901234567890");
        const nullifier = BigInt("98765432109876543210");
        const amount = BigInt(1000000000);
        const commitment = secret * nullifier + amount;
        
        console.log(`Commitment: ${commitment}`);
        
        // Convert to 32 bytes
        const commitmentBytes = bigIntToBytes(commitment, 32);
        
        const depositIx = createDepositInstruction(
            walletKeypair.publicKey,
            poolPda,
            merkleTreePda,
            rootsHistoryPda,
            vaultPda,
            Array.from(commitmentBytes),
            Number(amount)
        );
        
        const depositTx = new anchor.web3.Transaction().add(depositIx);
        depositTx.feePayer = walletKeypair.publicKey;
        depositTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        depositTx.sign(walletKeypair);
        
        try {
            const depositSig = await connection.sendRawTransaction(depositTx.serialize());
            await connection.confirmTransaction(depositSig, "confirmed");
            console.log(`✓ Deposited 1 SOL`);
            console.log(`  TX: https://solscan.io/tx/${depositSig}?cluster=devnet`);
        } catch (e: any) {
            console.log(`Deposit error: ${e.message}`);
        }
    }
    
    // Now attempt withdrawal with real proof
    console.log("\n--- ATTEMPTING WITHDRAWAL WITH REAL ZK PROOF ---");
    
    // Get current merkle root
    const poolInfo = await connection.getAccountInfo(poolPda);
    let onChainRoot = new Uint8Array(32);
    if (poolInfo) {
        onChainRoot = new Uint8Array(poolInfo.data.slice(8 + 1 + 8, 8 + 1 + 8 + 32));
    }
    
    console.log(`On-chain Merkle Root: ${Buffer.from(onChainRoot).toString("hex")}`);
    console.log(`Proof Merkle Root: ${solanaProof.publicSignals[0]}`);
    
    // Nullifier hash from the proof
    const nullifierHash = bigIntToBytes(BigInt(solanaProof.publicSignals[1]), 32);
    console.log(`Nullifier Hash: ${Buffer.from(nullifierHash).toString("hex")}`);
    
    // Recipient
    const recipientKeypair = Keypair.generate();
    console.log(`Recipient: ${recipientKeypair.publicKey.toBase58()}`);
    
    // Build withdrawal instruction
    const proofA = new Uint8Array(solanaProof.proof.a);
    const proofB = new Uint8Array(solanaProof.proof.b);
    const proofC = new Uint8Array(solanaProof.proof.c);
    
    // Use the merkle root from the proof (should match on-chain after our deposit)
    const proofMerkleRoot = bigIntToBytes(BigInt(solanaProof.publicSignals[0]), 32);
    
    const withdrawIx = createWithdrawInstruction(
        poolPda,
        nullifiersPda,
        rootsHistoryPda,
        vaultPda,
        recipientKeypair.publicKey,
        walletKeypair.publicKey,
        Array.from(proofA),
        Array.from(proofB),
        Array.from(proofC),
        Array.from(nullifierHash),
        Array.from(proofMerkleRoot),
        1000000000, // 1 SOL
        0 // no relayer fee
    );
    
    const withdrawTx = new anchor.web3.Transaction().add(withdrawIx);
    withdrawTx.feePayer = walletKeypair.publicKey;
    withdrawTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    withdrawTx.sign(walletKeypair);
    
    console.log("\nSending withdrawal transaction...");
    
    try {
        const withdrawSig = await connection.sendRawTransaction(withdrawTx.serialize(), {
            skipPreflight: false,
        });
        await connection.confirmTransaction(withdrawSig, "confirmed");
        console.log(`\n✓ WITHDRAWAL SUCCESSFUL!`);
        console.log(`  TX: https://solscan.io/tx/${withdrawSig}?cluster=devnet`);
        
        // Check recipient balance
        const recipientBalance = await connection.getBalance(recipientKeypair.publicKey);
        console.log(`  Recipient received: ${recipientBalance / LAMPORTS_PER_SOL} SOL`);
    } catch (e: any) {
        console.log(`\nWithdrawal error: ${e.message}`);
        if (e.logs) {
            console.log("\nTransaction logs:");
            e.logs.forEach((log: string) => console.log(`  ${log}`));
        }
        
        // Analyze the error
        console.log("\n--- ANALYSIS ---");
        console.log("The withdrawal failed because:");
        console.log("1. The on-chain Merkle root doesn't match the proof's root");
        console.log("   (The proof was generated with test values, not real on-chain state)");
        console.log("2. OR the Groth16 pairing check failed");
        console.log("   (The on-chain VK is placeholder zeros, not the real VK)");
        console.log("\nTo fix: Update contract with real VK and generate proof from actual deposit");
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("TEST COMPLETE");
    console.log("=".repeat(60));
    
    const finalBalance = await connection.getBalance(walletKeypair.publicKey);
    console.log(`\nWallet balance: ${finalBalance / LAMPORTS_PER_SOL} SOL`);
}

function bigIntToBytes(n: bigint, size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    let temp = n;
    for (let i = size - 1; i >= 0; i--) {
        bytes[i] = Number(temp & 0xffn);
        temp >>= 8n;
    }
    return bytes;
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

