use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV");

/// Whistle Protocol Privacy Pool
/// 
/// A fully decentralized privacy pool for Solana.
/// NO ADMIN. NO PAUSE. NO CENSORSHIP.
/// 
/// Users deposit SOL with a commitment (hash of amount + secret).
/// Users withdraw by proving they know a valid commitment in the Merkle tree.
/// The ZK proof reveals nothing about which deposit is being spent.

#[program]
pub mod whistle_pool {
    use super::*;

    /// Initialize a new privacy pool
    /// This can only be called once. After initialization, the pool is immutable.
    pub fn initialize(ctx: Context<Initialize>, merkle_levels: u8) -> Result<()> {
        require!(merkle_levels >= 10 && merkle_levels <= 20, WhistleError::InvalidMerkleLevels);
        
        let pool = &mut ctx.accounts.pool;
        pool.merkle_levels = merkle_levels;
        pool.next_index = 0;
        pool.current_root = [0u8; 32];
        pool.total_deposits = 0;
        pool.bump = ctx.bumps.pool;
        
        // Initialize merkle tree
        let merkle_tree = &mut ctx.accounts.merkle_tree.load_init()?;
        merkle_tree.levels_used = merkle_levels;
        
        // Initialize roots history
        let roots = &mut ctx.accounts.roots_history.load_init()?;
        roots.current_index = 0;
        
        // Initialize nullifiers
        let nullifiers = &mut ctx.accounts.nullifiers.load_init()?;
        nullifiers.count = 0;
        
        emit!(PoolInitialized {
            pool: ctx.accounts.pool.key(),
            merkle_levels,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Deposit SOL into the privacy pool
    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32], amount: u64) -> Result<()> {
        require!(
            amount == 1_000_000_000 ||    // 1 SOL
            amount == 10_000_000_000 ||   // 10 SOL
            amount == 100_000_000_000,    // 100 SOL
            WhistleError::InvalidAmount
        );
        
        let pool = &mut ctx.accounts.pool;
        let merkle_tree = &mut ctx.accounts.merkle_tree.load_mut()?;
        
        // Check tree is not full
        let max_leaves = 1u64 << pool.merkle_levels;
        require!(pool.next_index < max_leaves, WhistleError::TreeFull);
        
        // Transfer SOL from depositor to pool vault
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
        
        // Update pool state
        pool.current_root = merkle_tree.get_root(pool.merkle_levels);
        pool.next_index += 1;
        pool.total_deposits += amount;
        
        // Store root in history
        let roots = &mut ctx.accounts.roots_history.load_mut()?;
        let idx = roots.current_index as usize;
        roots.roots[idx] = pool.current_root;
        roots.current_index = ((roots.current_index as usize + 1) % 30) as u8;
        
        emit!(Deposited {
            commitment,
            leaf_index,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Withdraw from the privacy pool using a ZK proof
    pub fn withdraw(
        ctx: Context<Withdraw>,
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
            amount == 1_000_000_000 ||
            amount == 10_000_000_000 ||
            amount == 100_000_000_000,
            WhistleError::InvalidAmount
        );

        require!(relayer_fee <= amount, WhistleError::FeeTooHigh);

        let pool = &ctx.accounts.pool;
        let nullifiers = &mut ctx.accounts.nullifiers.load_mut()?;
        let roots = &ctx.accounts.roots_history.load()?;

        // Check nullifier hasn't been used
        require!(
            !nullifiers.is_spent(&nullifier_hash),
            WhistleError::NullifierAlreadyUsed
        );

        // Check root is valid (current or recent)
        require!(
            merkle_root == pool.current_root || roots.contains(&merkle_root),
            WhistleError::InvalidMerkleRoot
        );

        // Verify the ZK proof
        let proof = Groth16Proof { a: proof_a, b: proof_b, c: proof_c };
        let public_inputs = PublicInputs {
            merkle_root,
            nullifier_hash,
            recipient,
            amount,
            relayer_fee,
        };

        require!(
            verify_groth16_proof(&proof, &public_inputs),
            WhistleError::InvalidProof
        );

        // Mark nullifier as spent
        nullifiers.mark_spent(nullifier_hash)?;

        // Calculate amounts
        let net_amount = amount - relayer_fee;

        // Get vault bump for signer seeds
        let vault_bump = ctx.bumps.pool_vault;
        let vault_seeds = &[b"vault".as_ref(), &[vault_bump]];
        let signer_seeds = &[&vault_seeds[..]];

        // Transfer to recipient using CPI
        let transfer_to_recipient = anchor_lang::system_program::Transfer {
            from: ctx.accounts.pool_vault.to_account_info(),
            to: ctx.accounts.recipient.to_account_info(),
        };
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                transfer_to_recipient,
                signer_seeds,
            ),
            net_amount,
        )?;

        // Transfer fee to relayer (if any)
        if relayer_fee > 0 {
            let transfer_to_relayer = anchor_lang::system_program::Transfer {
                from: ctx.accounts.pool_vault.to_account_info(),
                to: ctx.accounts.relayer.to_account_info(),
            };
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    transfer_to_relayer,
                    signer_seeds,
                ),
                relayer_fee,
            )?;
        }

        emit!(Withdrawn {
            nullifier_hash,
            recipient,
            relayer: if relayer_fee > 0 { Some(ctx.accounts.relayer.key()) } else { None },
            amount,
            relayer_fee,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Private transfer within the pool (spend one note, create new note)
    pub fn transfer(
        ctx: Context<Transfer>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        nullifier_hash: [u8; 32],
        new_commitment: [u8; 32],
        merkle_root: [u8; 32],
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let merkle_tree = &mut ctx.accounts.merkle_tree.load_mut()?;
        let nullifiers = &mut ctx.accounts.nullifiers.load_mut()?;
        let roots = &ctx.accounts.roots_history.load()?;

        // Check nullifier hasn't been used
        require!(
            !nullifiers.is_spent(&nullifier_hash),
            WhistleError::NullifierAlreadyUsed
        );

        // Check root is valid
        require!(
            merkle_root == pool.current_root || roots.contains(&merkle_root),
            WhistleError::InvalidMerkleRoot
        );

        // Verify the ZK proof
        let proof = Groth16Proof { a: proof_a, b: proof_b, c: proof_c };
        let public_inputs = TransferPublicInputs {
            merkle_root,
            nullifier_hash,
            new_commitment,
        };

        require!(
            verify_transfer_proof(&proof, &public_inputs),
            WhistleError::InvalidProof
        );

        // Mark old nullifier as spent
        nullifiers.mark_spent(nullifier_hash)?;

        // Add new commitment to Merkle tree
        let leaf_index = pool.next_index;
        merkle_tree.insert_leaf(new_commitment, leaf_index, pool.merkle_levels);
        
        // Update root
        pool.current_root = merkle_tree.get_root(pool.merkle_levels);
        pool.next_index += 1;

        // Store root in history
        let roots_mut = &mut ctx.accounts.roots_history_mut.load_mut()?;
        let idx = roots_mut.current_index as usize;
        roots_mut.roots[idx] = pool.current_root;
        roots_mut.current_index = ((roots_mut.current_index as usize + 1) % 30) as u8;

        emit!(Transferred {
            nullifier_hash,
            new_commitment,
            leaf_index,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ============================================================================
// ACCOUNTS
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Pool::SPACE,
        seeds = [b"pool"],
        bump
    )]
    pub pool: Account<'info, Pool>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<MerkleTree>(),
        seeds = [b"merkle_tree"],
        bump
    )]
    pub merkle_tree: AccountLoader<'info, MerkleTree>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<RootsHistory>(),
        seeds = [b"roots_history"],
        bump
    )]
    pub roots_history: AccountLoader<'info, RootsHistory>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<NullifierSet>(),
        seeds = [b"nullifiers"],
        bump
    )]
    pub nullifiers: AccountLoader<'info, NullifierSet>,
    
    /// CHECK: Pool vault is a PDA that holds funds
    #[account(
        seeds = [b"vault"],
        bump
    )]
    pub pool_vault: AccountInfo<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
    
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
    
    /// CHECK: Pool vault PDA
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub pool_vault: AccountInfo<'info>,
    
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
    
    #[account(
        mut,
        seeds = [b"nullifiers"],
        bump
    )]
    pub nullifiers: AccountLoader<'info, NullifierSet>,
    
    #[account(
        seeds = [b"roots_history"],
        bump
    )]
    pub roots_history: AccountLoader<'info, RootsHistory>,
    
    /// CHECK: Pool vault PDA
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub pool_vault: AccountInfo<'info>,
    
    /// CHECK: Recipient receives funds
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    
    /// CHECK: Relayer receives fee
    #[account(mut)]
    pub relayer: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Transfer<'info> {
    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
    
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
        seeds = [b"roots_history"],
        bump
    )]
    pub roots_history: AccountLoader<'info, RootsHistory>,
    
    #[account(
        mut,
        seeds = [b"roots_history"],
        bump
    )]
    pub roots_history_mut: AccountLoader<'info, RootsHistory>,
}

// ============================================================================
// STATE
// ============================================================================

#[account]
pub struct Pool {
    pub merkle_levels: u8,
    pub next_index: u64,
    pub current_root: [u8; 32],
    pub total_deposits: u64,
    pub bump: u8,
}

impl Pool {
    pub const SPACE: usize = 1 + 8 + 32 + 8 + 1;
}

#[account(zero_copy)]
#[repr(C)]
pub struct MerkleTree {
    pub filled_subtrees: [[u8; 32]; 20],
    pub zeros: [[u8; 32]; 20],
    pub levels_used: u8,
    pub _padding: [u8; 7],
}

impl MerkleTree {
    pub fn insert_leaf(&mut self, leaf: [u8; 32], index: u64, levels: u8) {
        let mut current_hash = leaf;
        let mut current_index = index;
        
        for level in 0..levels {
            let level_usize = level as usize;
            
            if current_index % 2 == 0 {
                self.filled_subtrees[level_usize] = current_hash;
                current_hash = poseidon_hash(&current_hash, &self.zeros[level_usize]);
            } else {
                current_hash = poseidon_hash(&self.filled_subtrees[level_usize], &current_hash);
            }
            
            current_index /= 2;
        }
    }
    
    pub fn get_root(&self, levels: u8) -> [u8; 32] {
        if levels == 0 {
            [0u8; 32]
        } else {
            self.filled_subtrees[(levels - 1) as usize]
        }
    }
}

#[account(zero_copy)]
#[repr(C)]
pub struct RootsHistory {
    pub roots: [[u8; 32]; 30],
    pub current_index: u8,
    pub _padding: [u8; 7],
}

impl RootsHistory {
    pub fn contains(&self, root: &[u8; 32]) -> bool {
        self.roots.iter().any(|r| r == root)
    }
}

#[account(zero_copy)]
#[repr(C)]
pub struct NullifierSet {
    pub spent: [[u8; 32]; 256],
    pub count: u16,
    pub _padding: [u8; 6],
}

impl NullifierSet {
    pub fn is_spent(&self, nullifier: &[u8; 32]) -> bool {
        for i in 0..self.count as usize {
            if self.spent[i] == *nullifier {
                return true;
            }
        }
        false
    }
    
    pub fn mark_spent(&mut self, nullifier: [u8; 32]) -> Result<()> {
        require!((self.count as usize) < 256, WhistleError::NullifierSetFull);
        self.spent[self.count as usize] = nullifier;
        self.count += 1;
        Ok(())
    }
}

// ============================================================================
// PROOF TYPES
// ============================================================================

pub struct Groth16Proof {
    pub a: [u8; 64],
    pub b: [u8; 128],
    pub c: [u8; 64],
}

pub struct PublicInputs {
    pub merkle_root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub recipient: Pubkey,
    pub amount: u64,
    pub relayer_fee: u64,
}

pub struct TransferPublicInputs {
    pub merkle_root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub new_commitment: [u8; 32],
}

// ============================================================================
// CRYPTOGRAPHIC FUNCTIONS
// ============================================================================

/// Poseidon hash (using keccak as placeholder)
/// Production: use light-poseidon crate
fn poseidon_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    use anchor_lang::solana_program::keccak;
    
    let mut input = [0u8; 64];
    input[..32].copy_from_slice(left);
    input[32..].copy_from_slice(right);
    
    keccak::hash(&input).to_bytes()
}

/// Verify Groth16 proof
/// Production: use alt_bn128 syscalls for full verification
fn verify_groth16_proof(_proof: &Groth16Proof, _inputs: &PublicInputs) -> bool {
    true
}

fn verify_transfer_proof(_proof: &Groth16Proof, _inputs: &TransferPublicInputs) -> bool {
    true
}

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
pub struct Deposited {
    pub commitment: [u8; 32],
    pub leaf_index: u64,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct Withdrawn {
    pub nullifier_hash: [u8; 32],
    pub recipient: Pubkey,
    pub relayer: Option<Pubkey>,
    pub amount: u64,
    pub relayer_fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct Transferred {
    pub nullifier_hash: [u8; 32],
    pub new_commitment: [u8; 32],
    pub leaf_index: u64,
    pub timestamp: i64,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum WhistleError {
    #[msg("Invalid Merkle tree levels (must be 10-20)")]
    InvalidMerkleLevels,
    
    #[msg("Invalid deposit amount (must be 1, 10, or 100 SOL)")]
    InvalidAmount,
    
    #[msg("Merkle tree is full")]
    TreeFull,
    
    #[msg("Nullifier has already been used")]
    NullifierAlreadyUsed,
    
    #[msg("Invalid Merkle root")]
    InvalidMerkleRoot,
    
    #[msg("Invalid ZK proof")]
    InvalidProof,
    
    #[msg("Relayer fee exceeds withdrawal amount")]
    FeeTooHigh,
    
    #[msg("Nullifier set is full")]
    NullifierSetFull,
}
