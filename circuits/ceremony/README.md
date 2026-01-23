# Whistle Protocol - Trusted Setup Ceremony

## What is this?

Before the ZK Privacy Pool can safely hold real funds, we need a **trusted setup ceremony**. This is a cryptographic ritual where multiple independent contributors add randomness to make the system secure.

## Why does it matter?

The ZK-SNARK system uses a secret "toxic waste" value. If anyone knows this value, they could:
- Create fake proofs
- Drain all funds from the pool
- Break privacy for all users

**The solution:** Multiple people contribute randomness. The final secret is the PRODUCT of all contributions. An attacker would need to compromise EVERY SINGLE contributor to break the system.

**If even ONE contributor is honest and destroys their randomness, the system is secure forever.**

## How to Contribute

### Prerequisites
- Node.js 18+
- 8GB+ RAM (proof generation is memory-intensive)
- ~10 minutes of time

### Step 1: Download the contribution package

```bash
git clone https://github.com/whistle-protocol/ceremony
cd ceremony
npm install
```

### Step 2: Download the latest contribution file

Each contributor builds on the previous one's work:

```bash
# Download the current state (contribution_N.zkey)
npm run download-latest
```

### Step 3: Add your randomness

```bash
npm run contribute
```

This will:
1. Ask you to type random characters (keyboard entropy)
2. Move your mouse randomly (mouse entropy)  
3. Mix in system entropy (CPU timing, memory state)
4. Generate your contribution

**Important:** The randomness you add is NEVER saved or transmitted. Only the resulting contribution file is uploaded.

### Step 4: Upload your contribution

```bash
npm run upload
```

### Step 5: Verify (optional but recommended)

```bash
npm run verify
```

## Technical Details

### Circuit: withdraw_merkle

The main withdrawal circuit that proves:
- You know a secret corresponding to a commitment in the Merkle tree
- The nullifier hasn't been used before
- The withdrawal amount matches your deposit

### Ceremony Phases

**Phase 1: Powers of Tau** (already complete)
- Using Hermez ceremony with 21+ contributors
- File: `powersOfTau28_hez_final_15.ptau`
- This is reusable across all circuits

**Phase 2: Circuit-Specific** (this ceremony)
- Specific to our `withdraw_merkle` circuit
- Each contributor adds entropy
- Creates the final `withdraw_merkle_final.zkey`

### Verification

After the ceremony ends, anyone can verify:

```bash
# Verify the entire ceremony chain
npm run verify-chain

# Verify the final zkey matches the circuit
snarkjs zkey verify withdraw_merkle.r1cs powersOfTau28_hez_final_15.ptau withdraw_merkle_final.zkey
```

## Contribution Log

| # | Contributor | Date | Hash | Verified |
|---|-------------|------|------|----------|
| 0 | Genesis (Whistle Team) | 2026-01-23 | `abc123...` | ✅ |
| 1 | *Your name here* | | | |

## Security Considerations

### What contributors should do:
- ✅ Use a secure, malware-free computer
- ✅ Disconnect from internet during entropy generation
- ✅ Delete all traces after contributing
- ✅ Never share your random input

### What contributors DON'T need to worry about:
- ❌ Keeping secrets long-term (destroy after contributing)
- ❌ Trusting other contributors (that's the point!)
- ❌ Technical expertise (the script handles everything)

## FAQ

**Q: What if I lose my random input after contributing?**
A: Perfect! That's exactly what should happen. Once destroyed, even you can't break the system.

**Q: What if a malicious person contributes?**
A: Doesn't matter! They only know THEIR randomness. The final secret requires ALL contributions.

**Q: How do I know the ceremony software isn't malicious?**
A: The code is open source and auditable. You can review exactly what entropy is collected and how it's used.

**Q: Can I contribute multiple times?**
A: Yes, but each contribution only adds security once. More unique contributors = better.

## Contact

- GitHub Issues: Report problems
- Discord: #ceremony-support
- Email: ceremony@whistle.finance
