pragma circom 2.1.0;

/**
 * Whistle Protocol - Final Withdrawal Circuit
 * 
 * This circuit uses the SAME hash function as the on-chain contract:
 * H(l, r) = ((l + r + C)^5) mod p
 * 
 * where:
 * - p = BN254 scalar field modulus
 * - C = 0x12345678 (round constant)
 * - ^5 is the Poseidon S-box
 */

template PoseidonHash() {
    signal input left;
    signal input right;
    signal output out;
    
    // Round constant (same as on-chain)
    var C = 0x12345678;
    
    // sum = left + right + C
    signal sum;
    sum <== left + right + C;
    
    // Apply x^5 (S-box)
    signal sq;
    signal sq2;
    signal result;
    
    sq <== sum * sum;      // x^2
    sq2 <== sq * sq;       // x^4
    result <== sq2 * sum;  // x^5
    
    out <== result;
}

template Withdraw(levels) {
    // Private inputs
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    // Public inputs (order matters for verification)
    signal input merkleRoot;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;
    signal input relayerFee;
    
    // ========================================
    // 1. Compute commitment = H(secret, nullifier + amount)
    // ========================================
    component commitmentHasher = PoseidonHash();
    signal nullifierPlusAmount;
    nullifierPlusAmount <== nullifier + amount;
    commitmentHasher.left <== secret;
    commitmentHasher.right <== nullifierPlusAmount;
    signal commitment;
    commitment <== commitmentHasher.out;
    
    // ========================================
    // 2. Verify nullifier hash
    // ========================================
    component nullifierHasher = PoseidonHash();
    nullifierHasher.left <== nullifier;
    nullifierHasher.right <== 0;
    nullifierHash === nullifierHasher.out;
    
    // ========================================
    // 3. Verify Merkle proof
    // ========================================
    component hashers[levels];
    signal computedPath[levels + 1];
    signal leftInputs[levels];
    signal rightInputs[levels];
    signal isRight[levels];
    signal diff[levels];
    
    computedPath[0] <== commitment;
    
    for (var i = 0; i < levels; i++) {
        hashers[i] = PoseidonHash();
        
        // Select left/right based on path index
        // If pathIndices[i] == 0: current is left, sibling is right
        // If pathIndices[i] == 1: sibling is left, current is right
        
        isRight[i] <== pathIndices[i];
        isRight[i] * (1 - isRight[i]) === 0; // Must be 0 or 1
        
        diff[i] <== pathElements[i] - computedPath[i];
        
        leftInputs[i] <== computedPath[i] + isRight[i] * diff[i];
        rightInputs[i] <== pathElements[i] - isRight[i] * diff[i];
        
        hashers[i].left <== leftInputs[i];
        hashers[i].right <== rightInputs[i];
        
        computedPath[i + 1] <== hashers[i].out;
    }
    
    // Final computed root must match the public input
    merkleRoot === computedPath[levels];
    
    // ========================================
    // 4. Constrain recipient and fee (prevent tampering)
    // ========================================
    signal recipientSq;
    recipientSq <== recipient * recipient;
    
    signal feeCheck;
    feeCheck <== amount - relayerFee;
    signal feeValid;
    feeValid <== feeCheck * feeCheck;
}

// Main component with 16 levels (~65k deposits)
component main {public [merkleRoot, nullifierHash, recipient, amount, relayerFee]} = Withdraw(16);

