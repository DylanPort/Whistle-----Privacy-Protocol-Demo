pragma circom 2.1.0;

/**
 * Merkle Tree Library for Whistle Protocol
 * 
 * Provides components for Merkle tree membership proofs
 */

/**
 * Hash two nodes to get parent
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
 * Select left or right based on selector
 */
template Selector() {
    signal input in[2];
    signal input s;
    signal output out[2];
    
    // Ensure s is binary
    s * (1 - s) === 0;
    
    // If s=0: out = [in[0], in[1]]
    // If s=1: out = [in[1], in[0]]
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

/**
 * Verify a Merkle proof
 */
template MerkleProofVerifier(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;
    
    component selectors[levels];
    component hashers[levels];
    
    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;
    
    for (var i = 0; i < levels; i++) {
        selectors[i] = Selector();
        selectors[i].in[0] <== levelHashes[i];
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];
        
        hashers[i] = HashLeftRight();
        hashers[i].left <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];
        
        levelHashes[i + 1] <== hashers[i].hash;
    }
    
    root <== levelHashes[levels];
}

/**
 * Poseidon hash (simplified)
 */
template Poseidon(nInputs) {
    signal input inputs[nInputs];
    signal output out;
    
    // Simplified for demonstration
    // Production: use circomlib Poseidon
    var acc = 0;
    for (var i = 0; i < nInputs; i++) {
        acc += inputs[i];
    }
    
    signal squared;
    squared <== acc * acc;
    out <== squared + acc;
}

