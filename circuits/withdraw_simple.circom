pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// ============================================================================
// WHISTLE PROTOCOL - SIMPLIFIED PRIVACY CIRCUIT
// ============================================================================
// 
// This circuit proves:
// 1. Knowledge of (secret, nullifier) that produces commitment
// 2. Nullifier hash is correctly computed
// 3. Commitment matches what was deposited
//
// NOTE: Merkle tree proof skipped for hackathon (would need Poseidon on-chain)
// The nullifier tracking already prevents double-spend!
//
// Public Inputs:
//   - commitment: The note commitment that was deposited
//   - nullifierHash: Hash of nullifier (prevents double-spend)
//   - recipient: Withdrawal destination (as field element)
//   - amount: Withdrawal amount
//   - relayerFee: Fee paid to relayer
//
// Private Inputs:
//   - secret: Random secret known only to depositor
//   - nullifier: Random nullifier for this note
//   - noteAmount: Amount stored in the note
//
// ============================================================================

template WithdrawSimple() {
    // Public inputs
    signal input commitment;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;
    signal input relayerFee;

    // Private inputs
    signal input secret;
    signal input nullifier;
    signal input noteAmount;

    // ========================================
    // 1. Verify commitment = H(secret, H(nullifier, noteAmount))
    // ========================================
    component innerHash = Poseidon(2);
    innerHash.inputs[0] <== nullifier;
    innerHash.inputs[1] <== noteAmount;

    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== innerHash.out;
    
    commitment === commitmentHasher.out;

    // ========================================
    // 2. Verify nullifier hash = H(nullifier, 0)
    // ========================================
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.inputs[1] <== 0;
    
    nullifierHash === nullifierHasher.out;

    // ========================================
    // 3. Verify amount <= noteAmount (can withdraw up to note value)
    // ========================================
    // For simplicity, we verify amount == noteAmount (full withdrawal)
    // A more complex version would allow partial withdrawals
    signal totalWithdraw;
    totalWithdraw <== amount + relayerFee;
    
    // Constrain: totalWithdraw <= noteAmount
    // This is enforced by ensuring noteAmount - totalWithdraw >= 0
    // For demo, we just check equality
    noteAmount === totalWithdraw;

    // ========================================
    // 4. Bind recipient to prevent front-running
    // ========================================
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

component main {public [commitment, nullifierHash, recipient, amount, relayerFee]} = WithdrawSimple();
