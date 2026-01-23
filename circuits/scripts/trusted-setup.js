/**
 * WHISTLE PROTOCOL - Trusted Setup Script
 * 
 * Performs the trusted setup ceremony for production circuits:
 * 1. Download Powers of Tau (or use existing)
 * 2. Generate circuit-specific zkey (Phase 2)
 * 3. Apply random beacon
 * 4. Export verification key
 * 
 * SECURITY WARNING:
 * For production deployment, this should be replaced with a 
 * proper multi-party computation ceremony with independent contributors.
 * 
 * Prerequisites:
 * - Circuits compiled (run compile-production.js first)
 * - snarkjs installed (npm install snarkjs)
 * 
 * Usage:
 *   node scripts/trusted-setup.js [circuit-name]
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CIRCUITS_DIR = path.join(__dirname, '..');
const BUILD_DIR = path.join(CIRCUITS_DIR, 'build', 'production');
const PTAU_DIR = path.join(CIRCUITS_DIR, 'build', 'ptau');

// Powers of Tau parameters
// Using power 20 supports circuits up to ~1M constraints
const PTAU_POWER = 20;
const PTAU_FILE = `powersOfTau28_hez_final_${PTAU_POWER}.ptau`;
const PTAU_URL = `https://hermez.s3-eu-west-1.amazonaws.com/${PTAU_FILE}`;

// Production circuits
const PRODUCTION_CIRCUITS = [
    'withdraw_merkle',
    'unshield_change', 
    'private_transfer'
];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function downloadPtau() {
    ensureDir(PTAU_DIR);
    const ptauPath = path.join(PTAU_DIR, PTAU_FILE);
    
    if (fs.existsSync(ptauPath)) {
        console.log(`✅ Powers of Tau file exists: ${PTAU_FILE}`);
        return ptauPath;
    }

    console.log(`\nDownloading Powers of Tau (${PTAU_FILE})...`);
    console.log(`This may take several minutes (~500MB)`);
    console.log(`URL: ${PTAU_URL}\n`);

    try {
        // Try curl first
        execSync(`curl -L -o "${ptauPath}" "${PTAU_URL}"`, { 
            stdio: 'inherit' 
        });
    } catch (e) {
        try {
            // Fallback to wget
            execSync(`wget -O "${ptauPath}" "${PTAU_URL}"`, { 
                stdio: 'inherit' 
            });
        } catch (e2) {
            console.error('❌ Failed to download Powers of Tau');
            console.error('Please download manually from:', PTAU_URL);
            console.error('And place in:', PTAU_DIR);
            process.exit(1);
        }
    }

    if (fs.existsSync(ptauPath)) {
        console.log(`\n✅ Downloaded: ${ptauPath}`);
        return ptauPath;
    }

    throw new Error('Download failed');
}

function runSetup(circuitName, ptauPath) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running trusted setup for: ${circuitName}`);
    console.log('='.repeat(60));

    const circuitDir = path.join(BUILD_DIR, circuitName);
    const r1csPath = path.join(circuitDir, `${circuitName}.r1cs`);
    
    if (!fs.existsSync(r1csPath)) {
        console.error(`❌ R1CS file not found: ${r1csPath}`);
        console.error('   Please compile the circuit first: node scripts/compile-production.js');
        return false;
    }

    try {
        // Phase 2: Generate initial zkey
        const zkey0Path = path.join(circuitDir, `${circuitName}_0000.zkey`);
        console.log('\n📋 Phase 2: Generating initial zkey...');
        execSync(
            `npx snarkjs groth16 setup "${r1csPath}" "${ptauPath}" "${zkey0Path}"`,
            { stdio: 'inherit', cwd: CIRCUITS_DIR }
        );

        // Contribution 1 (simulated - in production, have real contributors)
        const zkey1Path = path.join(circuitDir, `${circuitName}_0001.zkey`);
        console.log('\n🔐 Contribution 1: Adding entropy...');
        const entropy1 = crypto.randomBytes(64).toString('hex');
        execSync(
            `npx snarkjs zkey contribute "${zkey0Path}" "${zkey1Path}" --name="Whistle Setup Contributor 1" -e="${entropy1}"`,
            { stdio: 'inherit', cwd: CIRCUITS_DIR }
        );

        // Contribution 2
        const zkey2Path = path.join(circuitDir, `${circuitName}_0002.zkey`);
        console.log('\n🔐 Contribution 2: Adding entropy...');
        const entropy2 = crypto.randomBytes(64).toString('hex');
        execSync(
            `npx snarkjs zkey contribute "${zkey1Path}" "${zkey2Path}" --name="Whistle Setup Contributor 2" -e="${entropy2}"`,
            { stdio: 'inherit', cwd: CIRCUITS_DIR }
        );

        // Apply random beacon (using a hash of current time as beacon)
        // In production, use a verifiable random beacon (e.g., drand)
        const zkeyFinalPath = path.join(circuitDir, `${circuitName}_final.zkey`);
        console.log('\n🌟 Applying random beacon...');
        const beacon = crypto.createHash('sha256')
            .update(`whistle-${circuitName}-${Date.now()}`)
            .digest('hex');
        execSync(
            `npx snarkjs zkey beacon "${zkey2Path}" "${zkeyFinalPath}" "${beacon}" 10 --name="Final Beacon"`,
            { stdio: 'inherit', cwd: CIRCUITS_DIR }
        );

        // Verify the final zkey
        console.log('\n🔍 Verifying final zkey...');
        execSync(
            `npx snarkjs zkey verify "${r1csPath}" "${ptauPath}" "${zkeyFinalPath}"`,
            { stdio: 'inherit', cwd: CIRCUITS_DIR }
        );

        // Export verification key
        const vkPath = path.join(circuitDir, `${circuitName}_vk.json`);
        console.log('\n📤 Exporting verification key...');
        execSync(
            `npx snarkjs zkey export verificationkey "${zkeyFinalPath}" "${vkPath}"`,
            { stdio: 'inherit', cwd: CIRCUITS_DIR }
        );

        // Clean up intermediate files
        console.log('\n🧹 Cleaning up intermediate files...');
        [zkey0Path, zkey1Path, zkey2Path].forEach(f => {
            if (fs.existsSync(f)) fs.unlinkSync(f);
        });

        console.log(`\n✅ Trusted setup complete for ${circuitName}`);
        console.log(`   Final zkey: ${zkeyFinalPath}`);
        console.log(`   Verification key: ${vkPath}`);

        return true;

    } catch (error) {
        console.error(`\n❌ Setup failed for ${circuitName}:`);
        console.error(error.message);
        return false;
    }
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       WHISTLE PROTOCOL - Trusted Setup Ceremony            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    console.log('\n⚠️  WARNING: This is a DEVELOPMENT setup.');
    console.log('   For production, run a proper multi-party computation ceremony!');
    
    // Check for snarkjs
    try {
        execSync('npx snarkjs', { encoding: 'utf-8', stdio: 'pipe' });
        console.log(`\nsnarkjs: installed`);
    } catch (e) {
        // snarkjs with no args exits with error, but that's okay - it's installed
        if (!e.message.includes('Usage')) {
            console.log(`\nsnarkjs: installed (via npx)`);
        }
    }

    // Download Powers of Tau
    const ptauPath = await downloadPtau();

    // Parse arguments
    const specificCircuit = process.argv[2];
    
    let circuitsToSetup = PRODUCTION_CIRCUITS;
    if (specificCircuit) {
        if (!PRODUCTION_CIRCUITS.includes(specificCircuit)) {
            console.error(`\n❌ Unknown circuit: ${specificCircuit}`);
            console.log('Available circuits:', PRODUCTION_CIRCUITS.join(', '));
            process.exit(1);
        }
        circuitsToSetup = [specificCircuit];
    }

    // Run setup for each circuit
    const results = [];
    for (const circuit of circuitsToSetup) {
        const success = runSetup(circuit, ptauPath);
        results.push({ name: circuit, success });
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('TRUSTED SETUP SUMMARY');
    console.log('='.repeat(60));
    
    let allSuccess = true;
    results.forEach(r => {
        const status = r.success ? '✅' : '❌';
        console.log(`${status} ${r.name}`);
        if (!r.success) allSuccess = false;
    });

    if (allSuccess) {
        console.log('\n✅ All trusted setups completed!');
        console.log('\nNext steps:');
        console.log('1. Convert VK to Solana format: node scripts/convert-vk-solana.js');
        console.log('2. Update groth16.rs with new verification keys');
        console.log('3. Redeploy the smart contract');
    } else {
        console.log('\n❌ Some setups failed. Please check errors above.');
        process.exit(1);
    }
}

main().catch(console.error);
