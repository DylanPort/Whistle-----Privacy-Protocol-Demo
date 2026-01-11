# Deployment Guide

## Prerequisites

- Rust 1.70+
- Solana CLI 1.17+
- Anchor 0.29+
- Node.js 18+
- Circom 2.1+

## 1. Setup Environment

```bash
# Install Solana
sh -c "$(curl -sSfL https://release.solana.com/v1.17.0/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# Install Circom
npm install -g circom
```

## 2. Build Circuits

```bash
cd circuits
npm install

# Compile circuits
circom withdraw.circom --r1cs --wasm --sym -o build/
circom deposit.circom --r1cs --wasm --sym -o build/

# Trusted setup (use existing ptau for production)
snarkjs powersoftau new bn128 14 pot14_0000.ptau
snarkjs powersoftau contribute pot14_0000.ptau pot14_0001.ptau
snarkjs powersoftau prepare phase2 pot14_0001.ptau pot14_final.ptau

# Generate proving key
snarkjs groth16 setup build/withdraw.r1cs pot14_final.ptau withdraw_0000.zkey
snarkjs zkey contribute withdraw_0000.zkey withdraw_final.zkey

# Export verification key
snarkjs zkey export verificationkey withdraw_final.zkey withdraw_verification_key.json
```

## 3. Build Contracts

```bash
cd contracts

# Build
anchor build

# Get program IDs
solana address -k target/deploy/whistle_pool-keypair.json
solana address -k target/deploy/whistle_verifier-keypair.json

# Update Anchor.toml and lib.rs with new IDs
# Then rebuild
anchor build
```

## 4. Deploy to Devnet

```bash
# Configure for devnet
solana config set --url devnet

# Create deploy wallet
solana-keygen new -o ../keys/deploy-wallet.json

# Airdrop SOL
solana airdrop 2 --keypair ../keys/deploy-wallet.json

# Deploy
anchor deploy --provider.cluster devnet
```

## 5. Initialize Pool

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { WhistleClient } from '@whistle/sdk';

const connection = new Connection('https://api.devnet.solana.com');
const wallet = Keypair.fromSecretKey(/* your keypair */);
const client = new WhistleClient({ connection, wallet });

// Initialize pool with 20-level Merkle tree
await client.initialize(20);
```

## 6. Start Relayer

```bash
cd relayer
npm install

# Set environment
export RPC_URL=https://api.devnet.solana.com
export PORT=3600

# Start
npm run start
```

## Program IDs (Devnet)

| Program | Address |
|---------|---------|
| whistle-pool | `7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV` |
| whistle-verifier | `7vBdkq62GbtXjoJydEEjn996kkr8kcbgrZcGbe7zSj1u` |
| whistle-merkle | `C81ewP6VfPibPEYWirQ9A18bCoceRdCXmMbXv33zm9vC` |

## Verification

```bash
# Check deployment
solana program show 7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV

# View on explorer
# https://solscan.io/account/7H6GXuDXHaErfMgz5xYhDgpZVhUhWUFkhqgbw5iQrUfV?cluster=devnet
```

