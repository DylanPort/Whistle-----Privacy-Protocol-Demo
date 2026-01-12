pragma circom 2.0.0;

/*
 * WHISTLE PROTOCOL - UNSHIELD CIRCUIT (Simplified)
 * 
 * Proves knowledge of a shielded note for withdrawal.
 * 
 * Public inputs:
 *   - commitment: the note commitment
 *   - nullifierHash: for double-spend prevention
 *   - withdrawAmount: amount to withdraw
 *   - changeCommitment: new note for change (0 if none)
 *   - recipient: destination pubkey
 *   - relayerFee: fee for relayer
 * 
 * Private inputs:
 *   - secret, nullifier, noteAmount for original note
 *   - changeSecret, changeNullifier for change note
 */

// Simple hash: H(a, b) = ((a + b + c)^5) where c is a constant
// This is a simplified Poseidon-like construction
template SimpleHash() {
    signal input left;
    signal input right;
    signal output out;
    
    var ROUND_CONSTANT = 305419896; // 0x12345678
    
    signal t1;
    signal t2;
    signal t3;
    signal t4;
    
    t1 <== left + right + ROUND_CONSTANT;
    t2 <== t1 * t1;       // x^2
    t3 <== t2 * t2;       // x^4
    t4 <== t3 * t1;       // x^5
    
    out <== t4;
}

// Compute note commitment: hash(secret, nullifier + amount)
template NoteCommitment() {
    signal input secret;
    signal input nullifier;
    signal input amount;
    signal output commitment;
    
    signal intermediate;
    intermediate <== nullifier + amount;
    
    component hasher = SimpleHash();
    hasher.left <== secret;
    hasher.right <== intermediate;
    
    commitment <== hasher.out;
}

// Compute nullifier hash
template NullifierHash() {
    signal input nullifier;
    signal output hash;
    
    component hasher = SimpleHash();
    hasher.left <== nullifier;
    hasher.right <== 0;
    
    hash <== hasher.out;
}

// Main unshield circuit
template Unshield() {
    // Public inputs
    signal input commitment;
    signal input nullifierHash;
    signal input withdrawAmount;
    signal input changeCommitment;
    signal input recipient;
    signal input relayerFee;
    
    // Private inputs
    signal input secret;
    signal input nullifier;
    signal input noteAmount;
    signal input changeSecret;
    signal input changeNullifier;
    
    // ===== VERIFY ORIGINAL NOTE =====
    component noteCommit = NoteCommitment();
    noteCommit.secret <== secret;
    noteCommit.nullifier <== nullifier;
    noteCommit.amount <== noteAmount;
    
    commitment === noteCommit.commitment;
    
    // ===== VERIFY NULLIFIER HASH =====
    component nullHash = NullifierHash();
    nullHash.nullifier <== nullifier;
    
    nullifierHash === nullHash.hash;
    
    // ===== VERIFY CHANGE NOTE =====
    signal changeAmount;
    changeAmount <== noteAmount - withdrawAmount - relayerFee;
    
    component changeCommit = NoteCommitment();
    changeCommit.secret <== changeSecret;
    changeCommit.nullifier <== changeNullifier;
    changeCommit.amount <== changeAmount;
    
    changeCommitment === changeCommit.commitment;
    
    // Bind recipient and relayerFee to prevent malleability
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

component main {public [commitment, nullifierHash, withdrawAmount, changeCommitment, recipient, relayerFee]} = Unshield();
