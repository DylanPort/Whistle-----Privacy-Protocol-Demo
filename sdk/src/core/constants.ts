import { PublicKey } from '@solana/web3.js';

// Program IDs
export const POOL_PROGRAM_ID = new PublicKey('7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV');
export const VERIFIER_PROGRAM_ID = new PublicKey('7vBdkq62GbtXjoJydEEjn996kkr8kcbgrZcGbe7zSj1u');
export const MERKLE_PROGRAM_ID = new PublicKey('C81ewP6VfPibPEYWirQ9A18bCoceRdCXmMbXv33zm9vC');

// Network configurations
export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

// Protocol constants
export const MERKLE_TREE_LEVELS = 20;
export const MAX_DEPOSITS = 1 << MERKLE_TREE_LEVELS; // ~1M

// Supported deposit amounts (in lamports)
export const DEPOSIT_AMOUNTS = {
  ONE_SOL: BigInt(1_000_000_000),
  TEN_SOL: BigInt(10_000_000_000),
  HUNDRED_SOL: BigInt(100_000_000_000),
} as const;

// Relayer defaults
export const DEFAULT_RELAYER_FEE = BigInt(10_000_000); // 0.01 SOL
export const MIN_RELAYER_FEE = BigInt(5_000_000); // 0.005 SOL

// Proof sizes (bytes)
export const PROOF_A_SIZE = 64;
export const PROOF_B_SIZE = 128;
export const PROOF_C_SIZE = 64;
export const PUBLIC_INPUT_SIZE = 32;
