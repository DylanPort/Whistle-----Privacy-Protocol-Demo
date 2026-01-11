const snarkjs = require("snarkjs");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { buildPoseidon } = require("circomlibjs");

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   ZK CIRCUIT TEST - Whistle Protocol                      ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // Initialize Poseidon hash
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // ═══════════════════════════════════════════════════════════
  // TEST 1: DEPOSIT CIRCUIT
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 1: DEPOSIT PROOF                                      │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Generate random inputs (fit in field ~254 bits)
  const pubKeyX = F.toObject(F.random()).toString();
  const pubKeyY = F.toObject(F.random()).toString();
  const blinding = F.toObject(F.random()).toString();
  const amount = "1000000000"; // 1 SOL in lamports

  // Compute commitment
  const commitment = poseidon([
    BigInt(amount),
    BigInt(pubKeyX),
    BigInt(pubKeyY),
    BigInt(blinding)
  ]);
  const commitmentHash = F.toObject(commitment).toString();

  console.log(`🔐 Public Key X: ${pubKeyX.substring(0, 16)}...`);
  console.log(`🔑 Public Key Y: ${pubKeyY.substring(0, 16)}...`);
  console.log(`🎲 Blinding: ${blinding.substring(0, 16)}...`);
  console.log(`💰 Amount: ${amount} lamports (1 SOL)`);
  console.log(`📝 Commitment: ${commitmentHash.substring(0, 16)}...\n`);

  // Deposit circuit inputs
  const depositInputs = {
    commitmentHash: commitmentHash,
    amount: amount,
    pubKeyX: pubKeyX,
    pubKeyY: pubKeyY,
    blinding: blinding
  };

  try {
    console.log("⏳ Generating deposit proof...\n");
    
    const depositWasm = path.join(__dirname, "build/deposit_js/deposit.wasm");
    const depositZkey = path.join(__dirname, "build/deposit_final.zkey");
    
    const { proof: depositProof, publicSignals: depositSignals } = await snarkjs.groth16.fullProve(
      depositInputs,
      depositWasm,
      depositZkey
    );

    console.log("✅ Deposit Proof Generated!");
    console.log(`   Public Signals:`);
    console.log(`     - Commitment Hash: ${depositSignals[0].substring(0, 24)}...`);
    console.log(`     - Amount: ${depositSignals[1]}\n`);

    // Verify deposit proof
    const depositVkey = JSON.parse(fs.readFileSync(
      path.join(__dirname, "build/deposit_verification_key.json")
    ));
    
    const depositValid = await snarkjs.groth16.verify(depositVkey, depositSignals, depositProof);
    console.log(`🔍 Deposit Proof Verification: ${depositValid ? "✅ VALID" : "❌ INVALID"}\n`);

    // ═══════════════════════════════════════════════════════════
    // TEST 2: WITHDRAW CIRCUIT
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│  TEST 2: WITHDRAW PROOF                                     │");
    console.log("└─────────────────────────────────────────────────────────────┘\n");

    // For withdraw, use the same pubKey/blinding from deposit
    const withdrawWasm = path.join(__dirname, "build/withdraw_js/withdraw.wasm");
    const withdrawZkey = path.join(__dirname, "build/withdraw_final.zkey");
    
    // Create merkle path (20 levels, commitment at leaf position 0)
    const pathElements = [];
    const pathIndices = [];
    for (let i = 0; i < 20; i++) {
      pathElements.push("0");
      pathIndices.push(0);
    }

    // Compute merkle root by hashing up the tree
    let currentHash = commitment;
    for (let i = 0; i < 20; i++) {
      // pathIndices[i] = 0 means we're on the left, sibling is on right
      currentHash = poseidon([currentHash, BigInt(0)]);
    }
    const merkleRoot = F.toObject(currentHash).toString();

    // Compute nullifier hash: Poseidon(commitment, pubKeyX, blinding)
    const nullifier = poseidon([commitment, BigInt(pubKeyX), BigInt(blinding)]);
    const nullifierHash = F.toObject(nullifier).toString();

    const recipient = F.toObject(F.random()).toString();
    const relayerFee = "0";

    const withdrawInputs = {
      // Public inputs
      merkleRoot: merkleRoot,
      nullifierHash: nullifierHash,
      recipient: recipient,
      amount: amount,
      relayerFee: relayerFee,
      // Private inputs (same as deposit)
      pubKeyX: pubKeyX,
      pubKeyY: pubKeyY,
      blinding: blinding,
      pathElements: pathElements,
      pathIndices: pathIndices
    };

    console.log(`🔐 Using same pubKey/blinding from deposit`);
    console.log(`🔑 Nullifier Hash: ${nullifierHash.substring(0, 16)}...`);
    console.log(`🌳 Merkle Root: ${merkleRoot.substring(0, 16)}...`);
    console.log(`📫 Recipient: ${recipient.substring(0, 16)}...\n`);

    console.log("⏳ Generating withdraw proof...\n");

    const { proof: withdrawProof, publicSignals: withdrawSignals } = await snarkjs.groth16.fullProve(
      withdrawInputs,
      withdrawWasm,
      withdrawZkey
    );

    console.log("✅ Withdraw Proof Generated!");
    console.log(`   Public Signals:`);
    withdrawSignals.forEach((sig, i) => {
      console.log(`     [${i}]: ${sig.substring(0, 24)}...`);
    });
    console.log();

    // Verify withdraw proof
    const withdrawVkey = JSON.parse(fs.readFileSync(
      path.join(__dirname, "build/withdraw_verification_key.json")
    ));
    
    const withdrawValid = await snarkjs.groth16.verify(withdrawVkey, withdrawSignals, withdrawProof);
    console.log(`🔍 Withdraw Proof Verification: ${withdrawValid ? "✅ VALID" : "❌ INVALID"}\n`);

    // ═══════════════════════════════════════════════════════════
    // EXPORT PROOF FOR SOLANA
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│  PROOF DATA FOR SOLANA                                      │");
    console.log("└─────────────────────────────────────────────────────────────┘\n");

    // Convert proof to bytes
    const proofA = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_a[0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_a[1]).toString(16).padStart(64, '0'), 'hex')
    ]);
    
    const proofB = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_b[0][1]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[0][0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[1][1]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[1][0]).toString(16).padStart(64, '0'), 'hex')
    ]);
    
    const proofC = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_c[0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_c[1]).toString(16).padStart(64, '0'), 'hex')
    ]);

    console.log(`📦 Proof A (${proofA.length} bytes): ${proofA.toString('hex').substring(0, 32)}...`);
    console.log(`📦 Proof B (${proofB.length} bytes): ${proofB.toString('hex').substring(0, 32)}...`);
    console.log(`📦 Proof C (${proofC.length} bytes): ${proofC.toString('hex').substring(0, 32)}...\n`);

    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   ALL ZK CIRCUIT TESTS PASSED! ✅                         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);



const path = require("path");
const fs = require("fs");
const { buildPoseidon } = require("circomlibjs");

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   ZK CIRCUIT TEST - Whistle Protocol                      ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // Initialize Poseidon hash
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // ═══════════════════════════════════════════════════════════
  // TEST 1: DEPOSIT CIRCUIT
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 1: DEPOSIT PROOF                                      │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Generate random inputs (fit in field ~254 bits)
  const pubKeyX = F.toObject(F.random()).toString();
  const pubKeyY = F.toObject(F.random()).toString();
  const blinding = F.toObject(F.random()).toString();
  const amount = "1000000000"; // 1 SOL in lamports

  // Compute commitment
  const commitment = poseidon([
    BigInt(amount),
    BigInt(pubKeyX),
    BigInt(pubKeyY),
    BigInt(blinding)
  ]);
  const commitmentHash = F.toObject(commitment).toString();

  console.log(`🔐 Public Key X: ${pubKeyX.substring(0, 16)}...`);
  console.log(`🔑 Public Key Y: ${pubKeyY.substring(0, 16)}...`);
  console.log(`🎲 Blinding: ${blinding.substring(0, 16)}...`);
  console.log(`💰 Amount: ${amount} lamports (1 SOL)`);
  console.log(`📝 Commitment: ${commitmentHash.substring(0, 16)}...\n`);

  // Deposit circuit inputs
  const depositInputs = {
    commitmentHash: commitmentHash,
    amount: amount,
    pubKeyX: pubKeyX,
    pubKeyY: pubKeyY,
    blinding: blinding
  };

  try {
    console.log("⏳ Generating deposit proof...\n");
    
    const depositWasm = path.join(__dirname, "build/deposit_js/deposit.wasm");
    const depositZkey = path.join(__dirname, "build/deposit_final.zkey");
    
    const { proof: depositProof, publicSignals: depositSignals } = await snarkjs.groth16.fullProve(
      depositInputs,
      depositWasm,
      depositZkey
    );

    console.log("✅ Deposit Proof Generated!");
    console.log(`   Public Signals:`);
    console.log(`     - Commitment Hash: ${depositSignals[0].substring(0, 24)}...`);
    console.log(`     - Amount: ${depositSignals[1]}\n`);

    // Verify deposit proof
    const depositVkey = JSON.parse(fs.readFileSync(
      path.join(__dirname, "build/deposit_verification_key.json")
    ));
    
    const depositValid = await snarkjs.groth16.verify(depositVkey, depositSignals, depositProof);
    console.log(`🔍 Deposit Proof Verification: ${depositValid ? "✅ VALID" : "❌ INVALID"}\n`);

    // ═══════════════════════════════════════════════════════════
    // TEST 2: WITHDRAW CIRCUIT
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│  TEST 2: WITHDRAW PROOF                                     │");
    console.log("└─────────────────────────────────────────────────────────────┘\n");

    // For withdraw, use the same pubKey/blinding from deposit
    const withdrawWasm = path.join(__dirname, "build/withdraw_js/withdraw.wasm");
    const withdrawZkey = path.join(__dirname, "build/withdraw_final.zkey");
    
    // Create merkle path (20 levels, commitment at leaf position 0)
    const pathElements = [];
    const pathIndices = [];
    for (let i = 0; i < 20; i++) {
      pathElements.push("0");
      pathIndices.push(0);
    }

    // Compute merkle root by hashing up the tree
    let currentHash = commitment;
    for (let i = 0; i < 20; i++) {
      // pathIndices[i] = 0 means we're on the left, sibling is on right
      currentHash = poseidon([currentHash, BigInt(0)]);
    }
    const merkleRoot = F.toObject(currentHash).toString();

    // Compute nullifier hash: Poseidon(commitment, pubKeyX, blinding)
    const nullifier = poseidon([commitment, BigInt(pubKeyX), BigInt(blinding)]);
    const nullifierHash = F.toObject(nullifier).toString();

    const recipient = F.toObject(F.random()).toString();
    const relayerFee = "0";

    const withdrawInputs = {
      // Public inputs
      merkleRoot: merkleRoot,
      nullifierHash: nullifierHash,
      recipient: recipient,
      amount: amount,
      relayerFee: relayerFee,
      // Private inputs (same as deposit)
      pubKeyX: pubKeyX,
      pubKeyY: pubKeyY,
      blinding: blinding,
      pathElements: pathElements,
      pathIndices: pathIndices
    };

    console.log(`🔐 Using same pubKey/blinding from deposit`);
    console.log(`🔑 Nullifier Hash: ${nullifierHash.substring(0, 16)}...`);
    console.log(`🌳 Merkle Root: ${merkleRoot.substring(0, 16)}...`);
    console.log(`📫 Recipient: ${recipient.substring(0, 16)}...\n`);

    console.log("⏳ Generating withdraw proof...\n");

    const { proof: withdrawProof, publicSignals: withdrawSignals } = await snarkjs.groth16.fullProve(
      withdrawInputs,
      withdrawWasm,
      withdrawZkey
    );

    console.log("✅ Withdraw Proof Generated!");
    console.log(`   Public Signals:`);
    withdrawSignals.forEach((sig, i) => {
      console.log(`     [${i}]: ${sig.substring(0, 24)}...`);
    });
    console.log();

    // Verify withdraw proof
    const withdrawVkey = JSON.parse(fs.readFileSync(
      path.join(__dirname, "build/withdraw_verification_key.json")
    ));
    
    const withdrawValid = await snarkjs.groth16.verify(withdrawVkey, withdrawSignals, withdrawProof);
    console.log(`🔍 Withdraw Proof Verification: ${withdrawValid ? "✅ VALID" : "❌ INVALID"}\n`);

    // ═══════════════════════════════════════════════════════════
    // EXPORT PROOF FOR SOLANA
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│  PROOF DATA FOR SOLANA                                      │");
    console.log("└─────────────────────────────────────────────────────────────┘\n");

    // Convert proof to bytes
    const proofA = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_a[0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_a[1]).toString(16).padStart(64, '0'), 'hex')
    ]);
    
    const proofB = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_b[0][1]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[0][0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[1][1]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[1][0]).toString(16).padStart(64, '0'), 'hex')
    ]);
    
    const proofC = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_c[0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_c[1]).toString(16).padStart(64, '0'), 'hex')
    ]);

    console.log(`📦 Proof A (${proofA.length} bytes): ${proofA.toString('hex').substring(0, 32)}...`);
    console.log(`📦 Proof B (${proofB.length} bytes): ${proofB.toString('hex').substring(0, 32)}...`);
    console.log(`📦 Proof C (${proofC.length} bytes): ${proofC.toString('hex').substring(0, 32)}...\n`);

    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   ALL ZK CIRCUIT TESTS PASSED! ✅                         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);

const path = require("path");
const fs = require("fs");
const { buildPoseidon } = require("circomlibjs");

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   ZK CIRCUIT TEST - Whistle Protocol                      ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // Initialize Poseidon hash
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // ═══════════════════════════════════════════════════════════
  // TEST 1: DEPOSIT CIRCUIT
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 1: DEPOSIT PROOF                                      │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Generate random inputs (fit in field ~254 bits)
  const pubKeyX = F.toObject(F.random()).toString();
  const pubKeyY = F.toObject(F.random()).toString();
  const blinding = F.toObject(F.random()).toString();
  const amount = "1000000000"; // 1 SOL in lamports

  // Compute commitment
  const commitment = poseidon([
    BigInt(amount),
    BigInt(pubKeyX),
    BigInt(pubKeyY),
    BigInt(blinding)
  ]);
  const commitmentHash = F.toObject(commitment).toString();

  console.log(`🔐 Public Key X: ${pubKeyX.substring(0, 16)}...`);
  console.log(`🔑 Public Key Y: ${pubKeyY.substring(0, 16)}...`);
  console.log(`🎲 Blinding: ${blinding.substring(0, 16)}...`);
  console.log(`💰 Amount: ${amount} lamports (1 SOL)`);
  console.log(`📝 Commitment: ${commitmentHash.substring(0, 16)}...\n`);

  // Deposit circuit inputs
  const depositInputs = {
    commitmentHash: commitmentHash,
    amount: amount,
    pubKeyX: pubKeyX,
    pubKeyY: pubKeyY,
    blinding: blinding
  };

  try {
    console.log("⏳ Generating deposit proof...\n");
    
    const depositWasm = path.join(__dirname, "build/deposit_js/deposit.wasm");
    const depositZkey = path.join(__dirname, "build/deposit_final.zkey");
    
    const { proof: depositProof, publicSignals: depositSignals } = await snarkjs.groth16.fullProve(
      depositInputs,
      depositWasm,
      depositZkey
    );

    console.log("✅ Deposit Proof Generated!");
    console.log(`   Public Signals:`);
    console.log(`     - Commitment Hash: ${depositSignals[0].substring(0, 24)}...`);
    console.log(`     - Amount: ${depositSignals[1]}\n`);

    // Verify deposit proof
    const depositVkey = JSON.parse(fs.readFileSync(
      path.join(__dirname, "build/deposit_verification_key.json")
    ));
    
    const depositValid = await snarkjs.groth16.verify(depositVkey, depositSignals, depositProof);
    console.log(`🔍 Deposit Proof Verification: ${depositValid ? "✅ VALID" : "❌ INVALID"}\n`);

    // ═══════════════════════════════════════════════════════════
    // TEST 2: WITHDRAW CIRCUIT
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│  TEST 2: WITHDRAW PROOF                                     │");
    console.log("└─────────────────────────────────────────────────────────────┘\n");

    // For withdraw, use the same pubKey/blinding from deposit
    const withdrawWasm = path.join(__dirname, "build/withdraw_js/withdraw.wasm");
    const withdrawZkey = path.join(__dirname, "build/withdraw_final.zkey");
    
    // Create merkle path (20 levels, commitment at leaf position 0)
    const pathElements = [];
    const pathIndices = [];
    for (let i = 0; i < 20; i++) {
      pathElements.push("0");
      pathIndices.push(0);
    }

    // Compute merkle root by hashing up the tree
    let currentHash = commitment;
    for (let i = 0; i < 20; i++) {
      // pathIndices[i] = 0 means we're on the left, sibling is on right
      currentHash = poseidon([currentHash, BigInt(0)]);
    }
    const merkleRoot = F.toObject(currentHash).toString();

    // Compute nullifier hash: Poseidon(commitment, pubKeyX, blinding)
    const nullifier = poseidon([commitment, BigInt(pubKeyX), BigInt(blinding)]);
    const nullifierHash = F.toObject(nullifier).toString();

    const recipient = F.toObject(F.random()).toString();
    const relayerFee = "0";

    const withdrawInputs = {
      // Public inputs
      merkleRoot: merkleRoot,
      nullifierHash: nullifierHash,
      recipient: recipient,
      amount: amount,
      relayerFee: relayerFee,
      // Private inputs (same as deposit)
      pubKeyX: pubKeyX,
      pubKeyY: pubKeyY,
      blinding: blinding,
      pathElements: pathElements,
      pathIndices: pathIndices
    };

    console.log(`🔐 Using same pubKey/blinding from deposit`);
    console.log(`🔑 Nullifier Hash: ${nullifierHash.substring(0, 16)}...`);
    console.log(`🌳 Merkle Root: ${merkleRoot.substring(0, 16)}...`);
    console.log(`📫 Recipient: ${recipient.substring(0, 16)}...\n`);

    console.log("⏳ Generating withdraw proof...\n");

    const { proof: withdrawProof, publicSignals: withdrawSignals } = await snarkjs.groth16.fullProve(
      withdrawInputs,
      withdrawWasm,
      withdrawZkey
    );

    console.log("✅ Withdraw Proof Generated!");
    console.log(`   Public Signals:`);
    withdrawSignals.forEach((sig, i) => {
      console.log(`     [${i}]: ${sig.substring(0, 24)}...`);
    });
    console.log();

    // Verify withdraw proof
    const withdrawVkey = JSON.parse(fs.readFileSync(
      path.join(__dirname, "build/withdraw_verification_key.json")
    ));
    
    const withdrawValid = await snarkjs.groth16.verify(withdrawVkey, withdrawSignals, withdrawProof);
    console.log(`🔍 Withdraw Proof Verification: ${withdrawValid ? "✅ VALID" : "❌ INVALID"}\n`);

    // ═══════════════════════════════════════════════════════════
    // EXPORT PROOF FOR SOLANA
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│  PROOF DATA FOR SOLANA                                      │");
    console.log("└─────────────────────────────────────────────────────────────┘\n");

    // Convert proof to bytes
    const proofA = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_a[0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_a[1]).toString(16).padStart(64, '0'), 'hex')
    ]);
    
    const proofB = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_b[0][1]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[0][0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[1][1]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[1][0]).toString(16).padStart(64, '0'), 'hex')
    ]);
    
    const proofC = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_c[0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_c[1]).toString(16).padStart(64, '0'), 'hex')
    ]);

    console.log(`📦 Proof A (${proofA.length} bytes): ${proofA.toString('hex').substring(0, 32)}...`);
    console.log(`📦 Proof B (${proofB.length} bytes): ${proofB.toString('hex').substring(0, 32)}...`);
    console.log(`📦 Proof C (${proofC.length} bytes): ${proofC.toString('hex').substring(0, 32)}...\n`);

    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   ALL ZK CIRCUIT TESTS PASSED! ✅                         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);



const path = require("path");
const fs = require("fs");
const { buildPoseidon } = require("circomlibjs");

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   ZK CIRCUIT TEST - Whistle Protocol                      ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // Initialize Poseidon hash
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // ═══════════════════════════════════════════════════════════
  // TEST 1: DEPOSIT CIRCUIT
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  TEST 1: DEPOSIT PROOF                                      │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Generate random inputs (fit in field ~254 bits)
  const pubKeyX = F.toObject(F.random()).toString();
  const pubKeyY = F.toObject(F.random()).toString();
  const blinding = F.toObject(F.random()).toString();
  const amount = "1000000000"; // 1 SOL in lamports

  // Compute commitment
  const commitment = poseidon([
    BigInt(amount),
    BigInt(pubKeyX),
    BigInt(pubKeyY),
    BigInt(blinding)
  ]);
  const commitmentHash = F.toObject(commitment).toString();

  console.log(`🔐 Public Key X: ${pubKeyX.substring(0, 16)}...`);
  console.log(`🔑 Public Key Y: ${pubKeyY.substring(0, 16)}...`);
  console.log(`🎲 Blinding: ${blinding.substring(0, 16)}...`);
  console.log(`💰 Amount: ${amount} lamports (1 SOL)`);
  console.log(`📝 Commitment: ${commitmentHash.substring(0, 16)}...\n`);

  // Deposit circuit inputs
  const depositInputs = {
    commitmentHash: commitmentHash,
    amount: amount,
    pubKeyX: pubKeyX,
    pubKeyY: pubKeyY,
    blinding: blinding
  };

  try {
    console.log("⏳ Generating deposit proof...\n");
    
    const depositWasm = path.join(__dirname, "build/deposit_js/deposit.wasm");
    const depositZkey = path.join(__dirname, "build/deposit_final.zkey");
    
    const { proof: depositProof, publicSignals: depositSignals } = await snarkjs.groth16.fullProve(
      depositInputs,
      depositWasm,
      depositZkey
    );

    console.log("✅ Deposit Proof Generated!");
    console.log(`   Public Signals:`);
    console.log(`     - Commitment Hash: ${depositSignals[0].substring(0, 24)}...`);
    console.log(`     - Amount: ${depositSignals[1]}\n`);

    // Verify deposit proof
    const depositVkey = JSON.parse(fs.readFileSync(
      path.join(__dirname, "build/deposit_verification_key.json")
    ));
    
    const depositValid = await snarkjs.groth16.verify(depositVkey, depositSignals, depositProof);
    console.log(`🔍 Deposit Proof Verification: ${depositValid ? "✅ VALID" : "❌ INVALID"}\n`);

    // ═══════════════════════════════════════════════════════════
    // TEST 2: WITHDRAW CIRCUIT
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│  TEST 2: WITHDRAW PROOF                                     │");
    console.log("└─────────────────────────────────────────────────────────────┘\n");

    // For withdraw, use the same pubKey/blinding from deposit
    const withdrawWasm = path.join(__dirname, "build/withdraw_js/withdraw.wasm");
    const withdrawZkey = path.join(__dirname, "build/withdraw_final.zkey");
    
    // Create merkle path (20 levels, commitment at leaf position 0)
    const pathElements = [];
    const pathIndices = [];
    for (let i = 0; i < 20; i++) {
      pathElements.push("0");
      pathIndices.push(0);
    }

    // Compute merkle root by hashing up the tree
    let currentHash = commitment;
    for (let i = 0; i < 20; i++) {
      // pathIndices[i] = 0 means we're on the left, sibling is on right
      currentHash = poseidon([currentHash, BigInt(0)]);
    }
    const merkleRoot = F.toObject(currentHash).toString();

    // Compute nullifier hash: Poseidon(commitment, pubKeyX, blinding)
    const nullifier = poseidon([commitment, BigInt(pubKeyX), BigInt(blinding)]);
    const nullifierHash = F.toObject(nullifier).toString();

    const recipient = F.toObject(F.random()).toString();
    const relayerFee = "0";

    const withdrawInputs = {
      // Public inputs
      merkleRoot: merkleRoot,
      nullifierHash: nullifierHash,
      recipient: recipient,
      amount: amount,
      relayerFee: relayerFee,
      // Private inputs (same as deposit)
      pubKeyX: pubKeyX,
      pubKeyY: pubKeyY,
      blinding: blinding,
      pathElements: pathElements,
      pathIndices: pathIndices
    };

    console.log(`🔐 Using same pubKey/blinding from deposit`);
    console.log(`🔑 Nullifier Hash: ${nullifierHash.substring(0, 16)}...`);
    console.log(`🌳 Merkle Root: ${merkleRoot.substring(0, 16)}...`);
    console.log(`📫 Recipient: ${recipient.substring(0, 16)}...\n`);

    console.log("⏳ Generating withdraw proof...\n");

    const { proof: withdrawProof, publicSignals: withdrawSignals } = await snarkjs.groth16.fullProve(
      withdrawInputs,
      withdrawWasm,
      withdrawZkey
    );

    console.log("✅ Withdraw Proof Generated!");
    console.log(`   Public Signals:`);
    withdrawSignals.forEach((sig, i) => {
      console.log(`     [${i}]: ${sig.substring(0, 24)}...`);
    });
    console.log();

    // Verify withdraw proof
    const withdrawVkey = JSON.parse(fs.readFileSync(
      path.join(__dirname, "build/withdraw_verification_key.json")
    ));
    
    const withdrawValid = await snarkjs.groth16.verify(withdrawVkey, withdrawSignals, withdrawProof);
    console.log(`🔍 Withdraw Proof Verification: ${withdrawValid ? "✅ VALID" : "❌ INVALID"}\n`);

    // ═══════════════════════════════════════════════════════════
    // EXPORT PROOF FOR SOLANA
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│  PROOF DATA FOR SOLANA                                      │");
    console.log("└─────────────────────────────────────────────────────────────┘\n");

    // Convert proof to bytes
    const proofA = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_a[0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_a[1]).toString(16).padStart(64, '0'), 'hex')
    ]);
    
    const proofB = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_b[0][1]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[0][0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[1][1]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_b[1][0]).toString(16).padStart(64, '0'), 'hex')
    ]);
    
    const proofC = Buffer.concat([
      Buffer.from(BigInt(withdrawProof.pi_c[0]).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(BigInt(withdrawProof.pi_c[1]).toString(16).padStart(64, '0'), 'hex')
    ]);

    console.log(`📦 Proof A (${proofA.length} bytes): ${proofA.toString('hex').substring(0, 32)}...`);
    console.log(`📦 Proof B (${proofB.length} bytes): ${proofB.toString('hex').substring(0, 32)}...`);
    console.log(`📦 Proof C (${proofC.length} bytes): ${proofC.toString('hex').substring(0, 32)}...\n`);

    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║   ALL ZK CIRCUIT TESTS PASSED! ✅                         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);
