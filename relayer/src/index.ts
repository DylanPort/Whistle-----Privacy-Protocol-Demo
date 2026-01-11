/**
 * Whistle Protocol Relayer Service
 * 
 * Submits withdrawal transactions on behalf of users.
 * Enables anonymous withdrawals by decoupling the gas payer from the recipient.
 */

import express from 'express';
import cors from 'cors';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL 
} from '@solana/web3.js';
import * as fs from 'fs';

// Configuration
const PORT = process.env.PORT || 3600;
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const POOL_PROGRAM_ID = new PublicKey(
  process.env.POOL_PROGRAM_ID || '7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV'
);
const MIN_FEE_LAMPORTS = 10_000_000; // 0.01 SOL

// Types
interface WithdrawRequest {
  proofA: string;
  proofB: string;
  proofC: string;
  nullifierHash: string;
  recipient: string;
  amount: string;
  merkleRoot: string;
  relayerFee: string;
}

// State
const processedNullifiers = new Set<string>();
const pendingRequests = new Map<string, number>();

// Server setup
const app = express();
app.use(cors());
app.use(express.json());

let connection: Connection;
let relayerKeypair: Keypair;

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    relayer: relayerKeypair?.publicKey.toBase58(),
    network: RPC_URL.includes('devnet') ? 'devnet' : 'mainnet',
    minFee: MIN_FEE_LAMPORTS,
  });
});

// Relayer info
app.get('/info', async (req, res) => {
  try {
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    res.json({
      address: relayerKeypair.publicKey.toBase58(),
      balance: balance / LAMPORTS_PER_SOL,
      minFee: MIN_FEE_LAMPORTS / LAMPORTS_PER_SOL,
      status: balance > MIN_FEE_LAMPORTS ? 'active' : 'inactive',
      processedCount: processedNullifiers.size,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Submit withdrawal
app.post('/withdraw', async (req, res) => {
  try {
    const request: WithdrawRequest = req.body;
    
    // Validate
    const validation = validateRequest(request);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    if (processedNullifiers.has(request.nullifierHash)) {
      return res.status(400).json({ error: 'Nullifier already used' });
    }
    
    if (pendingRequests.has(request.nullifierHash)) {
      return res.status(400).json({ error: 'Request pending' });
    }
    
    const relayerFee = BigInt(request.relayerFee);
    if (relayerFee < BigInt(MIN_FEE_LAMPORTS)) {
      return res.status(400).json({ 
        error: `Fee too low. Min: ${MIN_FEE_LAMPORTS} lamports` 
      });
    }
    
    pendingRequests.set(request.nullifierHash, Date.now());
    
    try {
      const signature = await submitTransaction(request);
      processedNullifiers.add(request.nullifierHash);
      pendingRequests.delete(request.nullifierHash);
      
      res.json({
        success: true,
        signature,
        explorer: `https://solscan.io/tx/${signature}?cluster=devnet`,
      });
    } catch (txError: any) {
      pendingRequests.delete(request.nullifierHash);
      throw txError;
    }
    
  } catch (error: any) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check nullifier
app.get('/nullifier/:hash', (req, res) => {
  const { hash } = req.params;
  res.json({
    nullifierHash: hash,
    spent: processedNullifiers.has(hash),
    pending: pendingRequests.has(hash),
  });
});

// Supported amounts
app.get('/amounts', (req, res) => {
  res.json({
    supported: [
      { sol: 1, lamports: '1000000000' },
      { sol: 10, lamports: '10000000000' },
      { sol: 100, lamports: '100000000000' },
    ],
  });
});

// Transaction submission
async function submitTransaction(request: WithdrawRequest): Promise<string> {
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool')],
    POOL_PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault')],
    POOL_PROGRAM_ID
  );
  const [nullifiersPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifiers')],
    POOL_PROGRAM_ID
  );
  const [rootsHistoryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('roots_history')],
    POOL_PROGRAM_ID
  );
  
  const recipient = new PublicKey(request.recipient);
  
  const discriminator = Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]);
  
  const proofA = Buffer.from(request.proofA, 'hex');
  const proofB = Buffer.from(request.proofB, 'hex');
  const proofC = Buffer.from(request.proofC, 'hex');
  const nullifierHash = Buffer.from(request.nullifierHash, 'hex');
  const recipientBytes = recipient.toBuffer();
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(request.amount));
  const feeBuffer = Buffer.alloc(8);
  feeBuffer.writeBigUInt64LE(BigInt(request.relayerFee));
  const merkleRoot = Buffer.from(request.merkleRoot, 'hex');
  
  const instructionData = Buffer.concat([
    discriminator,
    proofA,
    proofB,
    proofC,
    nullifierHash,
    recipientBytes,
    amountBuffer,
    feeBuffer,
    merkleRoot,
  ]);
  
  const tx = new Transaction().add({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: nullifiersPda, isSigner: false, isWritable: true },
      { pubkey: rootsHistoryPda, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: relayerKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: POOL_PROGRAM_ID,
    data: instructionData,
  });
  
  tx.feePayer = relayerKeypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(relayerKeypair);
  
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, 'confirmed');
  
  return signature;
}

// Validation
function validateRequest(request: WithdrawRequest): { valid: boolean; error?: string } {
  if (!request.proofA || !request.proofB || !request.proofC) {
    return { valid: false, error: 'Missing proof' };
  }
  
  if (!request.nullifierHash || !request.recipient || !request.amount || !request.merkleRoot) {
    return { valid: false, error: 'Missing required fields' };
  }
  
  if (Buffer.from(request.proofA, 'hex').length !== 64) {
    return { valid: false, error: 'Invalid proof A' };
  }
  
  if (Buffer.from(request.proofB, 'hex').length !== 128) {
    return { valid: false, error: 'Invalid proof B' };
  }
  
  if (Buffer.from(request.proofC, 'hex').length !== 64) {
    return { valid: false, error: 'Invalid proof C' };
  }
  
  try {
    new PublicKey(request.recipient);
  } catch {
    return { valid: false, error: 'Invalid recipient' };
  }
  
  const amount = BigInt(request.amount);
  const validAmounts = [
    BigInt(1_000_000_000),
    BigInt(10_000_000_000),
    BigInt(100_000_000_000),
  ];
  
  if (!validAmounts.includes(amount)) {
    return { valid: false, error: 'Invalid amount' };
  }
  
  return { valid: true };
}

// Startup
async function start() {
  console.log('Whistle Protocol Relayer');
  console.log('========================\n');
  
  connection = new Connection(RPC_URL, 'confirmed');
  console.log(`Network: ${RPC_URL}`);
  
  const keypairPath = process.env.RELAYER_KEYPAIR || './relayer-keypair.json';
  if (fs.existsSync(keypairPath)) {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    relayerKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    console.log(`Keypair: ${relayerKeypair.publicKey.toBase58()}`);
  } else {
    relayerKeypair = Keypair.generate();
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(relayerKeypair.secretKey)));
    console.log(`Generated: ${relayerKeypair.publicKey.toBase58()}`);
    console.log('Fund this address to enable relaying');
  }
  
  const balance = await connection.getBalance(relayerKeypair.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  app.listen(PORT, () => {
    console.log(`\nRunning on http://localhost:${PORT}`);
    console.log('\nEndpoints:');
    console.log('  GET  /health');
    console.log('  GET  /info');
    console.log('  POST /withdraw');
    console.log('  GET  /nullifier/:hash');
    console.log('  GET  /amounts');
  });
}

start().catch(console.error);
