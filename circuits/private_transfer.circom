pragma circom 2.1.0;

include "./node_modules/circomlib/circuits/poseidon.circom";
include "./node_modules/circomlib/circuits/bitify.circom";
include "./node_modules/circomlib/circuits/comparators.circom";
include "./lib/poseidon_merkle.circom";
include "./lib/range_proof.circom";

// ============================================================================
// WHISTLE PROTOCOL - PRIVATE TRANSFER CIRCUIT (2-in-2-out)
// ============================================================================
//
// Transfer shielded balance without revealing amounts.
// Supports splitting and merging notes privately.
//
// This circuit enables:
// - Split: 1 note → 2 notes (e.g., 10 SOL → 7 SOL + 3 SOL)
// - Merge: 2 notes → 1 note (e.g., 5 SOL + 5 SOL → 10 SOL)
// - Transfer: Send value to another commitment (recipient generates secrets)
//
// For unused inputs/outputs, set amount to 0 and use zero commitment.
//
// Security properties:
// - Both input notes proven to exist in Merkle tree
// - Both output commitments correctly computed
// - Value conservation: sum(inputs) == sum(outputs)
// - No SOL enters or leaves the pool
// - All amounts are range-checked
//
// ============================================================================

template PrivateTransfer(levels) {
    // ========================================
    // PUBLIC INPUTS
    // ========================================
    signal input merkleRoot;                    // Current Merkle tree root
    signal input inputNullifierHashes[2];       // Nullifier hashes for input notes
    signal input outputCommitments[2];          // Commitments for output notes

    // ========================================
    // PRIVATE INPUTS - Input Note 1
    // ========================================
    signal input inSecret1;
    signal input inNullifier1;
    signal input inAmount1;
    signal input inPathElements1[levels];
    signal input inPathIndices1[levels];

    // ========================================
    // PRIVATE INPUTS - Input Note 2 (can be zero)
    // ========================================
    signal input inSecret2;
    signal input inNullifier2;
    signal input inAmount2;
    signal input inPathElements2[levels];
    signal input inPathIndices2[levels];

    // ========================================
    // PRIVATE INPUTS - Output Note 1
    // ========================================
    signal input outSecret1;
    signal input outNullifier1;
    signal input outAmount1;

    // ========================================
    // PRIVATE INPUTS - Output Note 2 (can be zero)
    // ========================================
    signal input outSecret2;
    signal input outNullifier2;
    signal input outAmount2;

    // ========================================
    // HELPER: Compute commitment from (secret, nullifier, amount)
    // commitment = Poseidon(secret, Poseidon(nullifier, amount))
    // ========================================
    
    // Input commitment 1
    component inInner1 = Poseidon(2);
    inInner1.inputs[0] <== inNullifier1;
    inInner1.inputs[1] <== inAmount1;
    
    component inOuter1 = Poseidon(2);
    inOuter1.inputs[0] <== inSecret1;
    inOuter1.inputs[1] <== inInner1.out;

    // Input commitment 2
    component inInner2 = Poseidon(2);
    inInner2.inputs[0] <== inNullifier2;
    inInner2.inputs[1] <== inAmount2;
    
    component inOuter2 = Poseidon(2);
    inOuter2.inputs[0] <== inSecret2;
    inOuter2.inputs[1] <== inInner2.out;

    // Output commitment 1
    component outInner1 = Poseidon(2);
    outInner1.inputs[0] <== outNullifier1;
    outInner1.inputs[1] <== outAmount1;
    
    component outOuter1 = Poseidon(2);
    outOuter1.inputs[0] <== outSecret1;
    outOuter1.inputs[1] <== outInner1.out;

    // Output commitment 2
    component outInner2 = Poseidon(2);
    outInner2.inputs[0] <== outNullifier2;
    outInner2.inputs[1] <== outAmount2;
    
    component outOuter2 = Poseidon(2);
    outOuter2.inputs[0] <== outSecret2;
    outOuter2.inputs[1] <== outInner2.out;

    // ========================================
    // CONSTRAINT 1: Check if inputs are non-zero
    // ========================================
    component isInput1Zero = IsZero();
    isInput1Zero.in <== inAmount1;
    signal input1Active;
    input1Active <== 1 - isInput1Zero.out;

    component isInput2Zero = IsZero();
    isInput2Zero.in <== inAmount2;
    signal input2Active;
    input2Active <== 1 - isInput2Zero.out;

    // ========================================
    // CONSTRAINT 2: Verify Merkle membership for input 1
    // Only if input1 is active (amount > 0)
    // ========================================
    component merkle1 = MerkleProofVerifier(levels);
    merkle1.leaf <== inOuter1.out;
    
    for (var i = 0; i < levels; i++) {
        merkle1.pathElements[i] <== inPathElements1[i];
        merkle1.pathIndices[i] <== inPathIndices1[i];
    }
    
    // If input1 is active, root must match
    // If input1 is zero, we don't care about the root (but constraint still runs)
    signal rootCheck1;
    rootCheck1 <== (merkle1.root - merkleRoot) * input1Active;
    rootCheck1 === 0;

    // ========================================
    // CONSTRAINT 3: Verify Merkle membership for input 2
    // Only if input2 is active (amount > 0)
    // ========================================
    component merkle2 = MerkleProofVerifier(levels);
    merkle2.leaf <== inOuter2.out;
    
    for (var i = 0; i < levels; i++) {
        merkle2.pathElements[i] <== inPathElements2[i];
        merkle2.pathIndices[i] <== inPathIndices2[i];
    }
    
    signal rootCheck2;
    rootCheck2 <== (merkle2.root - merkleRoot) * input2Active;
    rootCheck2 === 0;

    // ========================================
    // CONSTRAINT 4: Verify nullifier hashes
    // ========================================
    component nullHash1 = Poseidon(2);
    nullHash1.inputs[0] <== inNullifier1;
    nullHash1.inputs[1] <== 0;

    component nullHash2 = Poseidon(2);
    nullHash2.inputs[0] <== inNullifier2;
    nullHash2.inputs[1] <== 0;

    // For active inputs, nullifier hash must match
    // For zero inputs, the nullifier hash should also be zero
    signal expectedNull1;
    expectedNull1 <== nullHash1.out * input1Active;
    inputNullifierHashes[0] === expectedNull1;

    signal expectedNull2;
    expectedNull2 <== nullHash2.out * input2Active;
    inputNullifierHashes[1] === expectedNull2;

    // ========================================
    // CONSTRAINT 5: Verify output commitments
    // ========================================
    component isOutput1Zero = IsZero();
    isOutput1Zero.in <== outAmount1;
    signal output1Active;
    output1Active <== 1 - isOutput1Zero.out;

    component isOutput2Zero = IsZero();
    isOutput2Zero.in <== outAmount2;
    signal output2Active;
    output2Active <== 1 - isOutput2Zero.out;

    // Expected output commitment: commitment if active, 0 if zero amount
    signal expectedOut1;
    expectedOut1 <== outOuter1.out * output1Active;
    outputCommitments[0] === expectedOut1;

    signal expectedOut2;
    expectedOut2 <== outOuter2.out * output2Active;
    outputCommitments[1] === expectedOut2;

    // ========================================
    // CONSTRAINT 6: Range checks on all amounts
    // ========================================
    component range1 = RangeProof(64);
    range1.in <== inAmount1;

    component range2 = RangeProof(64);
    range2.in <== inAmount2;

    component range3 = RangeProof(64);
    range3.in <== outAmount1;

    component range4 = RangeProof(64);
    range4.in <== outAmount2;

    // ========================================
    // CONSTRAINT 7: Value conservation
    // sum(inputs) == sum(outputs)
    // NO SOL ENTERS OR LEAVES THE POOL
    // ========================================
    signal totalInput;
    totalInput <== inAmount1 + inAmount2;

    signal totalOutput;
    totalOutput <== outAmount1 + outAmount2;

    // Range check totals to prevent overflow
    component totalInRange = RangeProof(64);
    totalInRange.in <== totalInput;

    component totalOutRange = RangeProof(64);
    totalOutRange.in <== totalOutput;

    // CRITICAL: Exact balance
    totalInput === totalOutput;

    // ========================================
    // CONSTRAINT 8: At least one input must be active
    // ========================================
    signal atLeastOneInput;
    atLeastOneInput <== input1Active + input2Active;
    
    component hasInput = GreaterEqThan(2);
    hasInput.in[0] <== atLeastOneInput;
    hasInput.in[1] <== 1;
    hasInput.out === 1;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
// 10 levels for devnet testing
// Use 20 levels for mainnet
// ============================================================================

component main {public [merkleRoot, inputNullifierHashes, outputCommitments]} = PrivateTransfer(7);
