/**
 * ZK Test with swapped G2 coefficients for proof_b
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
const SCALAR_R = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

function randomBigInt(): bigint {
  return BigInt('0x' + crypto.randomBytes(31).toString('hex')) % SCALAR_R;
}

function bigintToBytes32BE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 64; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function proofG1BE(point: string[], negate: boolean): Uint8Array {
  let x = BigInt(point[0]);
  let y = BigInt(point[1]);
  if (negate) y = FIELD_P - y;
  const result = new Uint8Array(64);
  result.set(bigintToBytes32BE(x), 0);
  result.set(bigintToBytes32BE(y), 32);
  return result;
}

// Swapped G2: [x_c1, x_c0, y_c1, y_c0] to match VK
function proofG2BE_Swapped(point: string[][]): Uint8Array {
  const result = new Uint8Array(128);
  result.set(bigintToBytes32BE(BigInt(point[0][1])), 0);  // x_c1
  result.set(bigintToBytes32BE(BigInt(point[0][0])), 32); // x_c0
  result.set(bigintToBytes32BE(BigInt(point[1][1])), 64); // y_c1
  result.set(bigintToBytes32BE(BigInt(point[1][0])), 96); // y_c0
  return result;
}

async function main() {
  console.log('\n🔒 ZK TEST - SWAPPED G2 FORMAT\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const keypairPath = path.join(homeDir, '.config', 'solana', 'id.json');
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  
  console.log('Payer:', payer.publicKey.toBase58());
  
  const poseidon = await buildPoseidon();
  
  const secret = randomBigInt();
  const nullifier = randomBigInt();
  const noteAmount = BigInt(10_000_000);
  
  const innerHash = poseidon.F.toObject(poseidon([nullifier, noteAmount]));
  const commitment = poseidon.F.toObject(poseidon([secret, innerHash]));
  const nullifierHash = poseidon.F.toObject(poseidon([nullifier, BigInt(0)]));
  
  console.log('Commitment:', commitment.toString().slice(0, 20) + '...');
  
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from('pool')], PROGRAM_ID);
  const [poolVault] = PublicKey.findProgramAddressSync([Buffer.from('vault')], PROGRAM_ID);
  const [merkleTree] = PublicKey.findProgramAddressSync([Buffer.from('merkle_tree')], PROGRAM_ID);
  const [rootsHistory] = PublicKey.findProgramAddressSync([Buffer.from('roots_history')], PROGRAM_ID);
  const [nullifiers] = PublicKey.findProgramAddressSync([Buffer.from('nullifiers')], PROGRAM_ID);

  // Shield
  console.log('\nShielding...');
  const shieldDiscrim = crypto.createHash('sha256').update('global:shield').digest().slice(0, 8);
  const commitmentBytes = bigintToBytes32BE(commitment);
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(noteAmount);
  
  const shieldData = Buffer.concat([shieldDiscrim, Buffer.from(commitmentBytes), amountBuffer]);
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

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(shieldIx), [payer]);
    console.log('✅ Shielded');
  } catch (e: any) {
    console.log('Shield:', e.message?.slice(0, 50));
  }

  // Generate proof
  console.log('\nGenerating proof...');
  const recipientWallet = Keypair.generate();
  const recipientTruncated = recipientWallet.publicKey.toBytes().slice(0, 31);
  const recipientField = BigInt('0x' + Buffer.from(recipientTruncated).toString('hex'));
  
  const circuitInput = {
    commitment: commitment.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipientField.toString(),
    amount: noteAmount.toString(),
    relayerFee: '0',
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    noteAmount: noteAmount.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInput, WASM_PATH, ZKEY_PATH);
  
  const vk = JSON.parse(fs.readFileSync(VK_PATH, 'utf-8'));
  const isValid = await snarkjs.groth16.verify(vk, publicSignals, proof);
  console.log('Local verify:', isValid ? '✅' : '❌');
  
  if (!isValid) return;

  // Submit with swapped G2
  console.log('\nSubmitting ZK withdrawal (swapped G2)...');
  
  const proof_a = proofG1BE([proof.pi_a[0], proof.pi_a[1]], true); // Negate
  const proof_b = proofG2BE_Swapped(proof.pi_b); // Swapped!
  const proof_c = proofG1BE([proof.pi_c[0], proof.pi_c[1]], false);
  
  const commitmentPub = bigintToBytes32BE(commitment);
  const nullifierHashPub = bigintToBytes32BE(nullifierHash);
  const recipientFieldPub = Buffer.alloc(32);
  Buffer.from(recipientTruncated).copy(recipientFieldPub, 1);
  
  const amountWithdrawBuffer = Buffer.alloc(8);
  amountWithdrawBuffer.writeBigUInt64LE(noteAmount);
  
  const withdrawZkDiscrim = crypto.createHash('sha256').update('global:withdraw_zk').digest().slice(0, 8);
  
  const withdrawIxData = Buffer.concat([
    withdrawZkDiscrim,
    Buffer.from(proof_a),
    Buffer.from(proof_b),
    Buffer.from(proof_c),
    Buffer.from(commitmentPub),
    Buffer.from(nullifierHashPub),
    recipientWallet.publicKey.toBuffer(),
    amountWithdrawBuffer,
    Buffer.alloc(8), // fee = 0
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

  try {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(withdrawIx), [payer]);
    console.log('\n' + '='.repeat(60));
    console.log('🎉 ZK WITHDRAWAL SUCCESS!');
    console.log('='.repeat(60));
    console.log('TX:', sig);
    console.log('https://solscan.io/tx/' + sig + '?cluster=devnet');
  } catch (err: any) {
    console.error('\n❌ Failed:', err.message?.slice(0, 80));
    if (err.logs) {
      err.logs.slice(-8).forEach((l: string) => console.log('  ', l));
    }
  }
}

main().catch(console.error);

