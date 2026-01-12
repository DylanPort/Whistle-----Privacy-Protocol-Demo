pragma circom 2.1.0;

/**
 * Withdrawal Circuit matching on-chain keccak256 hashing
 * For Whistle Protocol hackathon demo
 * 
 * The on-chain contract uses: keccak256(left || right)
 * We simulate this with field arithmetic (for demo purposes)
 * 
 * In production: use circomlib Poseidon with matching on-chain Poseidon
 */

template WithdrawOnchain(levels) {
    // Private inputs
    signal input secret;
    signal input nullifier;
    signal input leafIndex;
    signal input pathElements[levels];
    
    // Public inputs
    signal input merkleRoot;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;
    signal input relayerFee;
    
    // Compute commitment = hash(secret, nullifier, amount)
    // Simulated as: (secret * 31337 + nullifier * 7919 + amount) mod p
    signal commitment;
    signal t1;
    signal t2;
    t1 <== secret * 31337;
    t2 <== nullifier * 7919;
    commitment <== t1 + t2 + amount;
    
    // Compute nullifier hash = hash(nullifier)
    signal computedNullifierHash;
    computedNullifierHash <== nullifier * 12289;
    nullifierHash === computedNullifierHash;
    
    // Merkle path verification
    signal computedPath[levels + 1];
    signal leftRight[levels][2];
    signal hashes[levels];
    
    computedPath[0] <== commitment;
    
    // Extract path indices from leafIndex
    signal pathBits[levels];
    signal remaining[levels + 1];
    remaining[0] <== leafIndex;
    
    for (var i = 0; i < levels; i++) {
        pathBits[i] <-- remaining[i] % 2;
        pathBits[i] * (1 - pathBits[i]) === 0;
        remaining[i + 1] <-- remaining[i] \ 2;
        remaining[i] === 2 * remaining[i + 1] + pathBits[i];
        
        // Select left/right based on path bit
        signal diff;
        signal sel;
        diff <== pathElements[i] - computedPath[i];
        sel <== diff * pathBits[i];
        
        leftRight[i][0] <== computedPath[i] + sel;
        leftRight[i][1] <== pathElements[i] - sel;
        
        // Hash: simulated keccak as (left * 65537 + right * 257 + i) 
        signal prod;
        prod <== leftRight[i][0] * 65537;
        hashes[i] <== prod + leftRight[i][1] * 257 + i;
        computedPath[i + 1] <== hashes[i];
    }
    
    merkleRoot === computedPath[levels];
    
    // Constraint to prevent tampering
    signal recipientSq;
    recipientSq <== recipient * recipient;
    signal feeSq;
    feeSq <== (amount - relayerFee) * (amount - relayerFee);
}

component main {public [merkleRoot, nullifierHash, recipient, amount, relayerFee]} = WithdrawOnchain(16);

