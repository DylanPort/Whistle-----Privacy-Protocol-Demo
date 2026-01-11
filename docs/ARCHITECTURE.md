# Whistle Protocol Architecture

## System Overview

```
+------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |
|   User Wallet    |---->|   Privacy Pool   |---->|  Fresh Wallet    |
|                  |     |   (On-chain)     |     |                  |
+------------------+     +------------------+     +------------------+
        |                        |                        ^
        | deposit                | verify                 | withdraw
        v                        v                        |
+------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |
|   Commitment     |     |   ZK Verifier    |     |   Relayer        |
|   Generation     |     |   (Groth16)      |     |   Service        |
+------------------+     +------------------+     +------------------+
```

## Components

### 1. ZK Circuits (Circom)

**Location**: `circuits/`

The zero-knowledge circuits define what can be proven without revealing:

```
circuits/
├── withdraw.circom     # Main withdrawal proof
├── deposit.circom      # Deposit commitment proof
└── lib/
    └── merkle.circom   # Merkle tree verification
```

**Withdraw Circuit**:
- Proves knowledge of (secret, nullifier) that hash to a commitment in the Merkle tree
- Public inputs: merkleRoot, nullifierHash, recipient, amount, relayerFee
- Private inputs: secret, nullifier, pathElements, pathIndices

**Constraint count**: ~5,449

### 2. Smart Contracts (Anchor/Rust)

**Location**: `contracts/programs/`

```
contracts/programs/
├── whistle-pool/       # Main privacy pool
├── whistle-verifier/   # Groth16 verification
└── whistle-merkle/     # Merkle tree management
```

**whistle-pool**:
- `initialize`: Create new pool with Merkle tree
- `deposit`: Add commitment to tree, receive funds
- `withdraw`: Verify proof, release funds
- `transfer`: Internal transfers (spend old, create new)

**Account Structure**:
```
Pool (50 bytes)
├── merkle_levels: u8
├── next_index: u64
├── current_root: [u8; 32]
├── total_deposits: u64
└── bump: u8

MerkleTree (1,288 bytes)
├── filled_subtrees: [[u8; 32]; 20]
├── zeros: [[u8; 32]; 20]
└── levels_used: u8

NullifierSet (8,200 bytes)
├── spent: [[u8; 32]; 256]
└── count: u16
```

### 3. SDK (TypeScript)

**Location**: `sdk/src/`

```
sdk/src/
├── index.ts        # Exports
├── client.ts       # On-chain interactions
├── prover.ts       # Proof generation
└── core/
    └── constants.ts
```

**Key Functions**:
- `generateDepositNote()`: Create secret + nullifier
- `generateWithdrawProof()`: Build ZK proof
- `buildMerkleProof()`: Compute tree path

### 4. Relayer Service

**Location**: `relayer/src/`

Enables anonymous withdrawals by submitting transactions on behalf of users:

```
User -> Relayer API -> Solana Network -> Recipient
```

**Endpoints**:
- `POST /withdraw`: Submit proof and receive funds
- `GET /info`: Relayer status
- `GET /nullifier/:hash`: Check if spent

## Data Flow

### Deposit Flow

```
1. User generates note: {secret, nullifier, amount}
2. Compute commitment: H(secret || nullifier || amount)
3. Send deposit TX with commitment
4. Contract adds commitment to Merkle tree
5. User saves note (offline)
```

### Withdrawal Flow

```
1. User retrieves Merkle tree state
2. Build Merkle proof for their commitment
3. Generate ZK proof proving:
   - Knowledge of preimage (secret, nullifier)
   - Commitment exists in tree
   - Nullifier not yet used
4. Submit proof to relayer (or direct)
5. Contract verifies proof
6. Funds sent to recipient
7. Nullifier marked spent
```

## Security Properties

### Privacy Guarantees

1. **Deposit-Withdraw Unlinkability**: ZK proof reveals nothing about which deposit is being spent

2. **Forward Privacy**: Future deposits don't reveal past activity

3. **Relayer Privacy**: Relayer cannot link user IP to deposit

### Security Guarantees

1. **No Double-Spend**: Nullifier tracking prevents reuse

2. **Proof Soundness**: Invalid proofs rejected by verifier

3. **No Admin Keys**: Contract is immutable after deployment

## Cryptographic Details

### Hash Function: Poseidon

- ZK-friendly algebraic hash
- 5 full rounds + 57 partial rounds
- Works over BN254 scalar field

### Proving System: Groth16

- Constant-size proofs (192 bytes)
- Fast verification (~1ms)
- Requires trusted setup (Powers of Tau)

### Curve: BN254 (alt_bn128)

- Pairing-friendly elliptic curve
- Supported by Solana syscalls
- 254-bit security

## Limitations

### Current Implementation

1. **Verification**: Using placeholder (production needs alt_bn128 syscalls)
2. **Circuit Size**: Optimized for demonstration, not gas
3. **Anonymity Set**: Limited by number of deposits

### Production Considerations

1. Proper trusted setup ceremony
2. Circuit audit
3. Gas optimization
4. Larger nullifier storage
5. Multiple pool denominations

