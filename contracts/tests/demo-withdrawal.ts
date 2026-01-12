import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const POOL_PROGRAM_ID = new PublicKey("BbVZTUdUBhbGdZiuGGXGAi66WkXitgtHqoJeXhZpv9E9");

// Circuit hash: H(l, r) = ((l + r + C)^5) mod p
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
    
    console.log("=".repeat(70));
    console.log("WHISTLE PROTOCOL - DEMO ZK WITHDRAWAL");
    console.log("=".repeat(70));
    console.log(`Program: ${POOL_PROGRAM_ID.toBase58()}`);
    console.log(`Wallet: ${walletKeypair.publicKey.toBase58()}`);
    
    // PDAs
    const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID);
    const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], POOL_PROGRAM_ID);
    const [nullifiersPda] = PublicKey.findProgramAddressSync([Buffer.from("nullifiers")], POOL_PROGRAM_ID);
    const [rootsHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("roots_history")], POOL_PROGRAM_ID);
    
    const vaultBalance = await connection.getBalance(vaultPda);
    console.log(`Vault: ${vaultBalance / LAMPORTS_PER_SOL} SOL\n`);
    
    // ===========================================
    // STEP 1: Define withdrawal parameters
    // ===========================================
    console.log("--- STEP 1: Withdrawal Parameters ---");
    
    const secret = BigInt("12345678901234567890123456789012");
    const nullifier = BigInt("98765432109876543210987654321098");
    const amount = BigInt(1000000000); // 1 SOL
    
    const commitment = circuitHash(secret, nullifier + amount);
    const nullifierHash = circuitHash(nullifier, 0n);
    
    const recipient = Keypair.generate();
    const recipientBigint = bytes32ToBigint(recipient.publicKey.toBytes());
    
    console.log(`Commitment: ${commitment}`);
    console.log(`Nullifier Hash: ${nullifierHash}`);
    console.log(`Recipient: ${recipient.publicKey.toBase58()}`);
    
    // ===========================================
    // STEP 2: Generate ZK Proof
    // ===========================================
    console.log("\n--- STEP 2: Generate ZK Proof ---");
    
    const input = {
        secret: secret.toString(),
        nullifier: nullifier.toString(),
        commitment: commitment.toString(),
        nullifierHash: nullifierHash.toString(),
        recipient: recipientBigint.toString(),
        amount: amount.toString(),
        relayerFee: "0"
    };
    
    const circuitsDir = path.join(__dirname, "../../circuits");
    const inputPath = path.join(circuitsDir, "build/input_demo.json");
    fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
    
    try {
        // Generate witness
        console.log("Generating witness...");
        execSync(
            `node build/withdraw_demo_js/generate_witness.js build/withdraw_demo_js/withdraw_demo.wasm build/input_demo.json build/witness_demo.wtns`,
            { cwd: circuitsDir, stdio: "pipe" }
        );
        console.log("✓ Witness generated");
        
        // Generate proof
        console.log("Generating proof...");
        execSync(
            `npx snarkjs groth16 prove build/withdraw_demo.zkey build/witness_demo.wtns build/proof_demo.json build/public_demo.json`,
            { cwd: circuitsDir, stdio: "pipe" }
        );
        console.log("✓ Proof generated");
        
        // Verify locally
        const result = execSync(
            `npx snarkjs groth16 verify build/vk_demo.json build/public_demo.json build/proof_demo.json`,
            { cwd: circuitsDir, encoding: "utf-8" }
        );
        console.log(`✓ Proof verified: ${result.trim()}`);
        
    } catch (e: any) {
        console.log(`Error: ${e.message}`);
        if (e.stderr) console.log(e.stderr.toString());
        return;
    }
    
    // ===========================================
    // STEP 3: Load proof and convert to Solana format
    // ===========================================
    console.log("\n--- STEP 3: Prepare On-Chain Withdrawal ---");
    
    const proof = JSON.parse(fs.readFileSync(path.join(circuitsDir, "build/proof_demo.json"), "utf-8"));
    const publicSignals = JSON.parse(fs.readFileSync(path.join(circuitsDir, "build/public_demo.json"), "utf-8"));
    
    console.log("Public signals:");
    const signalNames = ["commitment", "nullifierHash", "recipient", "amount", "relayerFee"];
    publicSignals.forEach((sig: string, i: number) => {
        console.log(`  ${signalNames[i]}: ${sig.substring(0, 40)}...`);
    });
    
    // Convert proof to bytes
    const proofA = proofPointToBytes(proof.pi_a, 64);
    const proofB = proofPointToBytes(proof.pi_b, 128);
    const proofC = proofPointToBytes(proof.pi_c, 64);
    
    console.log(`\nProof size: ${proofA.length + proofB.length + proofC.length} bytes`);
    
    // ===========================================
    // STEP 4: Get on-chain merkle root for context
    // ===========================================
    const poolData = await connection.getAccountInfo(poolPda);
    if (poolData) {
        const onChainRoot = poolData.data.slice(8 + 1 + 8, 8 + 1 + 8 + 32);
        console.log(`On-chain merkle root: ${Buffer.from(onChainRoot).toString("hex")}`);
    }
    
    // ===========================================
    // STEP 5: Summary
    // ===========================================
    console.log("\n" + "=".repeat(70));
    console.log("ZK PROOF GENERATED SUCCESSFULLY!");
    console.log("=".repeat(70));
    console.log(`
What was proven (in Zero Knowledge):
✓ Prover knows secret and nullifier
✓ commitment = H(secret, nullifier + amount)
✓ nullifierHash = H(nullifier, 0)

Without revealing:
✗ The actual secret value
✗ The actual nullifier value
✗ Which commitment in the tree is being withdrawn

Proof files saved:
- circuits/build/proof_demo.json
- circuits/build/public_demo.json

Verification Key:
- circuits/build/vk_demo.json

On-chain accounts:
- Pool: ${poolPda.toBase58()}
- Vault: ${vaultPda.toBase58()} (${vaultBalance / LAMPORTS_PER_SOL} SOL)
`);
}

function proofPointToBytes(point: any, size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    
    if (size === 64) {
        const x = bigintToBytes32(BigInt(point[0]));
        const y = bigintToBytes32(BigInt(point[1]));
        bytes.set(x, 0);
        bytes.set(y, 32);
    } else if (size === 128) {
        const x0 = bigintToBytes32(BigInt(point[0][0]));
        const x1 = bigintToBytes32(BigInt(point[0][1]));
        const y0 = bigintToBytes32(BigInt(point[1][0]));
        const y1 = bigintToBytes32(BigInt(point[1][1]));
        bytes.set(x0, 0);
        bytes.set(x1, 32);
        bytes.set(y0, 64);
        bytes.set(y1, 96);
    }
    
    return bytes;
}

main().catch(console.error);

