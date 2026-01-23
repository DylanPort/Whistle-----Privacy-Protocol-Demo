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
import Database from 'better-sqlite3';

const app = express();

// ============================================================================
// SECURITY FIX: Restrict CORS to allowed origins only
// ============================================================================
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'http://localhost:3000',      // Local development
      'http://localhost:3001',      // Alternative dev port
      'https://whistle-protocol.netlify.app',  // Production frontend
      'https://whistle.finance',    // Production domain (example)
    ];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) {
      callback(null, true);
      return;
    }
    
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`⚠️ CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Large payloads for proofs

// ============================================================================
// SECURITY FIX: Rate Limiting to prevent spam/DoS attacks
// ============================================================================
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5; // 5 requests per minute per IP

function getClientIP(req: express.Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() 
    || req.socket.remoteAddress 
    || 'unknown';
}

function checkRateLimit(req: express.Request, res: express.Response): boolean {
  const clientIP = getClientIP(req);
  const now = Date.now();
  
  let entry = rateLimitMap.get(clientIP);
  
  if (!entry || now > entry.resetTime) {
    entry = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(clientIP, entry);
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    res.status(429).json({ 
      error: 'Rate limit exceeded',
      retryAfter,
      message: `Too many requests. Please try again in ${retryAfter} seconds.`
    });
    console.log(`⚠️ Rate limit exceeded for IP: ${clientIP}`);
    return false;
  }
  
  entry.count++;
  return true;
}

// Clean up expired rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 300000);

// ============================================================================
// SECURITY FIX: Persist nullifiers to SQLite database
// ============================================================================
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'relayer.db');
const db = new Database(DB_PATH);

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS processed_nullifiers (
    nullifier_hash TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    amount INTEGER NOT NULL,
    tx_signature TEXT NOT NULL,
    processed_at INTEGER NOT NULL
  );
  
  CREATE INDEX IF NOT EXISTS idx_processed_at ON processed_nullifiers(processed_at);
  CREATE INDEX IF NOT EXISTS idx_recipient ON processed_nullifiers(recipient);
`);

console.log(`📁 Database initialized at: ${DB_PATH}`);

// Prepared statements for better performance
const checkNullifierStmt = db.prepare('SELECT 1 FROM processed_nullifiers WHERE nullifier_hash = ?');
const insertNullifierStmt = db.prepare(`
  INSERT INTO processed_nullifiers (nullifier_hash, recipient, amount, tx_signature, processed_at)
  VALUES (?, ?, ?, ?, ?)
`);
const countNullifiersStmt = db.prepare('SELECT COUNT(*) as count FROM processed_nullifiers');

function isNullifierProcessed(nullifierHash: Buffer): boolean {
  const key = nullifierHash.toString('hex');
  const result = checkNullifierStmt.get(key);
  return result !== undefined;
}

function markNullifierProcessed(
  nullifierHash: Buffer, 
  recipient: string, 
  amount: number, 
  txSignature: string
): void {
  const key = nullifierHash.toString('hex');
  try {
    insertNullifierStmt.run(key, recipient, amount, txSignature, Date.now());
  } catch (error: any) {
    // Ignore duplicate key errors (nullifier already exists)
    if (!error.message.includes('UNIQUE constraint failed')) {
      throw error;
    }
  }
}

function getNullifierCount(): number {
  const result = countNullifiersStmt.get() as { count: number };
  return result.count;
}

// Configuration
const PORT = process.env.PORT || 3005;
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('AMtxCTW99zCBfhukVdN8YvA3AsdSJ7nsgnUdHpth7QTD');

// Valid denominations (must match contract)
const VALID_DENOMINATIONS = [
  10_000_000,      // 0.01 SOL
  50_000_000,      // 0.05 SOL
  100_000_000,     // 0.1 SOL
  1_000_000_000,   // 1 SOL
  10_000_000_000,  // 10 SOL
  100_000_000_000, // 100 SOL
];

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
// Use 'withdraw' instruction which uses the production withdraw_merkle circuit
const WITHDRAW_DISCRIM = crypto.createHash('sha256')
  .update('global:withdraw')
  .digest()
  .slice(0, 8);

// SECURITY FIX: Removed DEMO_WITHDRAW_DISCRIM - demo_withdraw function was removed from contract

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
      processedWithdrawals: getNullifierCount(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
app.get('/stats', async (_req, res) => {
  try {
    const totalWithdrawals = getNullifierCount();
    
    // Get recent withdrawals (last 24 hours)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentStmt = db.prepare('SELECT COUNT(*) as count FROM processed_nullifiers WHERE processed_at > ?');
    const recentResult = recentStmt.get(oneDayAgo) as { count: number };
    
    // Get total volume
    const volumeStmt = db.prepare('SELECT SUM(amount) as total FROM processed_nullifiers');
    const volumeResult = volumeStmt.get() as { total: number | null };
    
    res.json({
      totalWithdrawals,
      withdrawalsLast24h: recentResult.count,
      totalVolumeLamports: volumeResult.total || 0,
      totalVolumeSOL: (volumeResult.total || 0) / LAMPORTS_PER_SOL,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ZK Withdrawal - Full privacy with on-chain proof verification
 * Frontend sends pre-formatted proof bytes
 * 
 * SECURITY: Rate limited, nullifier tracking, input validation
 */
app.post('/withdraw', async (req, res) => {
  // SECURITY FIX: Check rate limit first
  if (!checkRateLimit(req, res)) {
    return;
  }

  try {
    const {
      proof_a,        // Array of 64 bytes (already formatted)
      proof_b,        // Array of 128 bytes (already formatted)
      proof_c,        // Array of 64 bytes (already formatted)
      nullifierHash,  // Array of 32 bytes (big-endian)
      recipient,      // Base58 address
      amount,         // Lamports
      fee,            // Relayer fee
      merkleRoot,     // 32 bytes - current merkle root
    } = req.body;

    const clientIP = getClientIP(req);
    console.log('\n========================================');
    console.log('🔐 ZK WITHDRAWAL REQUEST (withdraw_merkle)');
    console.log('========================================');
    console.log('Client IP:', clientIP);
    console.log('Recipient:', recipient);
    console.log('Amount:', amount, 'lamports', `(${amount / LAMPORTS_PER_SOL} SOL)`);

    // SECURITY FIX: Enhanced validation
    if (!proof_a || !proof_b || !proof_c || !nullifierHash || !recipient || !amount || !merkleRoot) {
      res.status(400).json({ error: 'Missing required fields (proof_a, proof_b, proof_c, nullifierHash, recipient, amount, merkleRoot)' });
      return;
    }

    // Validate proof sizes
    if (proof_a.length !== 64 || proof_b.length !== 128 || proof_c.length !== 64) {
      res.status(400).json({ error: 'Invalid proof size' });
      return;
    }

    if (nullifierHash.length !== 32 || merkleRoot.length !== 32) {
      res.status(400).json({ error: 'Invalid hash size (must be 32 bytes)' });
      return;
    }

    // SECURITY FIX: Validate amount is a valid denomination
    if (!VALID_DENOMINATIONS.includes(Number(amount))) {
      res.status(400).json({ 
        error: 'Invalid withdrawal amount',
        validDenominations: VALID_DENOMINATIONS.map(d => `${d / LAMPORTS_PER_SOL} SOL`),
      });
      return;
    }

    // SECURITY FIX: Validate fee is not too high (max 10%)
    if (Number(fee) > Number(amount) / 10) {
      res.status(400).json({ error: 'Relayer fee too high (max 10%)' });
      return;
    }

    // Convert arrays to buffers
    const proofA = Buffer.from(proof_a);
    const proofB = Buffer.from(proof_b);
    const proofC = Buffer.from(proof_c);
    const nullifierHashBytes = Buffer.from(nullifierHash);
    const merkleRootBytes = Buffer.from(merkleRoot);

    // SECURITY FIX: Check if nullifier was already processed by this relayer
    if (isNullifierProcessed(nullifierHashBytes)) {
      console.log('⚠️ Duplicate nullifier detected!');
      res.status(400).json({ error: 'Nullifier already processed - possible replay attack' });
      return;
    }
    
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
    const [rootsHistory] = PublicKey.findProgramAddressSync([Buffer.from('roots_history')], PROGRAM_ID);
    const [merkleTree] = PublicKey.findProgramAddressSync([Buffer.from('merkle_tree')], PROGRAM_ID);

    console.log('PDAs:');
    console.log('  Pool:', pool.toBase58());
    console.log('  Vault:', poolVault.toBase58());
    console.log('  Nullifiers:', nullifiers.toBase58());
    console.log('  RootsHistory:', rootsHistory.toBase58());

    // Build instruction data for 'withdraw' (uses withdraw_merkle circuit)
    // Format: discriminator + proof_a + proof_b + proof_c + nullifier_hash + recipient + amount + fee + merkle_root
    const instructionData = Buffer.concat([
      WITHDRAW_DISCRIM,          // 8 bytes
      proofA,                    // 64 bytes
      proofB,                    // 128 bytes
      proofC,                    // 64 bytes
      nullifierHashBytes,        // 32 bytes
      recipientPubkey.toBuffer(),// 32 bytes
      amountBuffer,              // 8 bytes
      feeBuffer,                 // 8 bytes
      merkleRootBytes,           // 32 bytes
    ]);

    console.log('Instruction data size:', instructionData.length, 'bytes');

    // Account layout for 'withdraw' instruction (Unshield context)
    const withdrawIx = new TransactionInstruction({
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: merkleTree, isSigner: false, isWritable: true },
        { pubkey: nullifiers, isSigner: false, isWritable: true },
        { pubkey: rootsHistory, isSigner: false, isWritable: true },
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

    // SECURITY FIX: Mark nullifier as processed AFTER successful transaction
    // Now persisted to SQLite database
    markNullifierProcessed(nullifierHashBytes, recipient, Number(amount), signature);

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

// SECURITY FIX: demo-withdraw endpoint REMOVED
// The demo_withdraw function was a security vulnerability that allowed
// anyone to drain all funds without proof verification.
// 
// app.post('/demo-withdraw', ...) - REMOVED FOR SECURITY

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
  console.log(`  GET  /stats         - Withdrawal statistics`);
  console.log(`  POST /withdraw      - ZK withdrawal (PRIVATE)`);
  console.log(`\nSecurity features:`);
  console.log(`  - Rate limiting: ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MS/1000}s per IP`);
  console.log(`  - Nullifier replay protection (SQLite persisted)`);
  console.log(`  - Input validation`);
  console.log(`  - CORS restricted to: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`\nDatabase: ${DB_PATH}`);
  console.log(`  - Processed nullifiers: ${getNullifierCount()}`);
  console.log('='.repeat(50) + '\n');
});

// Graceful shutdown - close database
process.on('SIGINT', () => {
  console.log('\nShutting down relayer...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down relayer...');
  db.close();
  process.exit(0);
});
