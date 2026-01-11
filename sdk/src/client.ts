import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Keypair,
} from '@solana/web3.js';

export const POOL_PROGRAM_ID = new PublicKey('7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV');
export const VERIFIER_PROGRAM_ID = new PublicKey('7vBdkq62GbtXjoJydEEjn996kkr8kcbgrZcGbe7zSj1u');

export interface WhistleConfig {
  connection: Connection;
  wallet: Keypair;
  programId?: PublicKey;
}

export interface DepositResult {
  signature: string;
  commitment: Uint8Array;
  leafIndex: number;
}

export interface WithdrawResult {
  signature: string;
  recipient: PublicKey;
  amount: number;
}

/**
 * Client for interacting with Whistle Protocol
 */
export class WhistleClient {
  private connection: Connection;
  private wallet: Keypair;
  private programId: PublicKey;

  constructor(config: WhistleConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.programId = config.programId || POOL_PROGRAM_ID;
  }

  /**
   * Get pool PDA address
   */
  getPoolAddress(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool')],
      this.programId
    );
    return pda;
  }

  /**
   * Get vault PDA address
   */
  getVaultAddress(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault')],
      this.programId
    );
    return pda;
  }

  /**
   * Get Merkle tree PDA address
   */
  getMerkleTreeAddress(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('merkle_tree')],
      this.programId
    );
    return pda;
  }

  /**
   * Get roots history PDA address
   */
  getRootsHistoryAddress(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('roots_history')],
      this.programId
    );
    return pda;
  }

  /**
   * Get nullifiers PDA address
   */
  getNullifiersAddress(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifiers')],
      this.programId
    );
    return pda;
  }

  /**
   * Deposit SOL into the privacy pool
   */
  async deposit(commitment: Uint8Array, amount: number): Promise<DepositResult> {
    const validAmounts = [1, 10, 100];
    if (!validAmounts.includes(amount)) {
      throw new Error('Invalid amount. Must be 1, 10, or 100 SOL');
    }

    const lamports = amount * LAMPORTS_PER_SOL;
    
    // Build instruction data
    const discriminator = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]); // deposit
    const commitmentBuffer = Buffer.from(commitment);
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(lamports));

    const instructionData = Buffer.concat([
      discriminator,
      commitmentBuffer,
      amountBuffer,
    ]);

    const tx = new Transaction().add({
      keys: [
        { pubkey: this.getPoolAddress(), isSigner: false, isWritable: true },
        { pubkey: this.getMerkleTreeAddress(), isSigner: false, isWritable: true },
        { pubkey: this.getRootsHistoryAddress(), isSigner: false, isWritable: true },
        { pubkey: this.getVaultAddress(), isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: instructionData,
    });

    tx.feePayer = this.wallet.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.sign(this.wallet);

    const signature = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(signature, 'confirmed');

    return {
      signature,
      commitment,
      leafIndex: 0, // Would be parsed from transaction logs
    };
  }

  /**
   * Withdraw from the privacy pool using a ZK proof
   */
  async withdraw(
    proofA: Uint8Array,
    proofB: Uint8Array,
    proofC: Uint8Array,
    nullifierHash: Uint8Array,
    recipient: PublicKey,
    amount: number,
    relayerFee: number,
    merkleRoot: Uint8Array,
  ): Promise<WithdrawResult> {
    const lamports = amount * LAMPORTS_PER_SOL;
    const feeLamports = relayerFee * LAMPORTS_PER_SOL;

    const discriminator = Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]); // withdraw

    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(lamports));
    const feeBuffer = Buffer.alloc(8);
    feeBuffer.writeBigUInt64LE(BigInt(feeLamports));

    const instructionData = Buffer.concat([
      discriminator,
      Buffer.from(proofA),
      Buffer.from(proofB),
      Buffer.from(proofC),
      Buffer.from(nullifierHash),
      recipient.toBuffer(),
      amountBuffer,
      feeBuffer,
      Buffer.from(merkleRoot),
    ]);

    const tx = new Transaction().add({
      keys: [
        { pubkey: this.getPoolAddress(), isSigner: false, isWritable: false },
        { pubkey: this.getNullifiersAddress(), isSigner: false, isWritable: true },
        { pubkey: this.getRootsHistoryAddress(), isSigner: false, isWritable: false },
        { pubkey: this.getVaultAddress(), isSigner: false, isWritable: true },
        { pubkey: recipient, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: instructionData,
    });

    tx.feePayer = this.wallet.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.sign(this.wallet);

    const signature = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(signature, 'confirmed');

    return {
      signature,
      recipient,
      amount,
    };
  }

  /**
   * Get pool state
   */
  async getPoolState(): Promise<{
    merkleRoot: Uint8Array;
    nextIndex: number;
    totalDeposits: number;
  }> {
    const poolAccount = await this.connection.getAccountInfo(this.getPoolAddress());
    if (!poolAccount) {
      throw new Error('Pool not initialized');
    }

    // Parse pool data (skip 8 byte discriminator)
    const data = poolAccount.data.slice(8);
    const merkleRoot = data.slice(9, 41); // after merkle_levels(1) + next_index(8)
    const nextIndex = Number(data.readBigUInt64LE(1));
    const totalDeposits = Number(data.readBigUInt64LE(41)) / LAMPORTS_PER_SOL;

    return {
      merkleRoot,
      nextIndex,
      totalDeposits,
    };
  }

  /**
   * Check if nullifier has been spent
   */
  async isNullifierSpent(nullifierHash: Uint8Array): Promise<boolean> {
    const nullifiersAccount = await this.connection.getAccountInfo(
      this.getNullifiersAddress()
    );
    if (!nullifiersAccount) {
      return false;
    }

    // Search through nullifier set
    const data = nullifiersAccount.data.slice(8);
    const count = data.readUInt16LE(32 * 256);

    for (let i = 0; i < count; i++) {
      const stored = data.slice(i * 32, (i + 1) * 32);
      if (Buffer.from(nullifierHash).equals(stored)) {
        return true;
      }
    }

    return false;
  }
}

