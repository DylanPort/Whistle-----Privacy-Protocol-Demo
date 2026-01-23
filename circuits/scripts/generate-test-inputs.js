/**
 * WHISTLE PROTOCOL - Test Input Generator
 * 
 * Generates test inputs for production circuits to verify they compile
 * and work correctly before deployment.
 * 
 * Usage:
 *   node scripts/generate-test-inputs.js [circuit-name]
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build', 'production');

// BN254 field prime (snark scalar field)
const FIELD_PRIME = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

/**
 * Generate a random field element
 */
function randomFieldElement() {
    const bytes = crypto.randomBytes(32);
    let n = BigInt('0x' + bytes.toString('hex'));
    return (n % (FIELD_PRIME - 1n) + 1n).toString();
}

/**
 * Simple Poseidon hash placeholder (for testing structure only)
 * In production, use proper Poseidon implementation
 */
function poseidonHash(inputs) {
    // This is a PLACEHOLDER - real Poseidon needed for actual proofs
    const combined = inputs.map(i => BigInt(i).toString(16).padStart(64, '0')).join('');
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    return (BigInt('0x' + hash) % FIELD_PRIME).toString();
}

/**
 * Generate empty Merkle path (placeholder zeros)
 */
function generateMerklePath(levels) {
    const pathElements = [];
    const pathIndices = [];
    
    for (let i = 0; i < levels; i++) {
        pathElements.push('0'); // Empty sibling
        pathIndices.push('0');  // Left position
    }
    
    return { pathElements, pathIndices };
}

/**
 * Generate test input for withdraw_merkle circuit
 */
function generateWithdrawMerkleInput(levels = 10) {
    const secret = randomFieldElement();
    const nullifier = randomFieldElement();
    const noteAmount = '1000000000'; // 1 SOL in lamports
    const amount = '900000000';     // 0.9 SOL
    const relayerFee = '100000000'; // 0.1 SOL
    
    // Compute commitment
    const innerHash = poseidonHash([nullifier, noteAmount]);
    const commitment = poseidonHash([secret, innerHash]);
    
    // Compute nullifier hash
    const nullifierHash = poseidonHash([nullifier, '0']);
    
    // For testing, merkle root = commitment (single-leaf tree placeholder)
    const merkleRoot = commitment;
    
    // Random recipient
    const recipient = randomFieldElement();
    
    const { pathElements, pathIndices } = generateMerklePath(levels);
    
    return {
        // Public inputs
        merkleRoot,
        nullifierHash,
        recipient,
        amount,
        relayerFee,
        
        // Private inputs
        secret,
        nullifier,
        noteAmount,
        pathElements,
        pathIndices
    };
}

/**
 * Generate test input for unshield_change circuit
 */
function generateUnshieldChangeInput(levels = 10) {
    const secret = randomFieldElement();
    const nullifier = randomFieldElement();
    const noteAmount = '5000000000'; // 5 SOL
    const withdrawalAmount = '1000000000'; // 1 SOL
    const relayerFee = '100000000'; // 0.1 SOL
    const changeAmount = '3900000000'; // 3.9 SOL
    
    // Change note secrets
    const changeSecret = randomFieldElement();
    const changeNullifier = randomFieldElement();
    
    // Compute input commitment
    const innerHash = poseidonHash([nullifier, noteAmount]);
    const commitment = poseidonHash([secret, innerHash]);
    
    // Compute nullifier hash
    const nullifierHash = poseidonHash([nullifier, '0']);
    
    // Compute change commitment
    const changeInner = poseidonHash([changeNullifier, changeAmount]);
    const changeCommitment = poseidonHash([changeSecret, changeInner]);
    
    const merkleRoot = commitment;
    const recipient = randomFieldElement();
    
    const { pathElements, pathIndices } = generateMerklePath(levels);
    
    return {
        // Public inputs
        merkleRoot,
        nullifierHash,
        recipient,
        withdrawalAmount,
        relayerFee,
        changeCommitment,
        
        // Private inputs - input note
        secret,
        nullifier,
        noteAmount,
        pathElements,
        pathIndices,
        
        // Private inputs - change note
        changeSecret,
        changeNullifier,
        changeAmount
    };
}

/**
 * Generate test input for private_transfer circuit
 */
function generatePrivateTransferInput(levels = 10) {
    // Input note 1
    const inSecret1 = randomFieldElement();
    const inNullifier1 = randomFieldElement();
    const inAmount1 = '3000000000'; // 3 SOL
    
    // Input note 2
    const inSecret2 = randomFieldElement();
    const inNullifier2 = randomFieldElement();
    const inAmount2 = '2000000000'; // 2 SOL
    
    // Output note 1
    const outSecret1 = randomFieldElement();
    const outNullifier1 = randomFieldElement();
    const outAmount1 = '4000000000'; // 4 SOL
    
    // Output note 2
    const outSecret2 = randomFieldElement();
    const outNullifier2 = randomFieldElement();
    const outAmount2 = '1000000000'; // 1 SOL (3+2 = 4+1 = 5 total)
    
    // Compute input commitments
    const inInner1 = poseidonHash([inNullifier1, inAmount1]);
    const inCommitment1 = poseidonHash([inSecret1, inInner1]);
    
    const inInner2 = poseidonHash([inNullifier2, inAmount2]);
    const inCommitment2 = poseidonHash([inSecret2, inInner2]);
    
    // Compute nullifier hashes
    const inputNullifierHash1 = poseidonHash([inNullifier1, '0']);
    const inputNullifierHash2 = poseidonHash([inNullifier2, '0']);
    
    // Compute output commitments
    const outInner1 = poseidonHash([outNullifier1, outAmount1]);
    const outCommitment1 = poseidonHash([outSecret1, outInner1]);
    
    const outInner2 = poseidonHash([outNullifier2, outAmount2]);
    const outCommitment2 = poseidonHash([outSecret2, outInner2]);
    
    // Merkle root placeholder
    const merkleRoot = inCommitment1;
    
    const path1 = generateMerklePath(levels);
    const path2 = generateMerklePath(levels);
    
    return {
        // Public inputs
        merkleRoot,
        inputNullifierHashes: [inputNullifierHash1, inputNullifierHash2],
        outputCommitments: [outCommitment1, outCommitment2],
        
        // Private inputs - Input 1
        inSecret1,
        inNullifier1,
        inAmount1,
        inPathElements1: path1.pathElements,
        inPathIndices1: path1.pathIndices,
        
        // Private inputs - Input 2
        inSecret2,
        inNullifier2,
        inAmount2,
        inPathElements2: path2.pathElements,
        inPathIndices2: path2.pathIndices,
        
        // Private inputs - Output 1
        outSecret1,
        outNullifier1,
        outAmount1,
        
        // Private inputs - Output 2
        outSecret2,
        outNullifier2,
        outAmount2
    };
}

function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     WHISTLE PROTOCOL - Test Input Generator                ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    const circuits = {
        'withdraw_merkle': generateWithdrawMerkleInput,
        'unshield_change': generateUnshieldChangeInput,
        'private_transfer': generatePrivateTransferInput
    };
    
    const specificCircuit = process.argv[2];
    
    let toGenerate = Object.keys(circuits);
    if (specificCircuit) {
        if (!circuits[specificCircuit]) {
            console.error(`❌ Unknown circuit: ${specificCircuit}`);
            console.log('Available:', Object.keys(circuits).join(', '));
            process.exit(1);
        }
        toGenerate = [specificCircuit];
    }
    
    for (const name of toGenerate) {
        console.log(`Generating test input for: ${name}`);
        
        const input = circuits[name]();
        const circuitDir = path.join(BUILD_DIR, name);
        
        if (!fs.existsSync(circuitDir)) {
            fs.mkdirSync(circuitDir, { recursive: true });
        }
        
        const outputPath = path.join(circuitDir, 'input_test.json');
        fs.writeFileSync(outputPath, JSON.stringify(input, null, 2));
        
        console.log(`  ✅ Saved to: ${outputPath}\n`);
    }
    
    console.log('⚠️  NOTE: These inputs use placeholder Poseidon hashes.');
    console.log('   For real proofs, use circomlibjs Poseidon implementation.');
}

main();
