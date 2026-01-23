pragma circom 2.1.0;

include "./node_modules/circomlib/circuits/poseidon.circom";
include "./node_modules/circomlib/circuits/bitify.circom";
include "./node_modules/circomlib/circuits/comparators.circom";
include "./lib/poseidon_merkle.circom";
include "./lib/range_proof.circom";

// ============================================================================
// WHISTLE PROTOCOL - UNSHIELD WITH CHANGE CIRCUIT
// ============================================================================
//
// Withdraw a FIXED denomination and automatically re-shield the change.
// This is the core of Tornado Cash-style privacy with flexible deposits.
//
// Example flow:
// 1. User deposits 5.7 SOL → creates note with 5.7 SOL
// 2. User wants to withdraw 1 SOL (fixed denomination)
// 3. This circuit:
//    - Proves knowledge of the 5.7 SOL note
//    - Verifies withdrawal = 1 SOL
//    - Creates change note commitment for 4.7 SOL
//    - Outputs change commitment to be added to tree
//
// Security properties:
// - Input note membership proven in ZK
// - Change commitment is correctly computed
// - Value conservation: inputAmount = withdrawAmount + fee + changeAmount
// - All amounts are range-checked to prevent overflow
//
// ============================================================================

template UnshieldChange(levels) {
    // ========================================
    // PUBLIC INPUTS
    // ========================================
    signal input merkleRoot;           // Current Merkle tree root
    signal input nullifierHash;        // H(nullifier, 0) for input note
    signal input recipient;            // Withdrawal destination
    signal input withdrawalAmount;     // Fixed denomination being withdrawn
    signal input relayerFee;           // Fee for relayer
    signal input changeCommitment;     // New note commitment for change (0 if no change)

    // ========================================
    // PRIVATE INPUTS - Input Note
    // ========================================
    signal input secret;               // Input note secret
    signal input nullifier;            // Input note nullifier
    signal input noteAmount;           // Input note amount (hidden)
    signal input pathElements[levels]; // Merkle proof path
    signal input pathIndices[levels];  // Merkle proof indices

    // ========================================
    // PRIVATE INPUTS - Change Note
    // ========================================
    signal input changeSecret;         // New secret for change note
    signal input changeNullifier;      // New nullifier for change note
    signal input changeAmount;         // Amount in change note (hidden)

    // ========================================
    // CONSTRAINT 1: Compute input commitment
    // ========================================
    component innerHash = Poseidon(2);
    innerHash.inputs[0] <== nullifier;
    innerHash.inputs[1] <== noteAmount;

    component inputCommitment = Poseidon(2);
    inputCommitment.inputs[0] <== secret;
    inputCommitment.inputs[1] <== innerHash.out;

    // ========================================
    // CONSTRAINT 2: Verify Merkle membership
    // ========================================
    component merkleVerifier = MerkleProofVerifier(levels);
    merkleVerifier.leaf <== inputCommitment.out;
    
    for (var i = 0; i < levels; i++) {
        merkleVerifier.pathElements[i] <== pathElements[i];
        merkleVerifier.pathIndices[i] <== pathIndices[i];
    }
    
    merkleRoot === merkleVerifier.root;

    // ========================================
    // CONSTRAINT 3: Verify nullifier hash
    // ========================================
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.inputs[1] <== 0;
    
    nullifierHash === nullifierHasher.out;

    // ========================================
    // CONSTRAINT 4: Range checks
    // ========================================
    component noteAmountRange = RangeProof(64);
    noteAmountRange.in <== noteAmount;
    
    component withdrawRange = RangeProof(64);
    withdrawRange.in <== withdrawalAmount;
    
    component feeRange = RangeProof(64);
    feeRange.in <== relayerFee;
    
    component changeAmountRange = RangeProof(64);
    changeAmountRange.in <== changeAmount;

    // ========================================
    // CONSTRAINT 5: Value conservation
    // noteAmount = withdrawalAmount + relayerFee + changeAmount
    // ========================================
    signal totalOut;
    totalOut <== withdrawalAmount + relayerFee + changeAmount;
    
    // Range check total to prevent overflow
    component totalRange = RangeProof(64);
    totalRange.in <== totalOut;
    
    // Exact balance: input = output
    noteAmount === totalOut;

    // ========================================
    // CONSTRAINT 6: Compute change commitment
    // If changeAmount > 0: changeCommitment = H(changeSecret, H(changeNullifier, changeAmount))
    // If changeAmount = 0: changeCommitment = 0
    // ========================================
    
    // Compute what the change commitment should be
    component changeInner = Poseidon(2);
    changeInner.inputs[0] <== changeNullifier;
    changeInner.inputs[1] <== changeAmount;

    component changeOuter = Poseidon(2);
    changeOuter.inputs[0] <== changeSecret;
    changeOuter.inputs[1] <== changeInner.out;

    // Check if changeAmount is zero
    component isChangeZero = IsZero();
    isChangeZero.in <== changeAmount;

    // Expected change commitment:
    // If changeAmount == 0: expectedChange = 0
    // If changeAmount != 0: expectedChange = changeOuter.out
    signal expectedChangeCommitment;
    expectedChangeCommitment <== changeOuter.out * (1 - isChangeZero.out);

    // Verify change commitment matches
    changeCommitment === expectedChangeCommitment;

    // ========================================
    // CONSTRAINT 7: Bind recipient
    // ========================================
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
    
    component recipientBind = Poseidon(2);
    recipientBind.inputs[0] <== recipient;
    recipientBind.inputs[1] <== inputCommitment.out;
    
    signal _binding;
    _binding <== recipientBind.out;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
// 10 levels for devnet testing (1,024 deposits)
// Use 20 levels for mainnet (1M deposits)
// ============================================================================

component main {public [merkleRoot, nullifierHash, recipient, withdrawalAmount, relayerFee, changeCommitment]} = UnshieldChange(7);
