/**
 * Whistle Protocol SDK
 * 
 * TypeScript SDK for interacting with the Whistle privacy pool.
 */

export { WhistleClient, POOL_PROGRAM_ID } from './client';
export type { WhistleConfig, DepositResult, WithdrawResult } from './client';

export {
  generateDepositNote,
  generateDepositProof,
  generateWithdrawProof,
  buildMerkleProof,
  serializeNote,
  deserializeNote,
  verifyProof,
  initPoseidon,
  hexToBytes,
  bytesToHex,
} from './prover';

export type {
  DepositNote,
  DepositProof,
  WithdrawProof,
  MerkleProof,
} from './prover';

export * from './core/constants';

export { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
