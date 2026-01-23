const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
const crypto = require('crypto');

const FIELD_PRIME = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

async function main() {
    console.log("Initializing Poseidon...");
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    // Generate random secret and nullifier
    const secretBytes = crypto.randomBytes(31);
    const nullifierBytes = crypto.randomBytes(31);
    
    const secret = BigInt('0x' + secretBytes.toString('hex')) % FIELD_PRIME;
    const nullifier = BigInt('0x' + nullifierBytes.toString('hex')) % FIELD_PRIME;
    
    // Amount in lamports (0.01 SOL)
    const noteAmount = BigInt(10_000_000);
    
    // Compute commitment = Poseidon(secret, Poseidon(nullifier, noteAmount))
    const innerHashResult = poseidon([F.e(nullifier.toString()), F.e(noteAmount.toString())]);
    const innerHash = BigInt(F.toString(innerHashResult));
    
    const commitmentResult = poseidon([F.e(secret.toString()), F.e(innerHash.toString())]);
    const commitment = BigInt(F.toString(commitmentResult));
    
    // Compute nullifier hash = Poseidon(nullifier, 0)
    const nullifierHashResult = poseidon([F.e(nullifier.toString()), F.e("0")]);
    const nullifierHash = BigInt(F.toString(nullifierHashResult));
    
    // Recipient (just use a random 31-byte value that fits in field)
    const recipient = BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD_PRIME;
    
    const withdrawAmount = noteAmount;
    const relayerFee = BigInt(0);

    console.log("Commitment:", commitment.toString());
    console.log("NullifierHash:", nullifierHash.toString());
    console.log("Recipient:", recipient.toString());

    const circuitInput = {
        commitment: commitment.toString(),
        nullifierHash: nullifierHash.toString(),
        recipient: recipient.toString(),
        amount: withdrawAmount.toString(),
        relayerFee: relayerFee.toString(),
        secret: secret.toString(),
        nullifier: nullifier.toString(),
        noteAmount: noteAmount.toString(),
    };

    console.log("\nGenerating proof...");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        'build/withdraw_simple_js/withdraw_simple.wasm',
        'build/withdraw_simple_final.zkey'
    );
    
    console.log("Proof generated!");
    console.log("Public signals:", publicSignals);

    console.log("\nVerifying proof locally...");
    const vk = JSON.parse(require('fs').readFileSync('build/withdraw_simple_vk.json'));
    const verified = await snarkjs.groth16.verify(vk, publicSignals, proof);
    
    console.log("Local verification:", verified ? "✅ VALID" : "❌ INVALID");
}

main().catch(console.error);
