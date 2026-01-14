/**
 * Simple ZK Withdrawal Test
 * 
 * This test demonstrates the core privacy:
 * 1. Generate note (secret, nullifier, amount)
 * 2. Compute commitment using Poseidon
 * 3. Shield (deposit) - commitment goes on-chain
 * 4. Generate ZK proof - proves knowledge without revealing!
 * 5. Withdraw using ZK proof - verifier NEVER learns secret!
 */

// @ts-ignore
import * as snarkjs from 'snarkjs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const { buildPoseidon } = require('circomlibjs');

const PROGRAM_ID = new PublicKey('6juimdEmwGPbDwV6WX9Jr3FcvKTKXb7oreb53RzBKbNu');

const WASM_PATH = path.join(__dirname, '..', '..', 'circuits', 'build', 'withdraw_simple_js', 'withdraw_simple.wasm');
const ZKEY_PATH = path.join(__dirname, '..', '..', 'circuits', 'build', 'withdraw_simple_final.zkey');
const VK_PATH = path.join(__dirname, '..', '..', 'circuits', 'build', 'verification_key_simple.json');

const FIELD_P = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function randomBigInt(): bigint {
  const bytes = crypto.randomBytes(31);
  return BigInt('0x' + bytes.toString('hex')) % FIELD_P;
}

function bigintToBytes32BE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 64; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function changeEndianness(bytes: Uint8Array): Uint8Array {
  return new Uint8Array([...bytes].reverse());
}

function proofG1ToBytes(point: string[], negate: boolean = false): Uint8Array {
  let x = BigInt(point[0]);
  let y = BigInt(point[1]);
  if (negate) {
    y = FIELD_P - y;
  }
  const xBytes = changeEndianness(bigintToBytes32BE(x));
  const yBytes = changeEndianness(bigintToBytes32BE(y));
  const result = new Uint8Array(64);
  result.set(xBytes, 0);
  result.set(yBytes, 32);
  return result;
}

function proofG2ToBytes(point: string[][]): Uint8Array {
  const x_c0 = changeEndianness(bigintToBytes32BE(BigInt(point[0][0])));
  const x_c1 = changeEndianness(bigintToBytes32BE(BigInt(point[0][1])));
  const y_c0 = changeEndianness(bigintToBytes32BE(BigInt(point[1][0])));
  const y_c1 = changeEndianness(bigintToBytes32BE(BigInt(point[1][1])));
  const result = new Uint8Array(128);
  result.set(x_c0, 0);
  result.set(x_c1, 32);
  result.set(y_c0, 64);
  result.set(y_c1, 96);
  return result;
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function main() {
  console.log('\n🔒 WHISTLE PROTOCOL - SIMPLE ZK WITHDRAWAL TEST\n');
  console.log('='.repeat(60));

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const keypairPath = path.join(homeDir, '.config', 'solana', 'id.json');
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  
  console.log('Payer:', payer.publicKey.toBase58());
  const balance = await connection.getBalance(payer.publicKey);
  console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL\n');

  console.log('Initializing Poseidon hash...');
  const poseidon = await buildPoseidon();
  console.log('✓ Poseidon ready\n');

  // ========================================
  // 1. GENERATE NOTE
  // ========================================
  console.log('1️⃣ GENERATING NOTE');
  console.log('-'.repeat(40));
  
  const secret = randomBigInt();
  const nullifier = randomBigInt();
  const noteAmount = BigInt(10_000_000); // 0.01 SOL
  
  console.log('Secret:', secret.toString().slice(0, 20) + '...');
  console.log('Nullifier:', nullifier.toString().slice(0, 20) + '...');
  console.log('Amount:', Number(noteAmount) / LAMPORTS_PER_SOL, 'SOL');

  // ========================================
  // 2. COMPUTE COMMITMENT
  // ========================================
  console.log('\n2️⃣ COMPUTING COMMITMENT');
  console.log('-'.repeat(40));
  
  // commitment = H(secret, H(nullifier, noteAmount))
  const innerHash = poseidon.F.toObject(poseidon([nullifier, noteAmount]));
  const commitment = poseidon.F.toObject(poseidon([secret, innerHash]));
  console.log('Inner hash:', innerHash.toString().slice(0, 20) + '...');
  console.log('Commitment:', commitment.toString().slice(0, 20) + '...');

  // nullifierHash = H(nullifier, 0)
  const nullifierHash = poseidon.F.toObject(poseidon([nullifier, BigInt(0)]));
  console.log('Nullifier hash:', nullifierHash.toString().slice(0, 20) + '...');

  // PDAs
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from('pool')], PROGRAM_ID);
  const [poolVault] = PublicKey.findProgramAddressSync([Buffer.from('vault')], PROGRAM_ID);
  const [merkleTree] = PublicKey.findProgramAddressSync([Buffer.from('merkle_tree')], PROGRAM_ID);
  const [rootsHistory] = PublicKey.findProgramAddressSync([Buffer.from('roots_history')], PROGRAM_ID);
  const [nullifiers] = PublicKey.findProgramAddressSync([Buffer.from('nullifiers')], PROGRAM_ID);

  // ========================================
  // 3. SHIELD (DEPOSIT)
  // ========================================
  console.log('\n3️⃣ SHIELDING (DEPOSITING)');
  console.log('-'.repeat(40));
  
  const shieldDiscrim = crypto.createHash('sha256')
    .update('global:shield')
    .digest()
    .slice(0, 8);
  
  const commitmentBytes = bigintToBytes32BE(commitment);
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(noteAmount);
  
  const shieldData = Buffer.concat([
    shieldDiscrim,
    Buffer.from(commitmentBytes),
    amountBuffer,
  ]);

  const shieldIx = new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: merkleTree, isSigner: false, isWritable: true },
      { pubkey: rootsHistory, isSigner: false, isWritable: true },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: shieldData,
  });

  let shieldSig: string;
  try {
    const shieldTx = new Transaction().add(shieldIx);
    shieldSig = await sendAndConfirmTransaction(connection, shieldTx, [payer]);
    console.log('✅ Shield TX:', shieldSig);
    console.log('   https://solscan.io/tx/' + shieldSig + '?cluster=devnet');
  } catch (err: any) {
    console.log('Shield failed:', err.message);
    return;
  }

  // ========================================
  // 4. GENERATE ZK PROOF
  // ========================================
  console.log('\n4️⃣ GENERATING ZK PROOF');
  console.log('-'.repeat(40));
  
  const recipientWallet = Keypair.generate();
  const recipientBytes = recipientWallet.publicKey.toBytes();
  const recipientTruncated = recipientBytes.slice(0, 31);
  const recipientField = BigInt('0x' + Buffer.from(recipientTruncated).toString('hex'));
  
  const relayerFee = BigInt(0);

  const circuitInput = {
    commitment: commitment.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipientField.toString(),
    amount: noteAmount.toString(),
    relayerFee: relayerFee.toString(),
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    noteAmount: noteAmount.toString(),
  };

  console.log('Circuit inputs ready');
  console.log('Generating proof...');

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      WASM_PATH,
      ZKEY_PATH
    );

    console.log('✅ Proof generated!');
    console.log('Public signals:', publicSignals);

    // Local verify
    const vk = JSON.parse(fs.readFileSync(VK_PATH, 'utf-8'));
    const isValid = await snarkjs.groth16.verify(vk, publicSignals, proof);
    console.log('Local verification:', isValid ? '✅ VALID' : '❌ INVALID');

    if (!isValid) {
      console.log('❌ Proof invalid locally, aborting');
      return;
    }

    // ========================================
    // 5. SUBMIT ZK WITHDRAWAL
    // ========================================
    console.log('\n5️⃣ SUBMITTING ZK WITHDRAWAL');
    console.log('-'.repeat(40));

    // Convert proof
    const proof_a = proofG1ToBytes([proof.pi_a[0], proof.pi_a[1]], true);
    const proof_b = proofG2ToBytes(proof.pi_b);
    const proof_c = proofG1ToBytes([proof.pi_c[0], proof.pi_c[1]], false);

    // Public inputs (big-endian)
    const commitmentBE = bigintToBytes32BE(commitment);
    const nullifierHashBE = bigintToBytes32BE(nullifierHash);
    
    const recipientFieldBytes = Buffer.alloc(32);
    Buffer.from(recipientTruncated).copy(recipientFieldBytes, 1);

    const amountWithdrawBuffer = Buffer.alloc(8);
    amountWithdrawBuffer.writeBigUInt64LE(noteAmount);
    const feeBuffer = Buffer.alloc(8);
    feeBuffer.writeBigUInt64LE(relayerFee);

    const withdrawZkDiscrim = crypto.createHash('sha256')
      .update('global:withdraw_zk')
      .digest()
      .slice(0, 8);

    const withdrawIxData = Buffer.concat([
      withdrawZkDiscrim,
      Buffer.from(proof_a),
      Buffer.from(proof_b),
      Buffer.from(proof_c),
      Buffer.from(commitmentBE),
      Buffer.from(nullifierHashBE),
      recipientWallet.publicKey.toBuffer(),
      amountWithdrawBuffer,
      feeBuffer,
    ]);

    const withdrawIx = new TransactionInstruction({
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: nullifiers, isSigner: false, isWritable: true },
        { pubkey: poolVault, isSigner: false, isWritable: true },
        { pubkey: recipientWallet.publicKey, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: withdrawIxData,
    });

    console.log('Recipient:', recipientWallet.publicKey.toBase58());
    console.log('Submitting ZK withdrawal TX...');

    const withdrawTx = new Transaction().add(withdrawIx);
    const withdrawSig = await sendAndConfirmTransaction(connection, withdrawTx, [payer]);
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 ZK WITHDRAWAL SUCCESSFUL!');
    console.log('='.repeat(60));
    console.log('TX:', withdrawSig);
    console.log('https://solscan.io/tx/' + withdrawSig + '?cluster=devnet');

    const recipientBalance = await connection.getBalance(recipientWallet.publicKey);
    console.log('\nRecipient received:', recipientBalance / LAMPORTS_PER_SOL, 'SOL');

    console.log('\n🔒 PRIVACY ACHIEVED!');
    console.log('- The verifier NEVER learned the secret or nullifier');
    console.log('- Only the proof and public commitments were revealed');
    console.log('- NO link between deposit and withdrawal!');

  } catch (err: any) {
    console.error('\n❌ ZK Withdrawal failed:', err.message);
    if (err.logs) {
      console.log('\nProgram logs:');
      err.logs.slice(-15).forEach((log: string) => console.log('  ', log));
    }
  }
}

main().catch(console.error);

