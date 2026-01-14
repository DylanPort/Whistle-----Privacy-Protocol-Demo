/**
 * Converts snarkjs verification key to groth16-solana Rust format
 * Using BIG-ENDIAN format (what Solana syscalls expect)
 */

const fs = require('fs');
const path = require('path');

const vkPath = path.join(__dirname, 'build', 'verification_key_simple.json');
const vk = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));

function decimalTo32BytesBE(decimalStr) {
    const bn = BigInt(decimalStr);
    const hex = bn.toString(16).padStart(64, '0');
    const bytes = [];
    for (let i = 0; i < 64; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
}

// BIG-ENDIAN G1: [x_be, y_be] = 64 bytes
function formatG1BE(point) {
    const x = decimalTo32BytesBE(point[0]);
    const y = decimalTo32BytesBE(point[1]);
    return [...x, ...y];
}

// BIG-ENDIAN G2: snarkjs gives [[x_c0, x_c1], [y_c0, y_c1]]
// Solana expects: [x_c0_be, x_c1_be, y_c0_be, y_c1_be] = 128 bytes
function formatG2BE(point) {
    const x_c0 = decimalTo32BytesBE(point[0][0]);
    const x_c1 = decimalTo32BytesBE(point[0][1]);
    const y_c0 = decimalTo32BytesBE(point[1][0]);
    const y_c1 = decimalTo32BytesBE(point[1][1]);
    return [...x_c0, ...x_c1, ...y_c0, ...y_c1];
}

function toRustArray(bytes, indent = '    ') {
    const lines = [];
    for (let i = 0; i < bytes.length; i += 16) {
        const chunk = bytes.slice(i, i + 16);
        const hex = chunk.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ');
        lines.push(indent + hex + ',');
    }
    return lines.join('\n');
}

let rust = `// ============================================================================
// VERIFICATION KEY - BIG-ENDIAN FORMAT
// For groth16-solana with Solana alt_bn128 syscalls
// ============================================================================

use anchor_lang::prelude::*;
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

pub const NUM_PUBLIC_INPUTS: usize = 5;

pub const VK_ALPHA_G1: [u8; 64] = [
${toRustArray(formatG1BE([vk.vk_alpha_1[0], vk.vk_alpha_1[1]]))}
];

pub const VK_BETA_G2: [u8; 128] = [
${toRustArray(formatG2BE(vk.vk_beta_2))}
];

pub const VK_GAMMA_G2: [u8; 128] = [
${toRustArray(formatG2BE(vk.vk_gamma_2))}
];

pub const VK_DELTA_G2: [u8; 128] = [
${toRustArray(formatG2BE(vk.vk_delta_2))}
];

`;

for (let i = 0; i < vk.IC.length; i++) {
    rust += `pub const IC_${i}: [u8; 64] = [
${toRustArray(formatG1BE([vk.IC[i][0], vk.IC[i][1]]))}
];

`;
}

rust += `pub fn get_withdraw_verifying_key() -> Groth16Verifyingkey<'static> {
    static VK_IC: [[u8; 64]; ${vk.IC.length}] = [${vk.IC.map((_, i) => `IC_${i}`).join(', ')}];
    
    Groth16Verifyingkey {
        nr_pubinputs: NUM_PUBLIC_INPUTS,
        vk_alpha_g1: VK_ALPHA_G1,
        vk_beta_g2: VK_BETA_G2,
        vk_gamme_g2: VK_GAMMA_G2,
        vk_delta_g2: VK_DELTA_G2,
        vk_ic: &VK_IC,
    }
}

pub fn verify_withdraw_proof_groth16(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    commitment: &[u8; 32],
    nullifier_hash: &[u8; 32],
    recipient: &[u8; 32],
    amount: u64,
    relayer_fee: u64,
) -> anchor_lang::Result<bool> {
    msg!("Verifying Groth16 ZK proof (BE format)...");
    
    let mut amount_bytes = [0u8; 32];
    amount_bytes[24..].copy_from_slice(&amount.to_be_bytes());
    
    let mut fee_bytes = [0u8; 32];
    fee_bytes[24..].copy_from_slice(&relayer_fee.to_be_bytes());
    
    let public_inputs: [[u8; 32]; NUM_PUBLIC_INPUTS] = [
        *commitment,
        *nullifier_hash,
        *recipient,
        amount_bytes,
        fee_bytes,
    ];
    
    let vk = get_withdraw_verifying_key();
    
    let mut verifier = Groth16Verifier::<NUM_PUBLIC_INPUTS>::new(
        proof_a,
        proof_b,
        proof_c,
        &public_inputs,
        &vk,
    ).map_err(|e| {
        msg!("Verifier creation failed: {:?}", e);
        anchor_lang::error!(crate::WhistleError::InvalidProof)
    })?;
    
    verifier.prepare_inputs::<true>().map_err(|e| {
        msg!("Prepare inputs failed: {:?}", e);
        anchor_lang::error!(crate::WhistleError::InvalidProof)
    })?;
    
    verifier.verify().map_err(|e| {
        msg!("Verification failed: {:?}", e);
        anchor_lang::error!(crate::WhistleError::InvalidProof)
    })?;
    
    msg!("✅ ZK proof verified!");
    Ok(true)
}
`;

fs.writeFileSync(path.join(__dirname, 'vk_be.rs'), rust);
console.log('Generated vk_be.rs (big-endian format)');

