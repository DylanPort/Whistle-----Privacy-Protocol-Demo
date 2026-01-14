import express from 'express';
import cors from 'cors';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Large payloads for proofs

// Configuration
const PORT = process.env.PORT || 3005;
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('6juimdEmwGPbDwV6WX9Jr3FcvKTKXb7oreb53RzBKbNu');

// Relayer wallet
let relayerKeypair: Keypair;

const keypairPath = path.join(__dirname, '..', 'relayer-keypair.json');
if (fs.existsSync(keypairPath)) {
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  relayerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
} else {
  relayerKeypair = Keypair.generate();
  fs.writeFileSync(keypairPath, JSON.stringify(Array.from(relayerKeypair.secretKey)));
  console.log('Generated new relayer keypair');
}

console.log('Relayer wallet:', relayerKeypair.publicKey.toBase58());

const connection = new Connection(RPC_URL, 'confirmed');

// Anchor discriminators
const WITHDRAW_ZK_DISCRIM = crypto.createHash('sha256')
  .update('global:withdraw_zk')
  .digest()
  .slice(0, 8);

const DEMO_WITHDRAW_DISCRIM = crypto.createHash('sha256')
  .update('global:demo_withdraw')
  .digest()
  .slice(0, 8);

// Health check
app.get('/health', async (_req, res) => {
  try {
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    res.json({
      status: 'ok',
      relayer: relayerKeypair.publicKey.toBase58(),
      balance: balance / LAMPORTS_PER_SOL,
      program: PROGRAM_ID.toBase58(),
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Get relayer info
app.get('/info', async (_req, res) => {
  try {
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    res.json({
      relayerAddress: relayerKeypair.publicKey.toBase58(),
      relayerBalance: balance / LAMPORTS_PER_SOL,
      programId: PROGRAM_ID.toBase58(),
      feePercent: 0,
      minFee: 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ZK Withdrawal - Full privacy with on-chain proof verification
 * Frontend sends pre-formatted proof bytes
 */
app.post('/withdraw', async (req, res) => {
  try {
    const {
      proof_a,        // Array of 64 bytes (already formatted)
      proof_b,        // Array of 128 bytes (already formatted)
      proof_c,        // Array of 64 bytes (already formatted)
      commitment,     // Array of 32 bytes (big-endian)
      nullifierHash,  // Array of 32 bytes (big-endian)
      recipient,      // Base58 address
      amount,         // Lamports
      fee,            // Relayer fee
    } = req.body;

    console.log('\n========================================');
    console.log('🔐 ZK WITHDRAWAL REQUEST');
    console.log('========================================');
    console.log('Recipient:', recipient);
    console.log('Amount:', amount, 'lamports', `(${amount / LAMPORTS_PER_SOL} SOL)`);

    // Validate
    if (!proof_a || !proof_b || !proof_c || !commitment || !nullifierHash || !recipient || !amount) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Convert arrays to buffers
    const proofA = Buffer.from(proof_a);
    const proofB = Buffer.from(proof_b);
    const proofC = Buffer.from(proof_c);
    const commitmentBytes = Buffer.from(commitment);
    const nullifierHashBytes = Buffer.from(nullifierHash);
    
    const recipientPubkey = new PublicKey(recipient);
    
    // Amount as little-endian u64 for Anchor
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(amount));
    
    const feeBuffer = Buffer.alloc(8);
    feeBuffer.writeBigUInt64LE(BigInt(fee || 0));

    // Derive PDAs
    const [pool] = PublicKey.findProgramAddressSync([Buffer.from('pool')], PROGRAM_ID);
    const [poolVault] = PublicKey.findProgramAddressSync([Buffer.from('vault')], PROGRAM_ID);
    const [nullifiers] = PublicKey.findProgramAddressSync([Buffer.from('nullifiers')], PROGRAM_ID);

    console.log('PDAs:');
    console.log('  Pool:', pool.toBase58());
    console.log('  Vault:', poolVault.toBase58());
    console.log('  Nullifiers:', nullifiers.toBase58());

    // Build instruction data for withdraw_zk
    // Format: discriminator + proof_a + proof_b + proof_c + commitment + nullifier_hash + recipient + amount + fee
    const instructionData = Buffer.concat([
      WITHDRAW_ZK_DISCRIM,       // 8 bytes
      proofA,                    // 64 bytes
      proofB,                    // 128 bytes
      proofC,                    // 64 bytes
      commitmentBytes,           // 32 bytes
      nullifierHashBytes,        // 32 bytes
      recipientPubkey.toBuffer(),// 32 bytes
      amountBuffer,              // 8 bytes
      feeBuffer,                 // 8 bytes
    ]);

    console.log('Instruction data size:', instructionData.length, 'bytes');

    const withdrawIx = new TransactionInstruction({
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: nullifiers, isSigner: false, isWritable: true },
        { pubkey: poolVault, isSigner: false, isWritable: true },
        { pubkey: recipientPubkey, isSigner: false, isWritable: true },
        { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: instructionData,
    });

    const transaction = new Transaction().add(withdrawIx);

    console.log('\nSubmitting ZK withdrawal to Solana...');
    
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [relayerKeypair],
      { commitment: 'confirmed' }
    );

    console.log('========================================');
    console.log('✅ ZK WITHDRAWAL SUCCESS!');
    console.log('TX:', signature);
    console.log('========================================\n');

    res.json({
      success: true,
      signature,
      recipient,
      amount,
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=devnet`,
    });

  } catch (error: any) {
    console.error('❌ ZK withdrawal error:', error.message);
    if (error.logs) {
      console.error('Program logs:');
      error.logs.forEach((log: string) => console.error('  ', log));
    }
    res.status(500).json({ 
      error: error.message,
      logs: error.logs || [],
    });
  }
});

/**
 * Demo Withdrawal - For testing, no ZK proof
 */
app.post('/demo-withdraw', async (req, res) => {
  try {
    const { recipient, amount } = req.body;

    console.log('\n========================================');
    console.log('⚡ DEMO WITHDRAWAL REQUEST');
    console.log('========================================');
    console.log('Recipient:', recipient);
    console.log('Amount:', amount, 'lamports');

    if (!recipient || !amount) {
      res.status(400).json({ error: 'Missing recipient or amount' });
      return;
    }

    const recipientPubkey = new PublicKey(recipient);
    
    const [pool] = PublicKey.findProgramAddressSync([Buffer.from('pool')], PROGRAM_ID);
    const [poolVault] = PublicKey.findProgramAddressSync([Buffer.from('vault')], PROGRAM_ID);

    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(amount));
    
    const instructionData = Buffer.concat([
      DEMO_WITHDRAW_DISCRIM,
      amountBuffer,
    ]);

    const withdrawIx = new TransactionInstruction({
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: poolVault, isSigner: false, isWritable: true },
        { pubkey: recipientPubkey, isSigner: false, isWritable: true },
        { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: instructionData,
    });

    const transaction = new Transaction().add(withdrawIx);

    console.log('Submitting demo withdrawal...');
    
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [relayerKeypair],
      { commitment: 'confirmed' }
    );

    console.log('✅ Demo withdrawal confirmed:', signature);

    res.json({
      success: true,
      signature,
      recipient,
      amount,
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=devnet`,
    });

  } catch (error: any) {
    console.error('❌ Demo withdraw error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log('🔒 WHISTLE RELAYER');
  console.log('='.repeat(50));
  console.log(`Port: ${PORT}`);
  console.log(`Wallet: ${relayerKeypair.publicKey.toBase58()}`);
  
  try {
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    
    if (balance < 0.01 * LAMPORTS_PER_SOL) {
      console.log('\n⚠️  LOW BALANCE! Fund the relayer:');
      console.log(`solana airdrop 1 ${relayerKeypair.publicKey.toBase58()} --url devnet`);
    }
  } catch (e) {
    console.log('Could not fetch balance');
  }
  
  console.log(`\nEndpoints:`);
  console.log(`  GET  /health        - Health check`);
  console.log(`  GET  /info          - Relayer info`);
  console.log(`  POST /withdraw      - ZK withdrawal (PRIVATE)`);
  console.log(`  POST /demo-withdraw - Demo withdrawal`);
  console.log('='.repeat(50) + '\n');
});
