use anchor_lang::prelude::*;

declare_id!("GSCeQ9qUybayPEUULjBu7Gk8p89g97FkoGgTeUE11tmk");

/// Whistle Protocol - Merkle Tree Utilities

#[program]
pub mod whistle_merkle {
    use super::*;

    /// Compute Poseidon hash of two 32-byte inputs
    pub fn poseidon_hash(
        _ctx: Context<PoseidonHash>,
        left: [u8; 32],
        right: [u8; 32],
    ) -> Result<[u8; 32]> {
        Ok(compute_poseidon(&left, &right))
    }

    /// Verify a Merkle proof
    pub fn verify_merkle_proof(
        _ctx: Context<VerifyMerkleProof>,
        leaf: [u8; 32],
        path_elements: Vec<[u8; 32]>,
        path_indices: Vec<u8>,
        root: [u8; 32],
    ) -> Result<bool> {
        let computed_root = compute_merkle_root(&leaf, &path_elements, &path_indices);
        Ok(computed_root == root)
    }
}

#[derive(Accounts)]
pub struct PoseidonHash {}

#[derive(Accounts)]
pub struct VerifyMerkleProof {}

/// Compute Poseidon hash (using keccak placeholder)
pub fn compute_poseidon(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    use anchor_lang::solana_program::keccak;
    
    let mut input = [0u8; 64];
    input[..32].copy_from_slice(left);
    input[32..].copy_from_slice(right);
    
    keccak::hash(&input).to_bytes()
}

/// Compute Merkle root from leaf and proof
pub fn compute_merkle_root(
    leaf: &[u8; 32],
    path_elements: &[[u8; 32]],
    path_indices: &[u8],
) -> [u8; 32] {
    let mut current_hash = *leaf;
    
    for (i, element) in path_elements.iter().enumerate() {
        if path_indices[i] == 0 {
            current_hash = compute_poseidon(&current_hash, element);
        } else {
            current_hash = compute_poseidon(element, &current_hash);
        }
    }
    
    current_hash
}

/// Get zero value for tree level
pub fn get_zero_value(level: usize) -> [u8; 32] {
    if level == 0 {
        [0u8; 32]
    } else {
        let prev = get_zero_value(level - 1);
        compute_poseidon(&prev, &prev)
    }
}
