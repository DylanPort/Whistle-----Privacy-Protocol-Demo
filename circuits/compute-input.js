const fs = require('fs');

// Match the circuit's simplified computations
const secret = BigInt("12345678901234567890");
const nullifier = BigInt("98765432109876543210");
const amount = BigInt(1000000000); // 1 SOL in lamports
const recipient = BigInt("1000000000000000000000000000000"); // Arbitrary recipient value
const relayerFee = BigInt(0);

// Compute commitment = secret * nullifier + amount
const commitment = secret * nullifier + amount;
console.log("Commitment:", commitment.toString());

// Compute nullifier hash = nullifier^2
const nullifierHash = nullifier * nullifier;
console.log("NullifierHash:", nullifierHash.toString());

// Build merkle path (16 levels)
const levels = 16;
const pathElements = [];
const pathIndices = [];

let currentHash = commitment;
console.log("\nMerkle path computation:");
console.log("Level 0 (leaf):", currentHash.toString());

for (let i = 0; i < levels; i++) {
    const sibling = BigInt(i + 1);
    pathElements.push(sibling.toString());
    pathIndices.push("0"); // All left
    
    // Compute next level using circuit's hash: left * right + i
    const left = currentHash;
    const right = sibling;
    const hash = left * right + BigInt(i);
    
    console.log(`Level ${i+1}: hash(${left}, ${right}) + ${i} = ${hash.toString().substring(0, 30)}...`);
    currentHash = hash;
}

const merkleRoot = currentHash;
console.log("\nFinal Merkle Root:", merkleRoot.toString());

// Create input JSON
const input = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    pathElements: pathElements,
    pathIndices: pathIndices,
    merkleRoot: merkleRoot.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipient.toString(),
    amount: amount.toString(),
    relayerFee: relayerFee.toString()
};

fs.writeFileSync('build/input.json', JSON.stringify(input, null, 2));
console.log("\n✓ Input saved to build/input.json");

// Also print for verification
console.log("\nPublic inputs:");
console.log("  merkleRoot:", merkleRoot.toString());
console.log("  nullifierHash:", nullifierHash.toString());
console.log("  recipient:", recipient.toString());
console.log("  amount:", amount.toString());
console.log("  relayerFee:", relayerFee.toString());

