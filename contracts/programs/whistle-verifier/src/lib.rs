use anchor_lang::prelude::*;
use anchor_lang::solana_program::alt_bn128::prelude::*;

declare_id!("C6cKqUzwMdL5Tm9vNsYNjPwZjprthyypywmgne3RkSD4");

/// Whistle Protocol Groth16 Verifier
/// 
/// Real zero-knowledge proof verification using Solana's alt_bn128 syscalls.
/// Verifies Groth16 proofs on the BN254 (alt_bn128) elliptic curve.
///
/// Verification equation:
/// e(A, B) = e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
/// 
/// Or equivalently (batch pairing):
/// e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1

#[program]
pub mod whistle_verifier {
    use super::*;

    /// Verify a Groth16 withdrawal proof
    pub fn verify_withdraw_proof(
        _ctx: Context<VerifyProof>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<bool> {
        require!(public_inputs.len() == 5, VerifierError::InvalidPublicInputCount);
        
        let vk = get_withdraw_verification_key();
        
        let result = verify_groth16_proof(
            &proof_a,
            &proof_b,
            &proof_c,
            &public_inputs,
            &vk,
        )?;
        
        require!(result, VerifierError::ProofVerificationFailed);
        
        msg!("Groth16 proof verified successfully");
        Ok(true)
    }

    /// Verify a Groth16 deposit proof
    pub fn verify_deposit_proof(
        _ctx: Context<VerifyProof>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<bool> {
        require!(public_inputs.len() == 2, VerifierError::InvalidPublicInputCount);
        
        let vk = get_deposit_verification_key();
        
        let result = verify_groth16_proof(
            &proof_a,
            &proof_b,
            &proof_c,
            &public_inputs,
            &vk,
        )?;
        
        require!(result, VerifierError::ProofVerificationFailed);
        
        msg!("Deposit proof verified successfully");
        Ok(true)
    }
}

#[derive(Accounts)]
pub struct VerifyProof {}

// ============================================================================
// VERIFICATION KEY STRUCTURE
// ============================================================================

/// Groth16 Verification Key
/// Contains the public parameters from trusted setup
pub struct VerificationKey {
    /// G1 point: alpha (from trusted setup)
    pub alpha_g1: [u8; 64],
    /// G2 point: beta (from trusted setup)
    pub beta_g2: [u8; 128],
    /// G2 point: gamma (from trusted setup)
    pub gamma_g2: [u8; 128],
    /// G2 point: delta (from trusted setup)
    pub delta_g2: [u8; 128],
    /// G1 points: IC (input commitments)
    /// IC[0] + sum(public_input[i] * IC[i+1])
    pub ic: Vec<[u8; 64]>,
}

// ============================================================================
// GROTH16 VERIFICATION
// ============================================================================

/// Verify a Groth16 proof using alt_bn128 syscalls
/// 
/// Verification equation:
/// e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1
fn verify_groth16_proof(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]],
    vk: &VerificationKey,
) -> Result<bool> {
    // Validate IC length matches public inputs + 1
    require!(
        vk.ic.len() == public_inputs.len() + 1,
        VerifierError::InvalidVerificationKey
    );

    // Step 1: Compute vk_x = IC[0] + sum(public_input[i] * IC[i+1])
    let vk_x = compute_linear_combination(&vk.ic, public_inputs)?;

    // Step 2: Negate proof point A (for pairing equation)
    let neg_a = negate_g1_point(proof_a)?;

    // Step 3: Prepare pairing inputs
    // Pairing check: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1
    let mut pairing_input = Vec::with_capacity(4 * (64 + 128));
    
    // Pair 1: e(-A, B)
    pairing_input.extend_from_slice(&neg_a);
    pairing_input.extend_from_slice(proof_b);
    
    // Pair 2: e(alpha, beta)
    pairing_input.extend_from_slice(&vk.alpha_g1);
    pairing_input.extend_from_slice(&vk.beta_g2);
    
    // Pair 3: e(vk_x, gamma)
    pairing_input.extend_from_slice(&vk_x);
    pairing_input.extend_from_slice(&vk.gamma_g2);
    
    // Pair 4: e(C, delta)
    pairing_input.extend_from_slice(proof_c);
    pairing_input.extend_from_slice(&vk.delta_g2);

    // Step 4: Execute pairing check
    let pairing_result = alt_bn128_pairing(&pairing_input)
        .map_err(|_| error!(VerifierError::PairingFailed))?;

    // Pairing returns 1 (as 32-byte big-endian) if equation holds
    let one = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ];
    
    Ok(pairing_result == one)
}

/// Compute vk_x = IC[0] + sum(public_input[i] * IC[i+1])
/// This is a linear combination of G1 points
fn compute_linear_combination(
    ic: &[[u8; 64]],
    public_inputs: &[[u8; 32]],
) -> Result<[u8; 64]> {
    // Start with IC[0]
    let mut result = ic[0];

    // Add public_input[i] * IC[i+1] for each input
    for (i, input) in public_inputs.iter().enumerate() {
        // Scalar multiplication: input * IC[i+1]
        let mut mul_input = Vec::with_capacity(96);
        mul_input.extend_from_slice(&ic[i + 1]);
        mul_input.extend_from_slice(input);

        let product = alt_bn128_multiplication(&mul_input)
            .map_err(|_| error!(VerifierError::ScalarMulFailed))?;

        // Point addition: result + product
        let mut add_input = Vec::with_capacity(128);
        add_input.extend_from_slice(&result);
        add_input.extend_from_slice(&product);

        let sum = alt_bn128_addition(&add_input)
            .map_err(|_| error!(VerifierError::PointAdditionFailed))?;

        result.copy_from_slice(&sum);
    }

    Ok(result)
}

/// Negate a G1 point (flip y-coordinate in the field)
/// For BN254: -P = (x, p - y) where p is the field modulus
fn negate_g1_point(point: &[u8; 64]) -> Result<[u8; 64]> {
    // BN254 field modulus p
    let p: [u8; 32] = [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
        0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
        0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
        0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
    ];

    let mut result = *point;
    
    // y-coordinate is in bytes 32-63
    let y = &point[32..64];
    
    // Compute p - y (big-endian subtraction)
    let neg_y = field_sub(&p, y)?;
    result[32..64].copy_from_slice(&neg_y);

    Ok(result)
}

/// Subtract two field elements (big-endian): a - b mod p
fn field_sub(a: &[u8; 32], b: &[u8]) -> Result<[u8; 32]> {
    let mut result = [0u8; 32];
    let mut borrow: i16 = 0;

    // Subtract from least significant byte
    for i in (0..32).rev() {
        let b_val = if i < b.len() { b[i] as i16 } else { 0 };
        let diff = (a[i] as i16) - b_val - borrow;
        
        if diff < 0 {
            result[i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            result[i] = diff as u8;
            borrow = 0;
        }
    }

    Ok(result)
}

// ============================================================================
// VERIFICATION KEYS (FROM TRUSTED SETUP)
// ============================================================================

/// Get verification key for withdrawal circuit
/// These values come from the trusted setup ceremony
fn get_withdraw_verification_key() -> VerificationKey {
    // NOTE: These are placeholder values
    // In production, replace with actual verification key from:
    // circuits/build/withdraw_verification_key.json
    
    VerificationKey {
        // Alpha G1 point
        alpha_g1: hex_to_g1("0x2d4d9aa7e302d9df41749d5507949d05dbea33fbb16c643b22f599a2be6df2e214bedd503c37ceb061d8ec60209fe345ce89830a19230301f076caff004d1926"),
        
        // Beta G2 point  
        beta_g2: hex_to_g2("0x0967032fcbf776d1afc985f88877f182d38480a653f2decaa9794cbc3bf3060c0e187847ad4c798374d0d6732bf501847dd68bc0e071241e0213bc7fc13db7ab304cfbd1e08a704a99f5e847d93f8c3caafddec46b7a0d379da69a4d112346a71739c1b1a457a8c7313123d24d2f9192f896b7c63eea05a9d57f06547ad0cec8"),
        
        // Gamma G2 point
        gamma_g2: hex_to_g2("0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"),
        
        // Delta G2 point
        delta_g2: hex_to_g2("0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"),
        
        // IC points (6 points for 5 public inputs)
        ic: vec![
            hex_to_g1("0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200"),
            hex_to_g1("0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200"),
            hex_to_g1("0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200"),
            hex_to_g1("0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200"),
            hex_to_g1("0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200"),
            hex_to_g1("0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200"),
        ],
    }
}

/// Get verification key for deposit circuit
fn get_deposit_verification_key() -> VerificationKey {
    // Deposit circuit has 2 public inputs
    VerificationKey {
        alpha_g1: hex_to_g1("0x2d4d9aa7e302d9df41749d5507949d05dbea33fbb16c643b22f599a2be6df2e214bedd503c37ceb061d8ec60209fe345ce89830a19230301f076caff004d1926"),
        beta_g2: hex_to_g2("0x0967032fcbf776d1afc985f88877f182d38480a653f2decaa9794cbc3bf3060c0e187847ad4c798374d0d6732bf501847dd68bc0e071241e0213bc7fc13db7ab304cfbd1e08a704a99f5e847d93f8c3caafddec46b7a0d379da69a4d112346a71739c1b1a457a8c7313123d24d2f9192f896b7c63eea05a9d57f06547ad0cec8"),
        gamma_g2: hex_to_g2("0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"),
        delta_g2: hex_to_g2("0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"),
        ic: vec![
            hex_to_g1("0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200"),
            hex_to_g1("0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200"),
            hex_to_g1("0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200"),
        ],
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Convert hex string to G1 point bytes
fn hex_to_g1(hex: &str) -> [u8; 64] {
    let hex = hex.trim_start_matches("0x");
    let mut bytes = [0u8; 64];
    for i in 0..64 {
        bytes[i] = u8::from_str_radix(&hex[i*2..i*2+2], 16).unwrap_or(0);
    }
    bytes
}

/// Convert hex string to G2 point bytes
fn hex_to_g2(hex: &str) -> [u8; 128] {
    let hex = hex.trim_start_matches("0x");
    let mut bytes = [0u8; 128];
    for i in 0..128 {
        bytes[i] = u8::from_str_radix(&hex[i*2..i*2+2], 16).unwrap_or(0);
    }
    bytes
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum VerifierError {
    #[msg("Invalid public input count")]
    InvalidPublicInputCount,
    
    #[msg("Invalid verification key")]
    InvalidVerificationKey,
    
    #[msg("Proof verification failed")]
    ProofVerificationFailed,
    
    #[msg("Pairing check failed")]
    PairingFailed,
    
    #[msg("Scalar multiplication failed")]
    ScalarMulFailed,
    
    #[msg("Point addition failed")]
    PointAdditionFailed,
}
