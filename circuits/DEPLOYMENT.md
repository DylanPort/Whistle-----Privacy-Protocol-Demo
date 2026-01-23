# Whistle Protocol - Production Circuit Deployment Guide

This guide walks through deploying the production ZK circuits for full privacy guarantees.

## Overview

The production circuits provide:
- **withdraw_merkle**: Full withdrawal with Merkle membership proof
- **unshield_change**: Tornado-style withdrawal with automatic change re-shielding
- **private_transfer**: 2-in-2-out shielded transfers (split/merge/send)

## Prerequisites

### Required Software

1. **Circom 2.1.0+**
   ```bash
   # Install Rust first
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   
   # Install circom
   git clone https://github.com/iden3/circom.git
   cd circom
   cargo build --release
   cargo install --path circom
   
   # Verify
   circom --version
   ```

2. **Node.js 16+**
   ```bash
   node --version  # Should be 16+
   ```

3. **Dependencies**
   ```bash
   cd circuits
   npm install
   ```

## Step 1: Compile Circuits

Compile all production circuits:

```bash
npm run compile:prod
```

Or compile a specific circuit:

```bash
npm run compile:prod -- withdraw_merkle
```

### Expected Output

```
circuits/
└── build/
    └── production/
        ├── withdraw_merkle/
        │   ├── withdraw_merkle.r1cs
        │   ├── withdraw_merkle.sym
        │   └── withdraw_merkle_js/
        │       ├── withdraw_merkle.wasm
        │       └── generate_witness.js
        ├── unshield_change/
        │   └── ...
        └── private_transfer/
            └── ...
```

## Step 2: Trusted Setup

⚠️ **SECURITY WARNING**: The development setup is for testing only. For mainnet, run a proper multi-party computation ceremony.

### Development Setup

```bash
npm run setup:prod
```

This will:
1. Download Powers of Tau from Hermez ceremony (~500MB)
2. Generate circuit-specific zkeys (Phase 2)
3. Apply random beacon
4. Export verification keys

### Production Setup (Mainnet)

For production, organize a proper ceremony:

1. **Use Existing Powers of Tau**
   - [Hermez Ceremony](https://hermez.io/ptau)
   - [Perpetual Powers of Tau](https://github.com/weijiekoh/perpetualpowersoftau)

2. **Phase 2 Contributions**
   - Get 5+ independent contributors
   - Each contributor runs:
     ```bash
     snarkjs zkey contribute circuit_N.zkey circuit_N+1.zkey --name="Contributor Name"
     ```
   - Publish contribution hashes publicly

3. **Apply Random Beacon**
   Use a verifiable random source:
   ```bash
   # Use a future Ethereum block hash
   snarkjs zkey beacon circuit_final.zkey circuit_beacon.zkey <block_hash> 10
   ```

## Step 3: Convert Verification Keys

Convert the verification keys to Solana-compatible Rust format:

```bash
npm run convert:vk
```

### Output Files

```
build/production/
├── withdraw_merkle/vk_solana.rs
├── unshield_change/vk_solana.rs
├── private_transfer/vk_solana.rs
└── groth16_vk.rs  # Combined file
```

## Step 4: Update Smart Contract

1. **Copy VK files to contract**
   ```bash
   cp build/production/groth16_vk.rs ../contracts/programs/whistle-pool/src/
   ```

2. **Update lib.rs** to import and use new VKs:

   ```rust
   mod groth16_vk;
   use groth16_vk::{
       get_withdraw_merkle_vk,
       get_unshield_change_vk,
       get_private_transfer_vk
   };
   
   fn verify_withdraw_proof(...) -> Result<bool> {
       let vk = get_withdraw_merkle_vk();
       // ... verification logic
   }
   ```

3. **Rebuild and deploy**
   ```bash
   cd ../contracts
   anchor build
   anchor deploy
   ```

## Step 5: Update Frontend

Copy the WASM and zkey files to your frontend:

```bash
mkdir -p ../frontend/public/circuits
cp -r build/production/*/withdraw_merkle_js ../frontend/public/circuits/
cp build/production/*/withdraw_merkle_final.zkey ../frontend/public/circuits/
# ... repeat for other circuits
```

Use the SDK for proof generation:

```typescript
import { WhistleProver } from './sdk/proof-generator';

const prover = new WhistleProver();
await prover.initialize();

// Create a note for deposit
const note = prover.createNote(1000000000n); // 1 SOL

// Generate withdrawal proof
const { proof, publicSignals } = await prover.generateWithdrawProof(
    note,
    merkleProof,
    recipientPubkey,
    withdrawAmount,
    relayerFee
);
```

## Circuit Specifications

### withdraw_merkle (10 levels)

| Input Type | Name | Description |
|------------|------|-------------|
| Public | merkleRoot | Current Merkle tree root |
| Public | nullifierHash | H(nullifier, 0) |
| Public | recipient | Withdrawal destination |
| Public | amount | Withdrawal amount |
| Public | relayerFee | Fee for relayer |
| Private | secret | Note secret |
| Private | nullifier | Note nullifier |
| Private | noteAmount | Amount in note |
| Private | pathElements[10] | Merkle proof siblings |
| Private | pathIndices[10] | Merkle proof positions |

**Estimated constraints**: ~25,000

### unshield_change (10 levels)

| Input Type | Name | Description |
|------------|------|-------------|
| Public | merkleRoot | Current Merkle tree root |
| Public | nullifierHash | Input note nullifier hash |
| Public | recipient | Withdrawal destination |
| Public | withdrawalAmount | Fixed denomination |
| Public | relayerFee | Fee for relayer |
| Public | changeCommitment | Change note commitment |
| Private | secret | Input note secret |
| Private | nullifier | Input note nullifier |
| Private | noteAmount | Input note amount |
| Private | pathElements[10] | Merkle proof |
| Private | pathIndices[10] | Merkle positions |
| Private | changeSecret | Change note secret |
| Private | changeNullifier | Change note nullifier |
| Private | changeAmount | Change amount |

**Estimated constraints**: ~35,000

### private_transfer (10 levels)

| Input Type | Name | Description |
|------------|------|-------------|
| Public | merkleRoot | Current Merkle tree root |
| Public | inputNullifierHashes[2] | Nullifier hashes |
| Public | outputCommitments[2] | New commitments |
| Private | inSecret1, inNullifier1, inAmount1 | Input 1 |
| Private | inPathElements1[10], inPathIndices1[10] | Merkle 1 |
| Private | inSecret2, inNullifier2, inAmount2 | Input 2 |
| Private | inPathElements2[10], inPathIndices2[10] | Merkle 2 |
| Private | outSecret1, outNullifier1, outAmount1 | Output 1 |
| Private | outSecret2, outNullifier2, outAmount2 | Output 2 |

**Estimated constraints**: ~65,000

## Testing

Generate test inputs:

```bash
npm run generate:inputs
```

Run circuit test:

```bash
npx snarkjs groth16 fullprove \
    build/production/withdraw_merkle/input_test.json \
    build/production/withdraw_merkle/withdraw_merkle_js/withdraw_merkle.wasm \
    build/production/withdraw_merkle/withdraw_merkle_final.zkey \
    build/production/withdraw_merkle/proof.json \
    build/production/withdraw_merkle/public.json
```

Verify proof:

```bash
npx snarkjs groth16 verify \
    build/production/withdraw_merkle/withdraw_merkle_vk.json \
    build/production/withdraw_merkle/public.json \
    build/production/withdraw_merkle/proof.json
```

## Security Checklist

Before mainnet deployment:

- [ ] All circuits compiled without errors
- [ ] Trusted setup completed with 5+ contributors
- [ ] Verification keys converted and deployed
- [ ] Circuit constraints formally verified
- [ ] Range checks tested with edge cases
- [ ] Value conservation tested
- [ ] Nullifier uniqueness tested
- [ ] Third-party security audit completed
- [ ] Bug bounty program launched

## Troubleshooting

### "Circom not found"
```bash
export PATH="$PATH:~/.cargo/bin"
```

### "Powers of Tau download failed"
Download manually from https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau

### "Not enough memory"
For large circuits, increase Node.js memory:
```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run setup:prod
```

### "Invalid proof"
- Ensure WASM and zkey match the same circuit compilation
- Check that public inputs are in the correct order
- Verify Merkle proof is generated correctly

## References

- [Circom Documentation](https://docs.circom.io/)
- [snarkjs GitHub](https://github.com/iden3/snarkjs)
- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf)
- [Tornado Cash Circuits](https://github.com/tornadocash/tornado-core)
