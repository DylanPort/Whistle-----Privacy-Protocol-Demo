const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BUILD_DIR = "./build";

async function main() {
    console.log("=".repeat(60));
    console.log("WHISTLE PROTOCOL - ZK PROOF GENERATION");
    console.log("=".repeat(60));
    
    // Create build directory
    if (!fs.existsSync(BUILD_DIR)) {
        fs.mkdirSync(BUILD_DIR, { recursive: true });
    }
    
    // Step 1: Compile circuit
    console.log("\n[1/5] Compiling circuit...");
    try {
        execSync(`circom withdraw_simple.circom --r1cs --wasm --sym -o ${BUILD_DIR}`, { 
            stdio: "inherit" 
        });
        console.log("✓ Circuit compiled");
    } catch (e) {
        console.error("Circuit compilation failed:", e.message);
        return;
    }
    
    // Step 2: Download powers of tau (or use existing)
    console.log("\n[2/5] Setting up powers of tau...");
    const ptauPath = path.join(BUILD_DIR, "pot12_final.ptau");
    
    if (!fs.existsSync(ptauPath)) {
        console.log("Generating powers of tau (this takes a moment)...");
        await snarkjs.powersOfTau.newAccumulator(12, ptauPath + ".0");
        await snarkjs.powersOfTau.contribute(ptauPath + ".0", ptauPath + ".1", "contribution1", "random entropy 1234");
        await snarkjs.powersOfTau.preparePhase2(ptauPath + ".1", ptauPath);
        // Clean up intermediate files
        try { fs.unlinkSync(ptauPath + ".0"); } catch {}
        try { fs.unlinkSync(ptauPath + ".1"); } catch {}
    }
    console.log("✓ Powers of tau ready");
    
    // Step 3: Generate zkey
    console.log("\n[3/5] Generating proving key (zkey)...");
    const r1csPath = path.join(BUILD_DIR, "withdraw_simple.r1cs");
    const zkeyPath = path.join(BUILD_DIR, "withdraw_simple.zkey");
    const zkeyFinalPath = path.join(BUILD_DIR, "withdraw_simple_final.zkey");
    
    await snarkjs.zKey.newZKey(r1csPath, ptauPath, zkeyPath);
    await snarkjs.zKey.contribute(zkeyPath, zkeyFinalPath, "contributor1", "random entropy 5678");
    console.log("✓ Proving key generated");
    
    // Step 4: Export verification key
    console.log("\n[4/5] Exporting verification key...");
    const vkPath = path.join(BUILD_DIR, "verification_key.json");
    const vk = await snarkjs.zKey.exportVerificationKey(zkeyFinalPath);
    fs.writeFileSync(vkPath, JSON.stringify(vk, null, 2));
    console.log("✓ Verification key exported");
    
    // Step 5: Generate proof with test inputs
    console.log("\n[5/5] Generating ZK proof...");
    
    // Test inputs matching our deposit
    const secret = BigInt("12345678901234567890");
    const nullifier = BigInt("98765432109876543210");
    const amount = BigInt(1000000000); // 1 SOL in lamports
    const recipient = BigInt("0x" + Buffer.from("C33M8xJS2P1w1EQRZ5dW58ZX7GZCoXiKVNk4x7ENx1oj").toString("hex").substring(0, 40));
    const relayerFee = BigInt(0);
    
    // Compute commitment
    const commitment = secret * nullifier + amount;
    
    // Compute nullifier hash
    const nullifierHash = nullifier * nullifier;
    
    // Build merkle path (simplified - in production would be real path)
    const levels = 16;
    const pathElements = [];
    const pathIndices = [];
    
    let currentHash = commitment;
    for (let i = 0; i < levels; i++) {
        pathElements.push(BigInt(i + 1)); // Sibling nodes
        pathIndices.push(0); // All left
        
        // Compute next level
        const left = currentHash;
        const right = BigInt(i + 1);
        currentHash = left * right + BigInt(i);
    }
    
    const merkleRoot = currentHash;
    
    const input = {
        // Private
        secret: secret.toString(),
        nullifier: nullifier.toString(),
        pathElements: pathElements.map(x => x.toString()),
        pathIndices: pathIndices.map(x => x.toString()),
        // Public
        merkleRoot: merkleRoot.toString(),
        nullifierHash: nullifierHash.toString(),
        recipient: recipient.toString(),
        amount: amount.toString(),
        relayerFee: relayerFee.toString()
    };
    
    // Save input for reference
    fs.writeFileSync(path.join(BUILD_DIR, "input.json"), JSON.stringify(input, null, 2));
    
    // Generate witness
    const wasmPath = path.join(BUILD_DIR, "withdraw_simple_js", "withdraw_simple.wasm");
    const { wtns } = await snarkjs.wtns.calculate(input, wasmPath, null);
    
    // Generate proof
    const { proof, publicSignals } = await snarkjs.groth16.prove(zkeyFinalPath, wtns);
    
    // Save proof
    fs.writeFileSync(path.join(BUILD_DIR, "proof.json"), JSON.stringify(proof, null, 2));
    fs.writeFileSync(path.join(BUILD_DIR, "public.json"), JSON.stringify(publicSignals, null, 2));
    
    console.log("✓ Proof generated!");
    
    // Verify proof locally
    console.log("\n[Verification] Testing proof locally...");
    const verified = await snarkjs.groth16.verify(vk, publicSignals, proof);
    console.log(`✓ Proof verified: ${verified}`);
    
    // Export for Solana
    console.log("\n" + "=".repeat(60));
    console.log("PROOF FOR SOLANA ON-CHAIN VERIFICATION");
    console.log("=".repeat(60));
    
    // Convert proof to Solana format (big-endian bytes)
    const proofA = pointToBytes(proof.pi_a, 64);
    const proofB = pointToBytes(proof.pi_b, 128);
    const proofC = pointToBytes(proof.pi_c, 64);
    
    console.log("\nProof A (G1 - 64 bytes):");
    console.log(Buffer.from(proofA).toString("hex"));
    
    console.log("\nProof B (G2 - 128 bytes):");
    console.log(Buffer.from(proofB).toString("hex"));
    
    console.log("\nProof C (G1 - 64 bytes):");
    console.log(Buffer.from(proofC).toString("hex"));
    
    console.log("\nPublic Signals:");
    publicSignals.forEach((sig, i) => {
        const names = ["merkleRoot", "nullifierHash", "recipient", "amount", "relayerFee"];
        console.log(`  ${names[i]}: ${sig}`);
    });
    
    // Save Solana-formatted proof
    const solanaProof = {
        proofA: Array.from(proofA),
        proofB: Array.from(proofB),
        proofC: Array.from(proofC),
        publicSignals: publicSignals,
        nullifierHash: nullifierHash.toString(),
        merkleRoot: merkleRoot.toString()
    };
    fs.writeFileSync(path.join(BUILD_DIR, "solana_proof.json"), JSON.stringify(solanaProof, null, 2));
    
    console.log("\n✓ Proof saved to build/solana_proof.json");
    console.log("\nVerification Key for On-Chain (alpha, beta, gamma, delta, IC):");
    console.log("  See build/verification_key.json");
}

function pointToBytes(point, size) {
    const bytes = new Uint8Array(size);
    
    if (size === 64) {
        // G1 point: x (32 bytes) + y (32 bytes)
        const x = BigInt(point[0]);
        const y = BigInt(point[1]);
        
        const xBytes = bigIntToBytes(x, 32);
        const yBytes = bigIntToBytes(y, 32);
        
        bytes.set(xBytes, 0);
        bytes.set(yBytes, 32);
    } else if (size === 128) {
        // G2 point: x (64 bytes as Fp2) + y (64 bytes as Fp2)
        // x = x0 + x1*u, y = y0 + y1*u
        const x0 = BigInt(point[0][0]);
        const x1 = BigInt(point[0][1]);
        const y0 = BigInt(point[1][0]);
        const y1 = BigInt(point[1][1]);
        
        bytes.set(bigIntToBytes(x0, 32), 0);
        bytes.set(bigIntToBytes(x1, 32), 32);
        bytes.set(bigIntToBytes(y0, 32), 64);
        bytes.set(bigIntToBytes(y1, 32), 96);
    }
    
    return bytes;
}

function bigIntToBytes(n, size) {
    const bytes = new Uint8Array(size);
    let temp = n;
    for (let i = size - 1; i >= 0; i--) {
        bytes[i] = Number(temp & 0xffn);
        temp >>= 8n;
    }
    return bytes;
}

main().catch(console.error);

