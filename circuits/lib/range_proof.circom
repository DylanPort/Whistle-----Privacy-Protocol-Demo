pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// ============================================================================
// WHISTLE PROTOCOL - RANGE PROOF COMPONENTS
// ============================================================================
// Security-critical: Prevents overflow attacks by ensuring amounts are in range
// ============================================================================

/**
 * Prove that a value fits in n bits (0 <= value < 2^n)
 * 
 * @param n - Number of bits (e.g., 64 for u64 amounts)
 * 
 * This is crucial for preventing overflow attacks where an attacker
 * might try to create notes with negative or very large amounts.
 */
template RangeProof(n) {
    signal input in;
    signal output out;
    
    component bits = Num2Bits(n);
    bits.in <== in;
    
    // If the conversion succeeds, the value is in range
    out <== 1;
}

/**
 * Assert that a >= b
 * Uses circomlib's GreaterEqThan
 */
template AssertGreaterEqThan(n) {
    signal input a;
    signal input b;
    
    component gte = GreaterEqThan(n);
    gte.in[0] <== a;
    gte.in[1] <== b;
    
    gte.out === 1;
}

/**
 * Prove value is non-negative and fits in n bits
 * For Solana, we use 64 bits (lamports are u64)
 */
template NonNegative64() {
    signal input in;
    
    component rangeCheck = RangeProof(64);
    rangeCheck.in <== in;
}

/**
 * Safe subtraction with range check
 * Ensures result >= 0 (prevents underflow)
 */
template SafeSub(n) {
    signal input a;
    signal input b;
    signal output out;
    
    // Compute the difference
    out <== a - b;
    
    // Ensure result is non-negative (fits in n bits as unsigned)
    component rangeCheck = RangeProof(n);
    rangeCheck.in <== out;
    
    // Also ensure a >= b
    component gte = AssertGreaterEqThan(n);
    gte.a <== a;
    gte.b <== b;
}

/**
 * Safe addition with overflow check
 * Ensures result fits in n bits
 */
template SafeAdd(n) {
    signal input a;
    signal input b;
    signal output out;
    
    out <== a + b;
    
    // Ensure result fits in n bits (no overflow)
    component rangeCheck = RangeProof(n);
    rangeCheck.in <== out;
}
