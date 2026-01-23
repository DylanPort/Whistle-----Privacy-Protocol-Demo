# Whistle Protocol - Ceremony Guide

## For You (Ceremony Coordinator)

### Step 1: Initialize the Ceremony

```bash
cd whistle-complete/circuits/ceremony
npm install
npm run genesis
```

This creates the initial `withdraw_merkle_0000.zkey` from your compiled circuit.

### Step 2: Host the Ceremony Files

Option A: **GitHub Releases** (Recommended)
```bash
# Create a new release on GitHub
# Upload the latest .zkey file
# Contributors download from releases
```

Option B: **Simple HTTP Server**
```bash
# Host the contributions folder
npx serve contributions -p 8080
```

Option C: **IPFS** (Decentralized)
```bash
# Pin to IPFS
ipfs add contributions/withdraw_merkle_0000.zkey
# Share the CID with contributors
```

### Step 3: Announce the Ceremony

Share this message on Twitter/Discord:

```
🔐 Whistle Protocol Trusted Setup Ceremony

Help secure the ZK Privacy Pool by contributing randomness!

How to participate:
1. git clone https://github.com/whistle-protocol/ceremony
2. cd ceremony && npm install
3. npm run contribute

No technical knowledge needed - just mash your keyboard!
Each contributor makes the system more secure.

Current contributors: X
Goal: 100+
```

### Step 4: Collect & Verify Contributions

As contributions come in:
```bash
# Download new contribution
# Add to contributions/ folder
# Verify
npm run verify
```

### Step 5: Finalize

After enough contributions (50-100+):
```bash
npm run finalize
```

This exports the final zkey for production use.

---

## For Contributors (Community Members)

### What You're Doing

You're adding randomness to a cryptographic ceremony. Your random input gets mixed with everyone else's. If even ONE person is honest, the whole system is secure.

**Time required:** ~5 minutes
**Technical skill:** None needed
**Risk:** Zero - you're just adding randomness

### Quick Start (3 Commands)

```bash
# 1. Download the ceremony tools
git clone https://github.com/whistle-protocol/ceremony
cd ceremony

# 2. Install dependencies
npm install

# 3. Contribute!
npm run contribute
```

### What Happens When You Run It

```
═══════════════════════════════════════════════════════
   WHISTLE PROTOCOL - TRUSTED SETUP CEREMONY
═══════════════════════════════════════════════════════

[Step 1] Finding latest contribution...
Found contribution #12: withdraw_merkle_0012.zkey

[Step 2] Collecting randomness...

🎲 ENTROPY COLLECTION - Keyboard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type random characters for 30 seconds.
Mash your keyboard randomly!

**********************************  ← You typing randomly

✓ Collected 847 bytes of keyboard entropy
✓ Collected 2341 bytes of system entropy

[Step 3] Generating contribution (2-5 minutes)...
⏳ Processing...

[Step 4] Complete!

═══════════════════════════════════════════════════════
   ✅ CONTRIBUTION SUCCESSFUL!
═══════════════════════════════════════════════════════

📁 Output: withdraw_merkle_0013.zkey
🔐 Your contribution hash: a7b3c9d4e5f6...

🎉 Thank you for making Whistle Protocol more secure!
```

### After Contributing

1. **Upload your contribution** (the script will guide you)
2. **Delete any notes** of what you typed (for maximum security)
3. **Share on Twitter** that you contributed (optional, builds trust)

### FAQ

**Q: What if I mess up?**
A: You can't mess up. Any random input is valid.

**Q: Do I need to keep my random input secret?**
A: No! In fact, you should DELETE it. Once it's mixed in, forgetting it makes the system MORE secure.

**Q: Can I contribute multiple times?**
A: Yes, but one contribution is enough. More unique contributors > more contributions from same person.

**Q: How do I know this isn't stealing my data?**
A: The code is open source. You can read exactly what it does. It only collects keyboard timing and system entropy - no personal data.

**Q: What if I don't trust my computer?**
A: Use a fresh virtual machine, contribute, then delete the VM. That's maximum paranoia mode.

---

## Verification

Anyone can verify the ceremony at any time:

```bash
npm run verify
```

This checks:
- Each contribution builds on the previous one
- No contributions were tampered with
- The final zkey matches the circuit

---

## Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Genesis | Day 1 | Coordinator creates initial zkey |
| Collection | 2-4 weeks | Community contributes |
| Verification | 1 day | Verify all contributions |
| Finalization | 1 day | Export final zkey |
| Deployment | 1 day | Update contract & frontend |

---

## Security Model

```
Attacker needs to compromise:
┌─────────────────────────────────────────┐
│ Contributor 1  AND                      │
│ Contributor 2  AND                      │
│ Contributor 3  AND                      │
│ ...            AND                      │
│ Contributor N                           │
└─────────────────────────────────────────┘
         ↓
If ANY ONE contributor is honest
         ↓
    System is SECURE
```

With 100 contributors from different countries, devices, and backgrounds - compromising all of them is practically impossible.
