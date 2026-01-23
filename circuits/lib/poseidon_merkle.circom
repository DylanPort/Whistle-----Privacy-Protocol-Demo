pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// ============================================================================
// WHISTLE PROTOCOL - MERKLE TREE COMPONENTS
// ============================================================================
// Production-ready Merkle tree components using Poseidon hash
// ============================================================================

/**
 * Hash two nodes to get parent using Poseidon
 * Used for building Merkle tree proofs
 */
template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;
    
    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    hash <== hasher.out;
}

/**
 * Select left or right based on selector bit
 * s=0: out = [in[0], in[1]] (leaf is on the left)
 * s=1: out = [in[1], in[0]] (leaf is on the right)
 */
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];
    
    // Ensure s is binary (0 or 1)
    s * (1 - s) === 0;
    
    // Swap based on selector
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

/**
 * Verify a Merkle proof and compute the root
 * 
 * @param levels - Number of levels in the Merkle tree (depth)
 * 
 * Inputs:
 *   - leaf: The leaf commitment to prove membership for
 *   - pathElements[levels]: Sibling hashes along the path
 *   - pathIndices[levels]: Position indicators (0=left, 1=right)
 * 
 * Output:
 *   - root: The computed Merkle root
 */
template MerkleProofVerifier(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;
    
    component selectors[levels];
    component hashers[levels];
    
    // Start with the leaf
    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;
    
    // Walk up the tree, computing each level's hash
    for (var i = 0; i < levels; i++) {
        // Select the order based on path index
        selectors[i] = DualMux();
        selectors[i].in[0] <== levelHashes[i];
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];
        
        // Hash the two children to get parent
        hashers[i] = HashLeftRight();
        hashers[i].left <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];
        
        levelHashes[i + 1] <== hashers[i].hash;
    }
    
    // Output the computed root
    root <== levelHashes[levels];
}
