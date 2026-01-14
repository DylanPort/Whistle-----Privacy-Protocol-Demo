pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// ============================================================================
// WHISTLE PROTOCOL - FULL PRIVACY CIRCUIT
// ============================================================================
// 
// This circuit proves:
// 1. Knowledge of (secret, nullifier) that produces commitment
// 2. Commitment exists in the Merkle tree (membership proof)
// 3. Nullifier hash is correctly computed
// 4. Withdrawal amount matches the note
//
// Public Inputs:
//   - merkleRoot: Current root of the commitment tree
//   - nullifierHash: Hash of nullifier (prevents double-spend)
//   - recipient: Withdrawal destination (as field element)
//   - amount: Withdrawal amount
//   - relayerFee: Fee paid to relayer
//
// Private Inputs:
//   - secret: Random secret known only to depositor
//   - nullifier: Random nullifier for this note
//   - pathElements[LEVELS]: Sibling hashes in merkle path
//   - pathIndices[LEVELS]: Left(0) or Right(1) at each level
//
// ============================================================================
// MERKLE TREE CHECKER
// ============================================================================
// Verifies that a leaf is part of a merkle tree with given root

template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component hashers[levels];
    component mux[levels];

    signal hashes[levels + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // Verify pathIndices are binary (0 or 1)
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        hashers[i] = Poseidon(2);
        
        // If pathIndices[i] == 0: hash(current, sibling)
        // If pathIndices[i] == 1: hash(sibling, current)
        
        // Left input: current if index=0, sibling if index=1
        hashers[i].inputs[0] <== hashes[i] + (pathElements[i] - hashes[i]) * pathIndices[i];
        // Right input: sibling if index=0, current if index=1
        hashers[i].inputs[1] <== pathElements[i] + (hashes[i] - pathElements[i]) * pathIndices[i];

        hashes[i + 1] <== hashers[i].out;
    }

    // Final hash must equal root
    root === hashes[levels];
}

// ============================================================================
// COMMITMENT HASHER
// ============================================================================
// Computes commitment = Poseidon(secret, nullifier, amount)

template CommitmentHasher() {
    signal input secret;
    signal input nullifier;
    signal input amount;
    signal output commitment;
    signal output nullifierHash;

    // Commitment = H(secret, H(nullifier, amount))
    component innerHash = Poseidon(2);
    innerHash.inputs[0] <== nullifier;
    innerHash.inputs[1] <== amount;

    component commitHasher = Poseidon(2);
    commitHasher.inputs[0] <== secret;
    commitHasher.inputs[1] <== innerHash.out;
    
    commitment <== commitHasher.out;

    // Nullifier hash = H(nullifier, 0)
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.inputs[1] <== 0;
    
    nullifierHash <== nullifierHasher.out;
}

// ============================================================================
// MAIN WITHDRAWAL CIRCUIT
// ============================================================================

template Withdraw(levels) {
    // Public inputs
    signal input merkleRoot;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;
    signal input relayerFee;

    // Private inputs
    signal input secret;
    signal input nullifier;
    signal input noteAmount;  // Amount stored in the note
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // ========================================
    // 1. Compute and verify commitment
    // ========================================
    component hasher = CommitmentHasher();
    hasher.secret <== secret;
    hasher.nullifier <== nullifier;
    hasher.amount <== noteAmount;

    // ========================================
    // 2. Verify nullifier hash matches
    // ========================================
    nullifierHash === hasher.nullifierHash;

    // ========================================
    // 3. Verify merkle tree membership
    // ========================================
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== hasher.commitment;
    tree.root <== merkleRoot;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // ========================================
    // 4. Verify withdrawal amount <= note amount
    // ========================================
    // For fixed denominations, amount should exactly match
    // Here we just check amount + fee <= noteAmount
    signal totalWithdraw;
    totalWithdraw <== amount + relayerFee;
    
    component leq = LessEqThan(64);
    leq.in[0] <== totalWithdraw;
    leq.in[1] <== noteAmount;
    leq.out === 1;

    // ========================================
    // 5. Bind recipient to prevent front-running
    // ========================================
    // Square recipient to create a constraint (prevents malleability)
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

// Instantiate with 20 levels (supports ~1M deposits)
component main {public [merkleRoot, nullifierHash, recipient, amount, relayerFee]} = Withdraw(20);

