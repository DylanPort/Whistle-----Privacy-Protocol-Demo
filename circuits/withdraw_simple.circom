pragma circom 2.1.0;

/**
 * Simplified Withdrawal Circuit for Whistle Protocol Demo
 * 
 * Proves knowledge of secret and nullifier that hash to commitment
 * Public inputs: merkleRoot, nullifierHash, recipient, amount, relayerFee
 */

template SimpleWithdraw(levels) {
    // Private inputs  
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    // Public inputs (must match on-chain verification)
    signal input merkleRoot;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;
    signal input relayerFee;
    
    // Intermediate signals - declared at top level
    signal commitment;
    signal temp1;
    signal computedNullifierHash;
    signal computedPath[levels + 1];
    signal diff[levels];
    signal selected[levels];
    signal leftValue[levels];
    signal rightValue[levels];
    signal prod[levels];
    signal recipientCheck;
    signal feeCheck;
    signal feeValid;
    
    // Compute commitment = secret * nullifier + amount (simplified hash)
    temp1 <== secret * nullifier;
    commitment <== temp1 + amount;
    
    // Verify nullifier hash = nullifier^2 (simplified)
    computedNullifierHash <== nullifier * nullifier;
    nullifierHash === computedNullifierHash;
    
    // Compute merkle root from leaf
    computedPath[0] <== commitment;
    
    for (var i = 0; i < levels; i++) {
        // If pathIndices[i] == 0: left = computedPath[i], right = pathElements[i]
        // If pathIndices[i] == 1: left = pathElements[i], right = computedPath[i]
        diff[i] <== pathElements[i] - computedPath[i];
        selected[i] <== diff[i] * pathIndices[i];
        
        leftValue[i] <== computedPath[i] + selected[i];
        rightValue[i] <== pathElements[i] - selected[i];
        
        // Hash: simplified as left * right + i
        prod[i] <== leftValue[i] * rightValue[i];
        computedPath[i + 1] <== prod[i] + i;
    }
    
    // Final root check
    merkleRoot === computedPath[levels];
    
    // Constrain recipient and fees (prevent tampering)
    recipientCheck <== recipient * recipient;
    feeCheck <== amount - relayerFee;
    feeValid <== feeCheck * feeCheck;
}

// 16 levels = 65,536 possible deposits
component main {public [merkleRoot, nullifierHash, recipient, amount, relayerFee]} = SimpleWithdraw(16);
