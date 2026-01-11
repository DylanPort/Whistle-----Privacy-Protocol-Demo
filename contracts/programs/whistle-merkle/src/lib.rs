use anchor_lang::prelude::*;

declare_id!("C81ewP6VfPibPEYWirQ9A18bCoceRdCXmMbXv33zm9vC");

/// Whistle Protocol - Merkle Tree Utilities
/// 
/// Provides standalone Merkle tree operations that can be used
/// by the main pool contract via CPI.

#[program]
pub mod whistle_merkle {
    use super::*;

    /// Compute Poseidon hash of two 32-byte inputs
    /// This is used for Merkle tree construction
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

/// Compute Poseidon hash
/// 
/// NOTE: This is a simplified implementation using Keccak.
/// For production, use actual Poseidon hash from `light-poseidon` crate.
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
            // Current hash is left child
            current_hash = compute_poseidon(&current_hash, element);
        } else {
            // Current hash is right child
            current_hash = compute_poseidon(element, &current_hash);
        }
    }
    
    current_hash
}

/// Pre-computed zero values for each tree level
/// These are the hashes of empty subtrees
pub const ZERO_VALUES: [[u8; 32]; 32] = {
    // In production, these should be actual Poseidon hashes
    // For now, using placeholder values
    let mut zeros = [[0u8; 32]; 32];
    // zeros[0] is the zero leaf value
    // zeros[1] = hash(zeros[0], zeros[0])
    // zeros[2] = hash(zeros[1], zeros[1])
    // etc.
    zeros
};

/// Compute the hash of an empty subtree at given level
pub fn get_zero_value(level: usize) -> [u8; 32] {
    if level == 0 {
        [0u8; 32]
    } else {
        // This should be pre-computed for efficiency
        let prev = get_zero_value(level - 1);
        compute_poseidon(&prev, &prev)
    }
}




declare_id!("C81ewP6VfPibPEYWirQ9A18bCoceRdCXmMbXv33zm9vC");

/// Whistle Protocol - Merkle Tree Utilities
/// 
/// Provides standalone Merkle tree operations that can be used
/// by the main pool contract via CPI.

#[program]
pub mod whistle_merkle {
    use super::*;

    /// Compute Poseidon hash of two 32-byte inputs
    /// This is used for Merkle tree construction
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

/// Compute Poseidon hash
/// 
/// NOTE: This is a simplified implementation using Keccak.
/// For production, use actual Poseidon hash from `light-poseidon` crate.
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
            // Current hash is left child
            current_hash = compute_poseidon(&current_hash, element);
        } else {
            // Current hash is right child
            current_hash = compute_poseidon(element, &current_hash);
        }
    }
    
    current_hash
}

/// Pre-computed zero values for each tree level
/// These are the hashes of empty subtrees
pub const ZERO_VALUES: [[u8; 32]; 32] = {
    // In production, these should be actual Poseidon hashes
    // For now, using placeholder values
    let mut zeros = [[0u8; 32]; 32];
    // zeros[0] is the zero leaf value
    // zeros[1] = hash(zeros[0], zeros[0])
    // zeros[2] = hash(zeros[1], zeros[1])
    // etc.
    zeros
};

/// Compute the hash of an empty subtree at given level
pub fn get_zero_value(level: usize) -> [u8; 32] {
    if level == 0 {
        [0u8; 32]
    } else {
        // This should be pre-computed for efficiency
        let prev = get_zero_value(level - 1);
        compute_poseidon(&prev, &prev)
    }
}


declare_id!("C81ewP6VfPibPEYWirQ9A18bCoceRdCXmMbXv33zm9vC");

/// Whistle Protocol - Merkle Tree Utilities
/// 
/// Provides standalone Merkle tree operations that can be used
/// by the main pool contract via CPI.

#[program]
pub mod whistle_merkle {
    use super::*;

    /// Compute Poseidon hash of two 32-byte inputs
    /// This is used for Merkle tree construction
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

/// Compute Poseidon hash
/// 
/// NOTE: This is a simplified implementation using Keccak.
/// For production, use actual Poseidon hash from `light-poseidon` crate.
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
            // Current hash is left child
            current_hash = compute_poseidon(&current_hash, element);
        } else {
            // Current hash is right child
            current_hash = compute_poseidon(element, &current_hash);
        }
    }
    
    current_hash
}

/// Pre-computed zero values for each tree level
/// These are the hashes of empty subtrees
pub const ZERO_VALUES: [[u8; 32]; 32] = {
    // In production, these should be actual Poseidon hashes
    // For now, using placeholder values
    let mut zeros = [[0u8; 32]; 32];
    // zeros[0] is the zero leaf value
    // zeros[1] = hash(zeros[0], zeros[0])
    // zeros[2] = hash(zeros[1], zeros[1])
    // etc.
    zeros
};

/// Compute the hash of an empty subtree at given level
pub fn get_zero_value(level: usize) -> [u8; 32] {
    if level == 0 {
        [0u8; 32]
    } else {
        // This should be pre-computed for efficiency
        let prev = get_zero_value(level - 1);
        compute_poseidon(&prev, &prev)
    }
}




declare_id!("C81ewP6VfPibPEYWirQ9A18bCoceRdCXmMbXv33zm9vC");

/// Whistle Protocol - Merkle Tree Utilities
/// 
/// Provides standalone Merkle tree operations that can be used
/// by the main pool contract via CPI.

#[program]
pub mod whistle_merkle {
    use super::*;

    /// Compute Poseidon hash of two 32-byte inputs
    /// This is used for Merkle tree construction
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

/// Compute Poseidon hash
/// 
/// NOTE: This is a simplified implementation using Keccak.
/// For production, use actual Poseidon hash from `light-poseidon` crate.
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
            // Current hash is left child
            current_hash = compute_poseidon(&current_hash, element);
        } else {
            // Current hash is right child
            current_hash = compute_poseidon(element, &current_hash);
        }
    }
    
    current_hash
}

/// Pre-computed zero values for each tree level
/// These are the hashes of empty subtrees
pub const ZERO_VALUES: [[u8; 32]; 32] = {
    // In production, these should be actual Poseidon hashes
    // For now, using placeholder values
    let mut zeros = [[0u8; 32]; 32];
    // zeros[0] is the zero leaf value
    // zeros[1] = hash(zeros[0], zeros[0])
    // zeros[2] = hash(zeros[1], zeros[1])
    // etc.
    zeros
};

/// Compute the hash of an empty subtree at given level
pub fn get_zero_value(level: usize) -> [u8; 32] {
    if level == 0 {
        [0u8; 32]
    } else {
        // This should be pre-computed for efficiency
        let prev = get_zero_value(level - 1);
        compute_poseidon(&prev, &prev)
    }
}

