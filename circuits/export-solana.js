const fs = require('fs');

// Read proof and public signals
const proof = JSON.parse(fs.readFileSync('build/proof.json'));
const publicSignals = JSON.parse(fs.readFileSync('build/public.json'));
const vk = JSON.parse(fs.readFileSync('build/verification_key.json'));

console.log("=".repeat(60));
console.log("GROTH16 PROOF FOR SOLANA");
console.log("=".repeat(60));

// BN254 base field prime for curve points (Fq)
const BN254_BASE_FIELD = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');

// Convert proof points to bytes
function bigIntToBytes(str, size) {
    let n = BigInt(str);
    const bytes = new Uint8Array(size);
    for (let i = size - 1; i >= 0; i--) {
        bytes[i] = Number(n & 0xffn);
        n >>= 8n;
    }
    return bytes;
}

function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Proof A (G1 point): 64 bytes (negated Y for groth16-solana)
const proofA_x = bigIntToBytes(proof.pi_a[0], 32);
const proofA_y = BigInt(proof.pi_a[1]) % BN254_BASE_FIELD;
const proofA_y_neg = proofA_y === 0n ? 0n : BN254_BASE_FIELD - proofA_y;
const proofA = new Uint8Array([...proofA_x, ...bigIntToBytes(proofA_y_neg.toString(), 32)]);

// Proof B (G2 point): 128 bytes
// G2 has coordinates in Fp2 (each coordinate is 2 field elements)
const proofB_x0 = bigIntToBytes(proof.pi_b[0][0], 32);
const proofB_x1 = bigIntToBytes(proof.pi_b[0][1], 32);
const proofB_y0 = bigIntToBytes(proof.pi_b[1][0], 32);
const proofB_y1 = bigIntToBytes(proof.pi_b[1][1], 32);
const proofB = new Uint8Array([...proofB_x0, ...proofB_x1, ...proofB_y0, ...proofB_y1]);

// Proof C (G1 point): 64 bytes
const proofC_x = bigIntToBytes(proof.pi_c[0], 32);
const proofC_y = bigIntToBytes(proof.pi_c[1], 32);
const proofC = new Uint8Array([...proofC_x, ...proofC_y]);

console.log("\n--- PROOF (hex) ---");
console.log("\nProof A (64 bytes - G1):");
console.log(toHex(proofA));

console.log("\nProof B (128 bytes - G2):");
console.log(toHex(proofB));

console.log("\nProof C (64 bytes - G1):");
console.log(toHex(proofC));

console.log("\n--- PUBLIC SIGNALS ---");
const signalNames = ["merkleRoot", "nullifierHash", "recipient", "amount", "relayerFee"];
publicSignals.forEach((sig, i) => {
    console.log(`${signalNames[i]}: ${sig}`);
});

console.log("\n--- PROOF (byte arrays for Solana) ---");
console.log("\nproof_a:", JSON.stringify(Array.from(proofA)));
console.log("\nproof_b:", JSON.stringify(Array.from(proofB)));
console.log("\nproof_c:", JSON.stringify(Array.from(proofC)));

// Also output public inputs as 32-byte arrays
console.log("\n--- PUBLIC INPUTS AS BYTES ---");
publicSignals.forEach((sig, i) => {
    const bytes = bigIntToBytes(sig, 32);
    console.log(`${signalNames[i]}: ${toHex(bytes)}`);
});

// Export Verification Key
console.log("\n" + "=".repeat(60));
console.log("VERIFICATION KEY");
console.log("=".repeat(60));

// Alpha G1
const alpha_x = bigIntToBytes(vk.vk_alpha_1[0], 32);
const alpha_y = bigIntToBytes(vk.vk_alpha_1[1], 32);
console.log("\nAlpha G1:");
console.log(toHex(new Uint8Array([...alpha_x, ...alpha_y])));

// Beta G2
console.log("\nBeta G2:");
const beta_x0 = bigIntToBytes(vk.vk_beta_2[0][0], 32);
const beta_x1 = bigIntToBytes(vk.vk_beta_2[0][1], 32);
const beta_y0 = bigIntToBytes(vk.vk_beta_2[1][0], 32);
const beta_y1 = bigIntToBytes(vk.vk_beta_2[1][1], 32);
console.log(toHex(new Uint8Array([...beta_x0, ...beta_x1, ...beta_y0, ...beta_y1])));

// Gamma G2
console.log("\nGamma G2:");
const gamma_x0 = bigIntToBytes(vk.vk_gamma_2[0][0], 32);
const gamma_x1 = bigIntToBytes(vk.vk_gamma_2[0][1], 32);
const gamma_y0 = bigIntToBytes(vk.vk_gamma_2[1][0], 32);
const gamma_y1 = bigIntToBytes(vk.vk_gamma_2[1][1], 32);
console.log(toHex(new Uint8Array([...gamma_x0, ...gamma_x1, ...gamma_y0, ...gamma_y1])));

// Delta G2
console.log("\nDelta G2:");
const delta_x0 = bigIntToBytes(vk.vk_delta_2[0][0], 32);
const delta_x1 = bigIntToBytes(vk.vk_delta_2[0][1], 32);
const delta_y0 = bigIntToBytes(vk.vk_delta_2[1][0], 32);
const delta_y1 = bigIntToBytes(vk.vk_delta_2[1][1], 32);
console.log(toHex(new Uint8Array([...delta_x0, ...delta_x1, ...delta_y0, ...delta_y1])));

// IC points
console.log("\nIC points (G1):");
vk.IC.forEach((ic, i) => {
    const ic_x = bigIntToBytes(ic[0], 32);
    const ic_y = bigIntToBytes(ic[1], 32);
    console.log(`IC[${i}]: ${toHex(new Uint8Array([...ic_x, ...ic_y]))}`);
});

// Save to file
const solanaData = {
    proof: {
        a: Array.from(proofA),
        b: Array.from(proofB),
        c: Array.from(proofC)
    },
    publicSignals: publicSignals,
    verificationKey: {
        alpha: toHex(new Uint8Array([...alpha_x, ...alpha_y])),
        beta: toHex(new Uint8Array([...beta_x0, ...beta_x1, ...beta_y0, ...beta_y1])),
        gamma: toHex(new Uint8Array([...gamma_x0, ...gamma_x1, ...gamma_y0, ...gamma_y1])),
        delta: toHex(new Uint8Array([...delta_x0, ...delta_x1, ...delta_y0, ...delta_y1])),
        ic: vk.IC.map(ic => {
            const x = bigIntToBytes(ic[0], 32);
            const y = bigIntToBytes(ic[1], 32);
            return toHex(new Uint8Array([...x, ...y]));
        })
    }
};

fs.writeFileSync('build/solana_proof.json', JSON.stringify(solanaData, null, 2));
console.log("\n✓ Saved to build/solana_proof.json");

