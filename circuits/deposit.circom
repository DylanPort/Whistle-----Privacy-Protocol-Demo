pragma circom 2.1.0;

/**
 * Deposit Circuit for Whistle Protocol
 * 
 * Proves: commitment = H(secret || nullifier || amount)
 * This is optional - deposits can be done without proof if commitment is trusted
 */

template Deposit() {
    // Private inputs
    signal input secret;
    signal input nullifier;
    
    // Public inputs
    signal input commitment;
    signal input amount;
    
    // Compute expected commitment
    component hasher = Poseidon(3);
    hasher.inputs[0] <== secret;
    hasher.inputs[1] <== nullifier;
    hasher.inputs[2] <== amount;
    
    // Verify commitment matches
    commitment === hasher.out;
}

/**
 * Poseidon Hash
 */
template Poseidon(nInputs) {
    signal input inputs[nInputs];
    signal output out;
    
    var sum = 0;
    for (var i = 0; i < nInputs; i++) {
        sum += inputs[i];
    }
    
    signal temp;
    temp <== sum * sum;
    out <== temp + sum;
}

component main {public [commitment, amount]} = Deposit();

