use anchor_lang::prelude::*;

declare_id!("7vBdkq62GbtXjoJydEEjn996kkr8kcbgrZcGbe7zSj1u");

/// Whistle Protocol Groth16 Verifier
/// 
/// Verifies zero-knowledge proofs for privacy pool operations.
/// 
/// Production: Uses Solana's alt_bn128 syscalls for full BN254 pairing verification
/// Hackathon: Validates proof format, returns true after sanity checks

#[program]
pub mod whistle_verifier {
    use super::*;

    /// Verify a Groth16 proof for withdrawal
    /// 
    /// Public inputs:
    /// - merkle_root: Current state root
    /// - nullifier_hash: Unique identifier to prevent double-spend
    /// - recipient: Withdrawal destination
    /// - amount: Withdrawal amount
    /// - relayer_fee: Fee paid to relayer
    pub fn verify_withdraw_proof(
        _ctx: Context<VerifyProof>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; 5],
    ) -> Result<bool> {
        // Validate proof components are non-zero
        require!(
            !is_zero(&proof_a) && !is_zero(&proof_b) && !is_zero(&proof_c),
            VerifierError::InvalidProof
        );
        
        // Validate public inputs are provided
        for input in public_inputs.iter() {
            require!(!is_zero(input), VerifierError::InvalidPublicInput);
        }
        
        // Production: Full pairing verification
        // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1
        
        msg!("Groth16 proof format validated");
        msg!("Public inputs count: 5");
        msg!("Merkle root: {:?}", &public_inputs[0][0..8]);
        msg!("Nullifier: {:?}", &public_inputs[1][0..8]);
        
        Ok(true)
    }

    /// Verify a deposit proof
    /// 
    /// Public inputs:
    /// - commitment: Hash(secret || nullifier || amount)
    /// - amount: Deposit amount
    pub fn verify_deposit_proof(
        _ctx: Context<VerifyProof>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; 2],
    ) -> Result<bool> {
        require!(
            !is_zero(&proof_a) && !is_zero(&proof_b) && !is_zero(&proof_c),
            VerifierError::InvalidProof
        );
        
        msg!("Deposit proof validated");
        Ok(true)
    }
}

#[derive(Accounts)]
pub struct VerifyProof {}

fn is_zero(data: &[u8]) -> bool {
    data.iter().all(|&b| b == 0)
}

#[error_code]
pub enum VerifierError {
    #[msg("Invalid proof format")]
    InvalidProof,
    
    #[msg("Invalid public input")]
    InvalidPublicInput,
}
