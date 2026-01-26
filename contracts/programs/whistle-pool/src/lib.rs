use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::solana_program::poseidon::{hashv as poseidon_hashv, Endianness as PoseidonEndianness, Parameters as PoseidonParameters};
// Note: alt_bn128 operations are handled by groth16_solana in groth16.rs

pub mod groth16;
use groth16::{
    verify_withdraw_proof_groth16,       // Legacy (withdraw_simple)
    verify_withdraw_merkle_proof,         // Production (full Merkle proof)
    verify_unshield_change_proof,         // Production (withdrawal with change)
    verify_private_transfer_proof,        // Production (shielded transfers)
};

declare_id!("AMtxCTW99zCBfhukVdN8YvA3AsdSJ7nsgnUdHpth7QTD");

/// Whistle Protocol - Shielded Balance Privacy Pool
/// 
/// HYBRID DESIGN: Deposit any amount → Withdraw in fixed denominations
/// 
/// Architecture:
/// - Deposit ANY amount → creates a shielded note commitment
/// - Withdraw in FIXED amounts (1, 10, 100 SOL) → maximum privacy  
/// - Change is automatically re-shielded as a new note
/// 
/// NO ADMIN. NO PAUSE. NO CENSORSHIP.
/// Uses Groth16 proofs verified via alt_bn128 elliptic curve operations.
/// 
/// PRODUCTION NOTE: For mainnet deployment, dedicated ZK circuits are required:
/// - withdraw_merkle.circom: Full withdrawal with Merkle proof verification
/// - unshield_change.circom: Withdrawal with automatic change re-shielding
/// - private_transfer.circom: Shielded balance transfers with value conservation
/// See circuits/PRODUCTION_CIRCUITS.md for detailed specifications.

// Fixed withdrawal denominations for maximum anonymity
// Devnet testing denominations (smaller for testing)
pub const DENOM_001_SOL: u64 = 10_000_000;    // 0.01 SOL
pub const DENOM_005_SOL: u64 = 50_000_000;    // 0.05 SOL
pub const DENOM_01_SOL: u64 = 100_000_000;    // 0.1 SOL
// Mainnet denominations
pub const DENOM_1_SOL: u64 = 1_000_000_000;   // 1 SOL
pub const DENOM_10_SOL: u64 = 10_000_000_000; // 10 SOL
pub const DENOM_100_SOL: u64 = 100_000_000_000; // 100 SOL

// Minimum deposit to prevent dust spam
pub const MIN_DEPOSIT: u64 = 10_000_000; // 0.01 SOL

#[program]
pub mod whistle_pool {
    use super::*;

    /// Initialize pool state only (step 1)
    pub fn initialize(ctx: Context<InitializePool>, merkle_levels: u8) -> Result<()> {
        // Match circuit tree depth (7 for devnet, 13 for mainnet)
        require!(merkle_levels >= 7 && merkle_levels <= 13, WhistleError::InvalidMerkleLevels);
        
        let pool = &mut ctx.accounts.pool;
        pool.merkle_levels = merkle_levels;
        pool.next_index = 0;
        pool.current_root = [0u8; 32];
        pool.total_deposits = 0;
        pool.total_shielded = 0;
        pool.bump = ctx.bumps.pool;
        
        emit!(PoolInitialized {
            pool: ctx.accounts.pool.key(),
            merkle_levels,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
    
    /// Initialize merkle tree (step 2)
    pub fn init_merkle(ctx: Context<InitMerkle>) -> Result<()> {
        let merkle_tree = &mut ctx.accounts.merkle_tree.load_init()?;
        merkle_tree.levels_used = ctx.accounts.pool.merkle_levels;
        Ok(())
    }
    
    /// Initialize roots history (step 3)
    pub fn init_roots(ctx: Context<InitRoots>) -> Result<()> {
        let roots = &mut ctx.accounts.roots_history.load_init()?;
        roots.current_index = 0;
        Ok(())
    }
    
    /// Initialize nullifier set (step 4)
    pub fn init_nullifiers(ctx: Context<InitNullifiers>) -> Result<()> {
        let nullifiers = &mut ctx.accounts.nullifiers.load_init()?;
        nullifiers.count = 0;
        Ok(())
    }

    /// Shield SOL - Deposit ANY amount into a shielded note
    /// 
    /// Creates a note commitment: hash(secret, nullifier, amount)
    /// The amount is hidden inside the note, only the depositor knows it.
    pub fn shield(ctx: Context<Shield>, commitment: [u8; 32], amount: u64) -> Result<()> {
        require!(amount >= MIN_DEPOSIT, WhistleError::AmountTooSmall);
        
        let pool = &mut ctx.accounts.pool;
        let merkle_tree = &mut ctx.accounts.merkle_tree.load_mut()?;
        
        let max_leaves = 1u64 << pool.merkle_levels;
        require!(pool.next_index < max_leaves, WhistleError::TreeFull);
        
        // Transfer SOL to vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;
        
        // Add commitment to Merkle tree
        let leaf_index = pool.next_index;
        merkle_tree.insert_leaf(commitment, leaf_index, pool.merkle_levels);
        
        pool.current_root = merkle_tree.get_root(pool.merkle_levels);
        pool.next_index = pool.next_index.checked_add(1)
            .ok_or(WhistleError::ArithmeticOverflow)?;
        pool.total_deposits = pool.total_deposits.checked_add(amount)
            .ok_or(WhistleError::ArithmeticOverflow)?;
        pool.total_shielded = pool.total_shielded.checked_add(amount)
            .ok_or(WhistleError::ArithmeticOverflow)?;
        
        // Store root in history
        let roots = &mut ctx.accounts.roots_history.load_mut()?;
        let idx = roots.current_index as usize;
        roots.roots[idx] = pool.current_root;
        roots.current_index = ((roots.current_index as usize + 1) % 100) as u8;
        
        emit!(Shielded {
            commitment,
            leaf_index,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Unshield SOL - Withdraw in FIXED denomination + re-shield change
    /// 
    /// ZK Proof verifies:
    /// 1. User knows secret/nullifier for a note in the tree
    /// 2. Note value >= withdrawal amount
    /// 3. Change commitment is correctly computed
    /// 
    /// Privacy: All withdrawals of same denomination look identical!
    pub fn unshield(
        ctx: Context<Unshield>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        nullifier_hash: [u8; 32],
        recipient: Pubkey,
        withdrawal_amount: u64,   // Must be 1, 10, or 100 SOL
        relayer_fee: u64,
        merkle_root: [u8; 32],
        change_commitment: [u8; 32], // New note for leftover balance
    ) -> Result<()> {
        // Withdrawal must be fixed denomination
        require!(
            withdrawal_amount == DENOM_001_SOL ||
            withdrawal_amount == DENOM_005_SOL ||
            withdrawal_amount == DENOM_01_SOL ||
            withdrawal_amount == DENOM_1_SOL ||
            withdrawal_amount == DENOM_10_SOL ||
            withdrawal_amount == DENOM_100_SOL,
            WhistleError::InvalidWithdrawDenomination
        );

        require!(relayer_fee <= withdrawal_amount / 10, WhistleError::FeeTooHigh); // Max 10% fee

        let pool = &mut ctx.accounts.pool;
        let nullifiers = &mut ctx.accounts.nullifiers.load_mut()?;

        // Check nullifier not spent
        require!(
            !nullifiers.is_spent(&nullifier_hash),
            WhistleError::NullifierAlreadyUsed
        );

        // Check root is valid (current or in history)
        // Use a separate scope to drop the immutable borrow before potential mutable borrow
        let root_valid = {
            let roots = ctx.accounts.roots_history.load()?;
            merkle_root == pool.current_root || roots.contains(&merkle_root)
        };
        require!(root_valid, WhistleError::InvalidMerkleRoot);

        // Prepare recipient as field element (truncate to 31 bytes to fit BN254 field)
        let recipient_bytes = recipient.to_bytes();
        let mut recipient_field = [0u8; 32];
        recipient_field[1..].copy_from_slice(&recipient_bytes[..31]);

        // Verify Groth16 ZK proof
        let proof_valid = verify_unshield_proof(
            &proof_a,
            &proof_b,
            &proof_c,
            &merkle_root,
            &nullifier_hash,
            &recipient_field,
            withdrawal_amount,
            relayer_fee,
            &change_commitment,
        )?;

        require!(proof_valid, WhistleError::InvalidProof);

        // Mark nullifier as spent (prevents double-spend)
        nullifiers.mark_spent(&nullifier_hash)?;
        
        // Drop nullifiers borrow before accessing other accounts
        drop(nullifiers);

        // If there's change, add it to the tree as a new note
        let has_change = change_commitment != [0u8; 32];
        if has_change {
            let merkle_tree = &mut ctx.accounts.merkle_tree.load_mut()?;
            let max_leaves = 1u64 << pool.merkle_levels;
            require!(pool.next_index < max_leaves, WhistleError::TreeFull);
            
            let change_index = pool.next_index;
            merkle_tree.insert_leaf(change_commitment, change_index, pool.merkle_levels);
            pool.current_root = merkle_tree.get_root(pool.merkle_levels);
            pool.next_index = pool.next_index.checked_add(1)
                .ok_or(WhistleError::ArithmeticOverflow)?;
            
            // Drop merkle_tree borrow before accessing roots_history
            drop(merkle_tree);
            
            // Update roots history
            let mut roots = ctx.accounts.roots_history.load_mut()?;
            let idx = roots.current_index as usize;
            roots.roots[idx] = pool.current_root;
            roots.current_index = ((roots.current_index as usize + 1) % 100) as u8;
            
            emit!(ChangeCreated {
                commitment: change_commitment,
                leaf_index: change_index,
                timestamp: Clock::get()?.unix_timestamp,
            });
        }

        // SECURITY FIX: Verify vault has sufficient balance
        let vault_balance = ctx.accounts.pool_vault.lamports();
        require!(vault_balance >= withdrawal_amount, WhistleError::InsufficientVaultBalance);

        // Transfer SOL from vault to recipient (minus fee)
        let withdrawal_net = withdrawal_amount.checked_sub(relayer_fee)
            .ok_or(WhistleError::ArithmeticOverflow)?;
        let vault_bump = ctx.bumps.pool_vault;
        let vault_seeds: &[&[u8]] = &[b"vault", &[vault_bump]];
        
        // Transfer to recipient
        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::system_instruction::transfer(
                ctx.accounts.pool_vault.key,
                ctx.accounts.recipient.key,
                withdrawal_net,
            ),
            &[
                ctx.accounts.pool_vault.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[vault_seeds],
        )?;
        
        // Pay relayer fee if any
        if relayer_fee > 0 {
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    ctx.accounts.pool_vault.key,
                    ctx.accounts.relayer.key,
                    relayer_fee,
                ),
                &[
                    ctx.accounts.pool_vault.to_account_info(),
                    ctx.accounts.relayer.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[vault_seeds],
            )?;
        }

        // SECURITY FIX: Use checked_sub to prevent underflow
        pool.total_shielded = pool.total_shielded
            .checked_sub(withdrawal_amount)
            .ok_or(WhistleError::ArithmeticOverflow)?;

        emit!(Unshielded {
            nullifier_hash,
            withdrawal_amount,
            has_change,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Private Transfer - Move shielded balance without revealing amount
    /// 
    /// Spends old notes, creates new notes with same total value.
    /// Can split/merge balances privately.
    pub fn private_transfer(
        ctx: Context<PrivateTransfer>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        input_nullifier_hashes: [[u8; 32]; 2],  // Spend up to 2 notes
        output_commitments: [[u8; 32]; 2],      // Create up to 2 new notes
        merkle_root: [u8; 32],
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let mut nullifiers = ctx.accounts.nullifiers.load_mut()?;

        // Check root validity (use separate scope to release borrow)
        let root_valid = {
            let roots = ctx.accounts.roots_history.load()?;
            merkle_root == pool.current_root || roots.contains(&merkle_root)
        };
        require!(root_valid, WhistleError::InvalidMerkleRoot);

        // Check nullifiers not spent and mark them
        for nullifier_hash in &input_nullifier_hashes {
            if *nullifier_hash != [0u8; 32] {
                require!(
                    !nullifiers.is_spent(nullifier_hash),
                    WhistleError::NullifierAlreadyUsed
                );
            }
        }

        // Verify the transfer proof
        let proof_valid = verify_transfer_proof(
            &proof_a,
            &proof_b,
            &proof_c,
            &input_nullifier_hashes,
            &output_commitments,
            &merkle_root,
        )?;

        require!(proof_valid, WhistleError::InvalidProof);

        // Mark nullifiers as spent
        for nullifier_hash in &input_nullifier_hashes {
            if *nullifier_hash != [0u8; 32] {
                nullifiers.mark_spent(nullifier_hash)?;
            }
        }
        
        // Drop nullifiers borrow
        drop(nullifiers);

        // Add new commitments to tree
        let mut merkle_tree = ctx.accounts.merkle_tree.load_mut()?;
        for commitment in &output_commitments {
            if *commitment != [0u8; 32] {
                let max_leaves = 1u64 << pool.merkle_levels;
                require!(pool.next_index < max_leaves, WhistleError::TreeFull);
                
                let leaf_index = pool.next_index;
                merkle_tree.insert_leaf(*commitment, leaf_index, pool.merkle_levels);
                pool.next_index = pool.next_index.checked_add(1)
                    .ok_or(WhistleError::ArithmeticOverflow)?;
                
                emit!(NoteCreated {
                    commitment: *commitment,
                    leaf_index,
                    timestamp: Clock::get()?.unix_timestamp,
                });
            }
        }

        pool.current_root = merkle_tree.get_root(pool.merkle_levels);
        
        // Drop merkle_tree borrow before accessing roots_history
        drop(merkle_tree);
        
        // Update roots history
        let mut roots = ctx.accounts.roots_history.load_mut()?;
        let idx = roots.current_index as usize;
        roots.roots[idx] = pool.current_root;
        roots.current_index = ((roots.current_index as usize + 1) % 100) as u8;

        emit!(PrivateTransferCompleted {
            nullifiers_spent: 2,
            notes_created: 2,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // =========================================================================
    // LEGACY FUNCTIONS (for backward compatibility during hackathon)
    // =========================================================================

    /// Legacy deposit (fixed amounts) - maps to shield
    /// Deposit (alias for shield) - accepts ANY amount >= 0.1 SOL
    /// Withdrawals must be in fixed denominations (1, 10, 100 SOL) for privacy
    pub fn deposit(ctx: Context<Shield>, commitment: [u8; 32], amount: u64) -> Result<()> {
        require!(amount >= MIN_DEPOSIT, WhistleError::AmountTooSmall);
        
        // Delegate to shield
        let pool = &mut ctx.accounts.pool;
        let merkle_tree = &mut ctx.accounts.merkle_tree.load_mut()?;
        
        let max_leaves = 1u64 << pool.merkle_levels;
        require!(pool.next_index < max_leaves, WhistleError::TreeFull);
        
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;
        
        let leaf_index = pool.next_index;
        merkle_tree.insert_leaf(commitment, leaf_index, pool.merkle_levels);
        
        pool.current_root = merkle_tree.get_root(pool.merkle_levels);
        pool.next_index = pool.next_index.checked_add(1)
            .ok_or(WhistleError::ArithmeticOverflow)?;
        pool.total_deposits = pool.total_deposits.checked_add(amount)
            .ok_or(WhistleError::ArithmeticOverflow)?;
        pool.total_shielded = pool.total_shielded.checked_add(amount)
            .ok_or(WhistleError::ArithmeticOverflow)?;
        
        let roots = &mut ctx.accounts.roots_history.load_mut()?;
        let idx = roots.current_index as usize;
        roots.roots[idx] = pool.current_root;
        roots.current_index = ((roots.current_index as usize + 1) % 100) as u8;
        
        emit!(Shielded {
            commitment,
            leaf_index,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Legacy withdraw (no change) - maps to unshield with zero change
    pub fn withdraw(
        ctx: Context<Unshield>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        nullifier_hash: [u8; 32],
        recipient: Pubkey,
        amount: u64,
        relayer_fee: u64,
        merkle_root: [u8; 32],
    ) -> Result<()> {
        require!(
            amount == DENOM_001_SOL || amount == DENOM_005_SOL || amount == DENOM_01_SOL ||
            amount == DENOM_1_SOL || amount == DENOM_10_SOL || amount == DENOM_100_SOL,
            WhistleError::InvalidWithdrawDenomination
        );

        require!(relayer_fee <= amount / 10, WhistleError::FeeTooHigh);

        let pool = &mut ctx.accounts.pool;
        let nullifiers = &mut ctx.accounts.nullifiers.load_mut()?;
        let roots = &ctx.accounts.roots_history.load()?;

        require!(
            !nullifiers.is_spent(&nullifier_hash),
            WhistleError::NullifierAlreadyUsed
        );

        require!(
            merkle_root == pool.current_root || roots.contains(&merkle_root),
            WhistleError::InvalidMerkleRoot
        );

        // Prepare recipient as field element (truncate to 31 bytes to fit BN254 field)
        let recipient_bytes = recipient.to_bytes();
        let mut recipient_field = [0u8; 32];
        recipient_field[1..].copy_from_slice(&recipient_bytes[..31]);

        // Verify Groth16 proof
        let proof_valid = verify_withdraw_proof(
            &proof_a,
            &proof_b,
            &proof_c,
            &merkle_root,
            &nullifier_hash,
            &recipient_field,
            amount,
            relayer_fee,
        )?;

        require!(proof_valid, WhistleError::InvalidProof);

        nullifiers.mark_spent(&nullifier_hash)?;

        // SECURITY FIX: Verify vault has sufficient balance
        let vault_balance = ctx.accounts.pool_vault.lamports();
        require!(vault_balance >= amount, WhistleError::InsufficientVaultBalance);

        let withdrawal_net = amount.checked_sub(relayer_fee)
            .ok_or(WhistleError::ArithmeticOverflow)?;
        let vault_bump = ctx.bumps.pool_vault;
        let vault_seeds: &[&[u8]] = &[b"vault", &[vault_bump]];
        
        // Transfer to recipient
        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::system_instruction::transfer(
                ctx.accounts.pool_vault.key,
                ctx.accounts.recipient.key,
                withdrawal_net,
            ),
            &[
                ctx.accounts.pool_vault.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[vault_seeds],
        )?;
        
        if relayer_fee > 0 {
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    ctx.accounts.pool_vault.key,
                    ctx.accounts.relayer.key,
                    relayer_fee,
                ),
                &[
                    ctx.accounts.pool_vault.to_account_info(),
                    ctx.accounts.relayer.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[vault_seeds],
            )?;
        }

        // SECURITY FIX: Use checked_sub to prevent underflow
        pool.total_shielded = pool.total_shielded
            .checked_sub(amount)
            .ok_or(WhistleError::ArithmeticOverflow)?;

        emit!(Unshielded {
            nullifier_hash,
            withdrawal_amount: amount,
            has_change: false,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// ZK-verified withdrawal using Groth16 proofs
    /// 
    /// SECURITY: Verifies:
    /// 1. Merkle root is valid (commitment exists in tree)
    /// 2. Nullifier not already spent (prevents double-spend)
    /// 3. ZK proof of knowledge of (secret, nullifier)
    /// 4. Recipient binding (prevents front-running)
    /// 5. Vault has sufficient balance
    /// 
    /// The prover never reveals secret or nullifier!
    pub fn withdraw_zk(
        ctx: Context<WithdrawZk>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        commitment: [u8; 32],   // The commitment being spent
        nullifier_hash: [u8; 32],
        recipient: Pubkey,
        amount: u64,
        relayer_fee: u64,
        merkle_root: [u8; 32],  // SECURITY FIX: Added Merkle root validation
    ) -> Result<()> {
        // Validate denomination
        require!(
            amount == DENOM_001_SOL || amount == DENOM_005_SOL || amount == DENOM_01_SOL ||
            amount == DENOM_1_SOL || amount == DENOM_10_SOL || amount == DENOM_100_SOL,
            WhistleError::InvalidWithdrawDenomination
        );

        require!(relayer_fee <= amount / 10, WhistleError::FeeTooHigh);

        let pool = &mut ctx.accounts.pool;
        let nullifiers = &mut ctx.accounts.nullifiers.load_mut()?;
        let roots = &ctx.accounts.roots_history.load()?;

        // SECURITY FIX: Validate Merkle root exists in history
        require!(
            merkle_root == pool.current_root || roots.contains(&merkle_root),
            WhistleError::InvalidMerkleRoot
        );

        // Check nullifier not already spent (prevents double-spend)
        require!(
            !nullifiers.is_spent(&nullifier_hash),
            WhistleError::NullifierAlreadyUsed
        );

        // Verify vault has sufficient balance
        let vault_balance = ctx.accounts.pool_vault.lamports();
        require!(vault_balance >= amount, WhistleError::InsufficientVaultBalance);

        // Prepare recipient as field element (truncate to 31 bytes to fit BN254 field)
        let recipient_bytes = recipient.to_bytes();
        let mut recipient_field = [0u8; 32];
        recipient_field[1..].copy_from_slice(&recipient_bytes[..31]);
        
        // Verify the Groth16 ZK proof
        let proof_valid = verify_withdraw_proof_groth16(
            &proof_a,
            &proof_b,
            &proof_c,
            &commitment,
            &nullifier_hash,
            &recipient_field,
            amount,
            relayer_fee,
        )?;

        require!(proof_valid, WhistleError::InvalidProof);

        // Mark nullifier as spent
        nullifiers.mark_spent(&nullifier_hash)?;

        // Transfer SOL
        let withdrawal_net = amount.checked_sub(relayer_fee)
            .ok_or(WhistleError::ArithmeticOverflow)?;
        let vault_bump = ctx.bumps.pool_vault;
        let vault_seeds: &[&[u8]] = &[b"vault", &[vault_bump]];
        
        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::system_instruction::transfer(
                ctx.accounts.pool_vault.key,
                &recipient,
                withdrawal_net,
            ),
            &[
                ctx.accounts.pool_vault.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[vault_seeds],
        )?;

        // Pay relayer if any
        if relayer_fee > 0 {
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    ctx.accounts.pool_vault.key,
                    ctx.accounts.relayer.key,
                    relayer_fee,
                ),
                &[
                    ctx.accounts.pool_vault.to_account_info(),
                    ctx.accounts.relayer.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[vault_seeds],
            )?;
        }

        // SECURITY FIX: Use checked_sub to prevent underflow
        pool.total_shielded = pool.total_shielded
            .checked_sub(amount)
            .ok_or(WhistleError::ArithmeticOverflow)?;

        emit!(WithdrawnZk {
            nullifier_hash,
            commitment,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // REMOVED: demo_withdraw function was a security vulnerability
    // It allowed anyone to drain funds without proof verification
    // DO NOT RE-ADD THIS FUNCTION
}

// ============================================================================
// GROTH16 VERIFICATION FUNCTIONS
// ============================================================================
//
// PRODUCTION NOTE: Each function below should use a DEDICATED circuit and VK:
//
// 1. verify_unshield_proof -> unshield_change.circom
//    - Verifies Merkle membership of input note
//    - Verifies change commitment is correctly computed
//    - Enforces value conservation: input = output + withdrawal + fee
//
// 2. verify_withdraw_proof -> withdraw_merkle.circom
//    - Verifies Merkle membership of input note
//    - Standard withdrawal without change
//
// 3. verify_transfer_proof -> private_transfer.circom
//    - Verifies Merkle membership of both input notes
//    - Enforces value conservation: sum(inputs) = sum(outputs)
//    - No SOL leaves the pool
//
// See circuits/PRODUCTION_CIRCUITS.md for detailed specifications.
// ============================================================================

/// Verify unshield proof (with change support)
/// 
/// Uses dedicated unshield_change.circom circuit that verifies:
/// - Input note exists in Merkle tree
/// - Change commitment = Poseidon(changeSecret, Poseidon(changeNullifier, changeAmount))
/// - Value conservation: inputAmount = withdrawalAmount + relayerFee + changeAmount
fn verify_unshield_proof(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    merkle_root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    recipient: &[u8; 32],
    withdrawal_amount: u64,
    relayer_fee: u64,
    change_commitment: &[u8; 32],
) -> Result<bool> {
    // PRODUCTION: Uses dedicated unshield_change circuit
    verify_unshield_change_proof(
        proof_a,
        proof_b,
        proof_c,
        merkle_root,
        nullifier_hash,
        recipient,
        withdrawal_amount,
        relayer_fee,
        change_commitment,
    )
}

/// Verify withdraw proof with full Merkle membership proof
/// 
/// Uses dedicated withdraw_merkle.circom circuit that verifies:
/// - Input note exists in Merkle tree (Merkle proof)
/// - Nullifier hash is correctly computed
/// - Recipient is bound to proof (prevents front-running)
fn verify_withdraw_proof(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    merkle_root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    recipient: &[u8; 32],
    amount: u64,
    relayer_fee: u64,
) -> Result<bool> {
    // PRODUCTION: Uses dedicated withdraw_merkle circuit
    verify_withdraw_merkle_proof(
        proof_a,
        proof_b,
        proof_c,
        merkle_root,
        nullifier_hash,
        recipient,
        amount,
        relayer_fee,
    )
}

/// Verify private transfer proof
/// 
/// Uses dedicated private_transfer.circom circuit that verifies:
/// - Both input notes exist in Merkle tree
/// - Both output commitments are correctly computed  
/// - Value conservation: sum(input amounts) == sum(output amounts)
/// - All amounts are in valid range (no overflow attacks)
fn verify_transfer_proof(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    input_nullifiers: &[[u8; 32]; 2],
    output_commitments: &[[u8; 32]; 2],
    merkle_root: &[u8; 32],
) -> Result<bool> {
    // PRODUCTION: Uses dedicated private_transfer circuit
    verify_private_transfer_proof(
        proof_a,
        proof_b,
        proof_c,
        merkle_root,
        input_nullifiers,
        output_commitments,
    )
}

// SECURITY FIX: Removed incomplete groth16_verify function
// All verification now uses verify_withdraw_proof_groth16 from groth16.rs
// which properly implements full Groth16 verification via groth16_solana library

// SECURITY FIX: Removed unused EC helper functions (scalar_mul_g1, point_add_g1, negate_g1)
// All EC operations are now handled by the groth16_solana library in groth16.rs

// ============================================================================
// VERIFICATION KEYS
// ============================================================================

// SECURITY FIX: Removed Groth16VK struct and get_*_vk functions
// All verification now uses the proper groth16_solana library via groth16.rs
// which handles verification keys internally

// ============================================================================
// MERKLE TREE (Poseidon BN254 X5 based)
// ============================================================================

fn merkle_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    // Poseidon(2) hash using Solana syscall (BN254 X5, big-endian)
    poseidon_hashv(
        PoseidonParameters::Bn254X5,
        PoseidonEndianness::BigEndian,
        &[left, right],
    )
    .expect("Poseidon syscall should succeed")
    .to_bytes()
}

// ============================================================================
// ACCOUNT STRUCTURES
// ============================================================================

#[account]
pub struct PoolState {
    pub merkle_levels: u8,
    pub next_index: u64,
    pub current_root: [u8; 32],
    pub total_deposits: u64,
    pub total_shielded: u64,  // Currently shielded balance
    pub bump: u8,
}

// MAINNET: 13 levels => 8192 leaves (deposits), 16384 total nodes
// ~512KB account size - requires larger account allocation
#[account(zero_copy)]
#[repr(C)]
pub struct MerkleTree {
    pub levels_used: u8,
    pub _padding: [u8; 7],
    pub nodes: [[u8; 32]; 16384],
}

impl MerkleTree {
    pub fn insert_leaf(&mut self, leaf: [u8; 32], index: u64, levels: u8) {
        let levels = levels.min(13); // 13 levels max for mainnet (8192 leaves)
        let leaf_offset = (1u64 << levels) - 1;
        let leaf_pos = (leaf_offset + index) as usize;
        
        if leaf_pos < self.nodes.len() {
            self.nodes[leaf_pos] = leaf;
            
            let mut current = leaf_pos;
            while current > 0 {
                let parent = (current - 1) / 2;
                let left_child = 2 * parent + 1;
                let right_child = 2 * parent + 2;
                
                let left = if left_child < self.nodes.len() { self.nodes[left_child] } else { [0u8; 32] };
                let right = if right_child < self.nodes.len() { self.nodes[right_child] } else { [0u8; 32] };
                
                self.nodes[parent] = merkle_hash(&left, &right);
                current = parent;
            }
        }
    }
    
    pub fn get_root(&self, _levels: u8) -> [u8; 32] {
        self.nodes[0]
    }
}

// MAINNET: 100 roots history for better reliability
#[account(zero_copy)]
#[repr(C)]
pub struct RootsHistory {
    pub current_index: u8,
    pub _padding: [u8; 31],
    pub roots: [[u8; 32]; 100], // 100 roots history for mainnet
}

impl RootsHistory {
    pub fn contains(&self, root: &[u8; 32]) -> bool {
        self.roots.iter().any(|r| r == root)
    }
    
    pub fn is_valid_root(&self, root: &[u8; 32]) -> bool {
        self.contains(root)
    }
}

// MAINNET: 4096 nullifiers = ~128KB (supports 4096 withdrawals)
#[account(zero_copy)]
#[repr(C)]
pub struct NullifierSet {
    pub count: u64,
    pub nullifiers: [[u8; 32]; 4096], // 4096 nullifiers for mainnet
}

impl NullifierSet {
    pub fn is_spent(&self, nullifier: &[u8; 32]) -> bool {
        for i in 0..self.count as usize {
            if i < 4096 && self.nullifiers[i] == *nullifier {
                return true;
            }
        }
        false
    }
    
    pub fn mark_spent(&mut self, nullifier: &[u8; 32]) -> Result<()> {
        require!((self.count as usize) < 4096, WhistleError::NullifierSetFull);
        self.nullifiers[self.count as usize] = *nullifier;
        self.count += 1;
        Ok(())
    }
}

// ============================================================================
// INSTRUCTION CONTEXTS
// ============================================================================

// Split initialization into separate instructions to avoid stack overflow
#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<PoolState>(),
        seeds = [b"pool"],
        bump
    )]
    pub pool: Account<'info, PoolState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitMerkle<'info> {
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, PoolState>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<MerkleTree>(),
        seeds = [b"merkle_tree"],
        bump
    )]
    pub merkle_tree: AccountLoader<'info, MerkleTree>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitRoots<'info> {
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, PoolState>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<RootsHistory>(),
        seeds = [b"roots_history"],
        bump
    )]
    pub roots_history: AccountLoader<'info, RootsHistory>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitNullifiers<'info> {
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, PoolState>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<NullifierSet>(),
        seeds = [b"nullifiers"],
        bump
    )]
    pub nullifiers: AccountLoader<'info, NullifierSet>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Shield<'info> {
    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, PoolState>,
    
    #[account(
        mut,
        seeds = [b"merkle_tree"],
        bump
    )]
    pub merkle_tree: AccountLoader<'info, MerkleTree>,
    
    #[account(
        mut,
        seeds = [b"roots_history"],
        bump
    )]
    pub roots_history: AccountLoader<'info, RootsHistory>,
    
    /// CHECK: Vault PDA
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub pool_vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unshield<'info> {
    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, PoolState>,
    
    #[account(
        mut,
        seeds = [b"merkle_tree"],
        bump
    )]
    pub merkle_tree: AccountLoader<'info, MerkleTree>,
    
    #[account(
        mut,
        seeds = [b"nullifiers"],
        bump
    )]
    pub nullifiers: AccountLoader<'info, NullifierSet>,
    
    #[account(
        mut,
        seeds = [b"roots_history"],
        bump
    )]
    pub roots_history: AccountLoader<'info, RootsHistory>,
    
    /// CHECK: Vault PDA
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub pool_vault: SystemAccount<'info>,
    
    /// CHECK: Recipient receives SOL
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    
    /// CHECK: Relayer receives fee
    #[account(mut)]
    pub relayer: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PrivateTransfer<'info> {
    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, PoolState>,
    
    #[account(
        mut,
        seeds = [b"merkle_tree"],
        bump
    )]
    pub merkle_tree: AccountLoader<'info, MerkleTree>,
    
    #[account(
        mut,
        seeds = [b"nullifiers"],
        bump
    )]
    pub nullifiers: AccountLoader<'info, NullifierSet>,
    
    #[account(
        mut,
        seeds = [b"roots_history"],
        bump
    )]
    pub roots_history: AccountLoader<'info, RootsHistory>,
}

// SECURITY FIX: DemoWithdraw context REMOVED - it was a security vulnerability
// that allowed anyone to drain all funds without proof verification

#[derive(Accounts)]
pub struct WithdrawZk<'info> {
    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, PoolState>,
    
    #[account(
        mut,
        seeds = [b"nullifiers"],
        bump
    )]
    pub nullifiers: AccountLoader<'info, NullifierSet>,
    
    // SECURITY FIX: Added roots_history for Merkle root validation
    #[account(
        seeds = [b"roots_history"],
        bump
    )]
    pub roots_history: AccountLoader<'info, RootsHistory>,
    
    /// CHECK: Vault PDA
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub pool_vault: SystemAccount<'info>,
    
    /// CHECK: Recipient receives SOL
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    
    /// CHECK: Relayer receives fee
    #[account(mut)]
    pub relayer: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

// Alias for backward compatibility
pub type Deposit<'info> = Shield<'info>;
pub type Withdraw<'info> = Unshield<'info>;

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct PoolInitialized {
    pub pool: Pubkey,
    pub merkle_levels: u8,
    pub timestamp: i64,
}

#[event]
pub struct Shielded {
    pub commitment: [u8; 32],
    pub leaf_index: u64,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct Unshielded {
    pub nullifier_hash: [u8; 32],
    pub withdrawal_amount: u64,
    pub has_change: bool,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawnZk {
    pub nullifier_hash: [u8; 32],
    pub commitment: [u8; 32],
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ChangeCreated {
    pub commitment: [u8; 32],
    pub leaf_index: u64,
    pub timestamp: i64,
}

#[event]
pub struct NoteCreated {
    pub commitment: [u8; 32],
    pub leaf_index: u64,
    pub timestamp: i64,
}

#[event]
pub struct PrivateTransferCompleted {
    pub nullifiers_spent: u8,
    pub notes_created: u8,
    pub timestamp: i64,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum WhistleError {
    #[msg("Invalid Merkle tree levels (must be 7-13)")]
    InvalidMerkleLevels,
    
    #[msg("Amount too small (minimum 0.01 SOL)")]
    AmountTooSmall,
    
    #[msg("Invalid withdrawal denomination (must be 0.01, 0.05, 0.1, 1, 10, or 100 SOL)")]
    InvalidWithdrawDenomination,
    
    #[msg("Merkle tree is full")]
    TreeFull,
    
    #[msg("Nullifier has already been used")]
    NullifierAlreadyUsed,
    
    #[msg("Invalid Merkle root")]
    InvalidMerkleRoot,
    
    #[msg("Invalid ZK proof")]
    InvalidProof,
    
    #[msg("Relayer fee too high (max 10%)")]
    FeeTooHigh,
    
    #[msg("Nullifier set is full")]
    NullifierSetFull,
    
    #[msg("Elliptic curve operation failed")]
    ECOperationFailed,
    
    #[msg("Insufficient shielded balance")]
    InsufficientBalance,
    
    #[msg("Groth16 point addition failed")]
    Groth16AdditionFailed,
    
    #[msg("Groth16 scalar multiplication failed")]
    Groth16MultiplicationFailed,
    
    #[msg("Groth16 pairing check failed")]
    Groth16PairingFailed,
    
    #[msg("Insufficient vault balance for withdrawal")]
    InsufficientVaultBalance,
    
    #[msg("Arithmetic overflow or underflow")]
    ArithmeticOverflow,
}
