pragma circom 2.1.0;

include "./node_modules/circomlib/circuits/poseidon.circom";
include "./node_modules/circomlib/circuits/bitify.circom";
include "./node_modules/circomlib/circuits/comparators.circom";
include "./lib/poseidon_merkle.circom";
include "./lib/range_proof.circom";

// ============================================================================
// WHISTLE PROTOCOL - PRODUCTION WITHDRAWAL CIRCUIT
// ============================================================================
//
// Full privacy-preserving withdrawal with Merkle membership proof.
// 
// This circuit proves:
// 1. Knowledge of (secret, nullifier, amount) for a valid note
// 2. The note commitment exists in the Merkle tree
// 3. The nullifier hash is correctly computed (prevents double-spend)
// 4. The withdrawal amount is valid (amount + fee <= noteAmount)
// 5. Recipient is bound to prevent front-running
//
// Security properties:
// - Zero-knowledge: No information leaked about secret, nullifier, or position
// - Soundness: Cannot create valid proof without knowing preimage
// - Double-spend prevention: Nullifier uniquely identifies the note
// - Amount hiding: Note amount is never revealed
//
// ============================================================================

template WithdrawMerkle(levels) {
    // ========================================
    // PUBLIC INPUTS
    // ========================================
    signal input merkleRoot;      // Root of the commitment Merkle tree
    signal input nullifierHash;   // H(nullifier, 0) for double-spend prevention
    signal input recipient;       // Withdrawal destination (truncated to 31 bytes)
    signal input amount;          // Withdrawal amount in lamports
    signal input relayerFee;      // Fee for relayer (can be 0)

    // ========================================
    // PRIVATE INPUTS
    // ========================================
    signal input secret;          // Random 256-bit secret known only to depositor
    signal input nullifier;       // Random 256-bit nullifier for this note
    signal input noteAmount;      // Amount stored in the note (hidden)
    
    // Merkle proof path
    signal input pathElements[levels];  // Sibling hashes
    signal input pathIndices[levels];   // Position bits (0=left, 1=right)

    // ========================================
    // CONSTRAINT 1: Compute note commitment
    // commitment = Poseidon(secret, Poseidon(nullifier, noteAmount))
    // ========================================
    
    // Inner hash: H(nullifier, noteAmount)
    component innerHash = Poseidon(2);
    innerHash.inputs[0] <== nullifier;
    innerHash.inputs[1] <== noteAmount;

    // Outer hash: commitment = H(secret, innerHash)
    component commitmentHash = Poseidon(2);
    commitmentHash.inputs[0] <== secret;
    commitmentHash.inputs[1] <== innerHash.out;
    
    signal commitment;
    commitment <== commitmentHash.out;

    // ========================================
    // CONSTRAINT 2: Verify Merkle membership
    // Prove commitment exists in the tree at merkleRoot
    // ========================================
    component merkleVerifier = MerkleProofVerifier(levels);
    merkleVerifier.leaf <== commitment;
    
    for (var i = 0; i < levels; i++) {
        merkleVerifier.pathElements[i] <== pathElements[i];
        merkleVerifier.pathIndices[i] <== pathIndices[i];
    }
    
    // The computed root must match the public merkleRoot
    merkleRoot === merkleVerifier.root;

    // ========================================
    // CONSTRAINT 3: Verify nullifier hash
    // nullifierHash = Poseidon(nullifier, 0)
    // This is the value stored on-chain to prevent double-spend
    // ========================================
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.inputs[1] <== 0;
    
    nullifierHash === nullifierHasher.out;

    // ========================================
    // CONSTRAINT 4: Range checks for amounts
    // Prevents overflow/underflow attacks
    // ========================================
    
    // Ensure noteAmount is in valid u64 range
    component noteAmountRange = RangeProof(64);
    noteAmountRange.in <== noteAmount;
    
    // Ensure amount is in valid u64 range
    component amountRange = RangeProof(64);
    amountRange.in <== amount;
    
    // Ensure relayerFee is in valid u64 range
    component feeRange = RangeProof(64);
    feeRange.in <== relayerFee;

    // ========================================
    // CONSTRAINT 5: Value conservation
    // noteAmount >= amount + relayerFee
    // ========================================
    signal totalWithdraw;
    totalWithdraw <== amount + relayerFee;
    
    // Ensure totalWithdraw doesn't overflow
    component totalRange = RangeProof(64);
    totalRange.in <== totalWithdraw;
    
    // Ensure noteAmount >= totalWithdraw
    component valueCheck = GreaterEqThan(64);
    valueCheck.in[0] <== noteAmount;
    valueCheck.in[1] <== totalWithdraw;
    valueCheck.out === 1;

    // ========================================
    // CONSTRAINT 6: Bind recipient to proof
    // Prevents front-running attacks
    // ========================================
    // Simply constrain recipient to be non-trivially used
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
    
    // Additional binding: include recipient in a hash
    // This makes the proof invalid if recipient changes
    component recipientBind = Poseidon(2);
    recipientBind.inputs[0] <== recipient;
    recipientBind.inputs[1] <== commitment;
    
    // Force constraint to be non-trivially computed
    signal _binding;
    _binding <== recipientBind.out;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
// 
// Tree depth: 20 levels supports 2^20 = 1,048,576 deposits
// For testnet/devnet: 10 levels = 1,024 deposits
// 
// Adjust levels based on expected protocol usage
// ============================================================================

// Production: 20 levels for mainnet
// component main {public [merkleRoot, nullifierHash, recipient, amount, relayerFee]} = WithdrawMerkle(20);

// Devnet: 7 levels for testing (matches on-chain config)
component main {public [merkleRoot, nullifierHash, recipient, amount, relayerFee]} = WithdrawMerkle(7);
