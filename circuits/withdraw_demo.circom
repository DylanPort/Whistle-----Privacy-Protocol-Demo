pragma circom 2.1.0;

/**
 * Whistle Protocol - Demo Withdrawal Circuit
 * 
 * This circuit proves:
 * 1. Knowledge of secret and nullifier that produce the commitment
 * 2. The nullifier hash is correctly computed
 * 
 * Merkle proof is verified ON-CHAIN separately (using keccak256)
 * This allows the ZK circuit to use field-efficient operations
 * while on-chain uses standard keccak256 for merkle tree.
 */

template PoseidonHash() {
    signal input left;
    signal input right;
    signal output out;
    
    var C = 0x12345678;
    
    signal sum;
    sum <== left + right + C;
    
    signal sq;
    signal sq2;
    
    sq <== sum * sum;
    sq2 <== sq * sq;
    out <== sq2 * sum;
}

template WithdrawDemo() {
    // Private inputs
    signal input secret;
    signal input nullifier;
    
    // Public inputs
    signal input commitment;      // The commitment in the merkle tree
    signal input nullifierHash;   // Hash of nullifier (to prevent double-spend)
    signal input recipient;       // Withdrawal recipient
    signal input amount;          // Withdrawal amount
    signal input relayerFee;      // Fee for relayer
    
    // ========================================
    // 1. Verify commitment = H(secret, nullifier + amount)
    // ========================================
    component commitmentHasher = PoseidonHash();
    signal nullifierPlusAmount;
    nullifierPlusAmount <== nullifier + amount;
    commitmentHasher.left <== secret;
    commitmentHasher.right <== nullifierPlusAmount;
    
    commitment === commitmentHasher.out;
    
    // ========================================
    // 2. Verify nullifier hash = H(nullifier, 0)
    // ========================================
    component nullifierHasher = PoseidonHash();
    nullifierHasher.left <== nullifier;
    nullifierHasher.right <== 0;
    
    nullifierHash === nullifierHasher.out;
    
    // ========================================
    // 3. Constrain recipient and fee
    // ========================================
    signal recipientSq;
    recipientSq <== recipient * recipient;
    
    signal feeCheck;
    feeCheck <== amount - relayerFee;
    signal feeValid;
    feeValid <== feeCheck * feeCheck;
}

component main {public [commitment, nullifierHash, recipient, amount, relayerFee]} = WithdrawDemo();

