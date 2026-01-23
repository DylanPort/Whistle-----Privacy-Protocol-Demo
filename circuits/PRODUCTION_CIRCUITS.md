# Production Circuit Requirements

This document outlines the dedicated ZK circuits needed for a production deployment of the Whistle Protocol.

## Current State

The current implementation uses `withdraw_simple.circom` for all withdrawal operations. This circuit:
- Proves knowledge of `(secret, nullifier)` that produces a commitment
- Verifies nullifier hash computation
- Binds the recipient to prevent front-running
- Does NOT verify Merkle tree membership (relies on on-chain check)

## Production Circuits Needed

### 1. `withdraw_merkle.circom` - Full Withdrawal Circuit

**Purpose:** Complete privacy-preserving withdrawal with Merkle proof

**Public Inputs:**
```
signal input merkleRoot;        // Current Merkle tree root
signal input nullifierHash;     // Hash of nullifier (for double-spend prevention)
signal input recipient;         // Withdrawal destination
signal input amount;            // Fixed withdrawal amount
signal input relayerFee;        // Fee for relayer
```

**Private Inputs:**
```
signal input secret;            // Random secret known only to depositor
signal input nullifier;         // Random nullifier for this note
signal input noteAmount;        // Amount stored in the note
signal input pathElements[N];   // Merkle proof path (N = tree depth)
signal input pathIndices[N];    // Merkle proof indices (left=0, right=1)
```

**Constraints:**
1. `commitment = Poseidon(secret, Poseidon(nullifier, noteAmount))`
2. `nullifierHash = Poseidon(nullifier, 0)`
3. `merkleRoot === MerkleProof(commitment, pathElements, pathIndices)`
4. `noteAmount >= amount + relayerFee`
5. Bind recipient to prevent front-running

**Estimated Constraints:** ~25,000-30,000

---

### 2. `unshield_change.circom` - Withdrawal with Change

**Purpose:** Withdraw fixed denomination with automatic change re-shielding

**Public Inputs:**
```
signal input merkleRoot;           // Current Merkle tree root
signal input nullifierHash;        // Input note nullifier hash
signal input recipient;            // Withdrawal destination
signal input withdrawalAmount;     // Fixed denomination being withdrawn
signal input relayerFee;           // Fee for relayer
signal input changeCommitment;     // New note commitment for change
```

**Private Inputs:**
```
signal input secret;               // Input note secret
signal input nullifier;            // Input note nullifier
signal input noteAmount;           // Input note amount
signal input pathElements[N];      // Merkle proof for input note
signal input pathIndices[N];       // Merkle proof indices
signal input changeSecret;         // New secret for change note
signal input changeNullifier;      // New nullifier for change note
```

**Constraints:**
1. Verify input commitment exists in Merkle tree
2. `nullifierHash = Poseidon(nullifier, 0)`
3. `changeAmount = noteAmount - withdrawalAmount - relayerFee`
4. `changeAmount >= 0` (range check)
5. `changeCommitment = Poseidon(changeSecret, Poseidon(changeNullifier, changeAmount))`
6. If `changeAmount == 0`, then `changeCommitment == 0` (no change note)

**Estimated Constraints:** ~35,000-40,000

---

### 3. `private_transfer.circom` - Shielded Transfer

**Purpose:** Transfer shielded balance without revealing amounts

**Public Inputs:**
```
signal input merkleRoot;               // Current Merkle tree root
signal input inputNullifierHashes[2];  // Nullifier hashes for input notes
signal input outputCommitments[2];     // Commitments for output notes
```

**Private Inputs:**
```
// Input note 1
signal input inSecret1;
signal input inNullifier1;
signal input inAmount1;
signal input inPathElements1[N];
signal input inPathIndices1[N];

// Input note 2 (can be zero)
signal input inSecret2;
signal input inNullifier2;
signal input inAmount2;
signal input inPathElements2[N];
signal input inPathIndices2[N];

// Output note 1
signal input outSecret1;
signal input outNullifier1;
signal input outAmount1;

// Output note 2 (can be zero)
signal input outSecret2;
signal input outNullifier2;
signal input outAmount2;
```

**Constraints:**
1. For each non-zero input: verify Merkle membership
2. `inputNullifierHashes[i] = Poseidon(inNullifier[i], 0)`
3. `outputCommitments[i] = Poseidon(outSecret[i], Poseidon(outNullifier[i], outAmount[i]))`
4. **Value conservation:** `inAmount1 + inAmount2 == outAmount1 + outAmount2`
5. All amounts >= 0 (range checks)

**Estimated Constraints:** ~60,000-70,000

---

## Recommended Hash Function

For production, use **Poseidon hash** throughout:
- Optimized for ZK circuits (low constraint count)
- Widely audited and used in production protocols
- Compatible with `circomlibjs` for client-side computation

```circom
include "circomlib/circuits/poseidon.circom";

// Example: Commitment computation
component commitmentHash = Poseidon(2);
commitmentHash.inputs[0] <== secret;
commitmentHash.inputs[1] <== innerHash.out;
```

---

## Trusted Setup Requirements

Each circuit requires its own trusted setup ceremony:

1. **Powers of Tau** (can be shared across circuits)
   - Use existing ceremony (Hermez, Perpetual Powers of Tau)
   - Or run your own with sufficient participants

2. **Phase 2** (circuit-specific)
   - Must be run for each circuit
   - Minimum 3-5 independent contributors recommended
   - Publish contributions publicly for verification

### Trusted Setup Commands

```bash
# Download powers of tau (e.g., 2^20 for up to ~1M constraints)
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau

# Compile circuit
circom withdraw_merkle.circom --r1cs --wasm --sym

# Start phase 2
snarkjs groth16 setup withdraw_merkle.r1cs powersOfTau28_hez_final_20.ptau withdraw_merkle_0000.zkey

# Contribute to ceremony (repeat with different contributors)
snarkjs zkey contribute withdraw_merkle_0000.zkey withdraw_merkle_0001.zkey --name="Contributor 1"
snarkjs zkey contribute withdraw_merkle_0001.zkey withdraw_merkle_0002.zkey --name="Contributor 2"

# Apply random beacon (from blockchain hash)
snarkjs zkey beacon withdraw_merkle_0002.zkey withdraw_merkle_final.zkey <beacon_hash> 10

# Export verification key
snarkjs zkey export verificationkey withdraw_merkle_final.zkey withdraw_merkle_vk.json

# Convert VK to Rust format for Solana program
node convert_vk.js withdraw_merkle_vk.json > withdraw_merkle_vk.rs
```

---

## On-Chain Verification Key Updates

After generating new circuits:

1. Convert verification keys to Rust byte arrays
2. Update `groth16.rs` with new VK constants
3. Add separate VK functions for each circuit type:

```rust
// groth16.rs
pub fn get_withdraw_merkle_vk() -> Groth16Verifyingkey<'static> { ... }
pub fn get_unshield_change_vk() -> Groth16Verifyingkey<'static> { ... }
pub fn get_private_transfer_vk() -> Groth16Verifyingkey<'static> { ... }
```

4. Update verification functions to use appropriate VK:

```rust
fn verify_unshield_proof(...) -> Result<bool> {
    let vk = get_unshield_change_vk();
    // ... verification logic
}

fn verify_transfer_proof(...) -> Result<bool> {
    let vk = get_private_transfer_vk();
    // ... verification logic
}
```

---

## Security Considerations

1. **Range Checks:** All amount values must have range proofs to prevent overflow attacks
2. **Nullifier Uniqueness:** Each note must have a unique nullifier
3. **Commitment Binding:** Commitments must bind to all note parameters
4. **Merkle Depth:** Use sufficient depth (20 levels = 1M deposits)
5. **Field Element Safety:** Truncate Solana pubkeys to 31 bytes for BN254 field compatibility

---

## Testing Checklist

Before production deployment:

- [ ] Formal verification of circuit constraints
- [ ] Fuzz testing with random inputs
- [ ] Edge case testing (zero amounts, max amounts, etc.)
- [ ] Cross-verification between client and on-chain
- [ ] Gas/compute unit benchmarking on Solana
- [ ] Third-party security audit
- [ ] Public trusted setup ceremony with verification

---

## References

- [Tornado Cash Circuits](https://github.com/tornadocash/tornado-core/tree/master/circuits)
- [Semaphore Protocol](https://github.com/semaphore-protocol/semaphore)
- [circomlibjs](https://github.com/iden3/circomlibjs)
- [snarkjs Documentation](https://github.com/iden3/snarkjs)
- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf)
