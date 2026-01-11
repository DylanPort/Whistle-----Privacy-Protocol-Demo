# Whistle Protocol

A zero-knowledge privacy protocol for Solana. Built from scratch for the Solana Privacy Hackathon.

## Overview

Whistle Protocol enables private transactions on Solana using zero-knowledge proofs. Users deposit SOL into a privacy pool and can withdraw to any address without creating an on-chain link between deposit and withdrawal.

**This is not a fork.** Every component was built from the ground up:
- Custom Circom circuits for ZK proofs
- Solana smart contracts in Rust/Anchor
- TypeScript SDK for proof generation
- Relayer network for anonymous withdrawals

## How It Works

1. **Deposit**: User deposits SOL with a commitment (hash of secret + nullifier)
2. **Wait**: Deposit is added to a Merkle tree with other deposits
3. **Withdraw**: User generates a ZK proof showing they own a valid deposit without revealing which one
4. **Privacy**: Withdrawal goes to a fresh address. No on-chain link exists.

## Architecture

```
whistle-protocol/
├── circuits/           # Circom ZK circuits
│   ├── withdraw.circom # Main withdrawal circuit (5,449 constraints)
│   ├── deposit.circom  # Deposit commitment circuit
│   └── lib/            # Poseidon hash, Merkle tree proofs
├── contracts/          # Solana programs (Anchor)
│   └── programs/
│       ├── whistle-pool/      # Main privacy pool
│       ├── whistle-verifier/  # Groth16 proof verification
│       └── whistle-merkle/    # Merkle tree management
├── sdk/               # TypeScript SDK
├── relayer/           # Anonymous transaction relay service
└── frontend/          # React UI (Next.js)
```

## Technical Specifications

### Zero-Knowledge Circuits

- **Proving System**: Groth16 on BN254 curve
- **Hash Function**: Poseidon (ZK-friendly)
- **Merkle Tree**: 20 levels, ~1M deposits capacity
- **Constraints**: 5,449 (withdraw circuit)

### Smart Contracts

- **Pool Program**: `7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV`
- **Verifier Program**: `7vBdkq62GbtXjoJydEEjn996kkr8kcbgrZcGbe7zSj1u`
- **Network**: Solana Devnet

### Supported Amounts

Fixed denominations for anonymity set:
- 1 SOL
- 10 SOL
- 100 SOL

## Building

### Prerequisites

- Rust 1.70+
- Node.js 18+
- Solana CLI 1.17+
- Anchor 0.29+
- Circom 2.1+

### Circuits

```bash
cd circuits
npm install
npm run compile
npm run setup
```

### Contracts

```bash
cd contracts
anchor build
anchor deploy --provider.cluster devnet
```

### SDK

```bash
cd sdk
npm install
npm run build
```

### Relayer

```bash
cd relayer
npm install
npm run start
```

## Usage

### Deposit

```typescript
import { WhistleClient, generateDepositNote } from '@whistle/sdk';

const client = new WhistleClient(connection, wallet);
const note = await generateDepositNote(1_000_000_000); // 1 SOL

const tx = await client.deposit(note.commitment, note.amount);
// Save note.secret - required for withdrawal
```

### Withdraw

```typescript
const proof = await generateWithdrawProof(
  note.secret,
  note.nullifier,
  recipientAddress,
  merkleTree
);

const tx = await client.withdraw(proof, recipientAddress);
```

## Security Model

### Guarantees

- **Privacy**: ZK proofs reveal nothing about deposit origin
- **Non-custodial**: Users control their funds via secret notes
- **Immutable**: No admin keys, no pause function, no blacklist
- **Censorship Resistant**: Multiple relayers, open protocol

### Trust Assumptions

- Trusted setup ceremony (Powers of Tau + circuit-specific)
- Solana validator set
- Cryptographic assumptions (discrete log, pairing)

## Comparison: Whistle vs Light Protocol

| Aspect | Light Protocol | Whistle Protocol |
|--------|---------------|------------------|
| Approach | SDK/Infrastructure | Full custom implementation |
| ZK System | Uses existing | Custom Circom circuits |
| Learning | Import and use | Built to understand |
| Optimization | Battle-tested | Hackathon prototype |
| Time | Hours to integrate | Weeks to build |

Light Protocol is production infrastructure. Whistle is a from-scratch implementation to demonstrate understanding of ZK privacy systems.

## Files

### Key Source Files

- `circuits/withdraw.circom` - Main ZK circuit
- `contracts/programs/whistle-pool/src/lib.rs` - Pool contract
- `contracts/programs/whistle-verifier/src/lib.rs` - Verifier contract
- `sdk/src/prover.ts` - Proof generation
- `relayer/src/index.ts` - Relay service

### Generated Artifacts

- `circuits/build/withdraw_final.zkey` - Proving key
- `circuits/build/withdraw_verification_key.json` - Verification key
- `contracts/target/deploy/*.so` - Compiled programs

## License

MIT

## Hackathon Notes

This project was built for the Solana Privacy Hackathon. The implementation prioritizes demonstrating understanding over production optimization.

What was built from scratch:
- Circom circuits for deposit/withdraw proofs
- Poseidon hash implementation
- Merkle tree membership proofs
- Solana smart contracts
- Proof generation SDK
- Relayer service

What could be improved for production:
- Full Groth16 verification on-chain (uses alt_bn128 syscalls)
- Circuit optimization
- Larger anonymity sets
- Additional privacy features (shielded transfers)

