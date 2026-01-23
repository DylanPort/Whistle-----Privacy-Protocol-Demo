/**
 * WHISTLE PROTOCOL - Production Circuit Compiler
 * 
 * Compiles all production circuits and generates artifacts:
 * - R1CS constraint system
 * - WASM prover
 * - Symbolic information
 * 
 * Prerequisites:
 * - circom 2.1.0+ installed globally
 * - Node.js 16+
 * 
 * Usage:
 *   node scripts/compile-production.js [circuit-name]
 * 
 * Examples:
 *   node scripts/compile-production.js              # Compile all circuits
 *   node scripts/compile-production.js withdraw_merkle  # Compile specific circuit
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CIRCUITS_DIR = path.join(__dirname, '..');
const BUILD_DIR = path.join(CIRCUITS_DIR, 'build', 'production');

// Production circuits to compile
const PRODUCTION_CIRCUITS = [
    {
        name: 'withdraw_merkle',
        file: 'withdraw_merkle.circom',
        description: 'Full withdrawal with Merkle proof verification',
        estimatedConstraints: '~25,000-30,000'
    },
    {
        name: 'unshield_change',
        file: 'unshield_change.circom',
        description: 'Withdrawal with automatic change re-shielding',
        estimatedConstraints: '~35,000-40,000'
    },
    {
        name: 'private_transfer',
        file: 'private_transfer.circom',
        description: 'Shielded balance transfers (2-in-2-out)',
        estimatedConstraints: '~60,000-70,000'
    }
];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function compileCircuit(circuit) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Compiling: ${circuit.name}`);
    console.log(`Description: ${circuit.description}`);
    console.log(`Expected constraints: ${circuit.estimatedConstraints}`);
    console.log('='.repeat(60));

    const circuitPath = path.join(CIRCUITS_DIR, circuit.file);
    const outputDir = path.join(BUILD_DIR, circuit.name);
    
    if (!fs.existsSync(circuitPath)) {
        console.error(`❌ Circuit file not found: ${circuitPath}`);
        return false;
    }

    ensureDir(outputDir);

    try {
        // Compile circuit with circom
        // --r1cs: Generate R1CS constraint system
        // --wasm: Generate WebAssembly prover
        // --sym: Generate symbolic information for debugging
        // --O1: Optimization level 1 (balanced)
        const cmd = `circom "${circuitPath}" --r1cs --wasm --sym --O1 -o "${outputDir}"`;
        
        console.log(`\nRunning: ${cmd}\n`);
        
        execSync(cmd, { 
            stdio: 'inherit',
            cwd: CIRCUITS_DIR 
        });

        // Check outputs
        const r1csPath = path.join(outputDir, `${circuit.name}.r1cs`);
        const wasmDir = path.join(outputDir, `${circuit.name}_js`);
        
        if (fs.existsSync(r1csPath) && fs.existsSync(wasmDir)) {
            console.log(`\n✅ Successfully compiled ${circuit.name}`);
            
            // Get constraint count from r1cs info
            try {
                const infoCmd = `snarkjs r1cs info "${r1csPath}"`;
                console.log('\nCircuit info:');
                execSync(infoCmd, { stdio: 'inherit' });
            } catch (e) {
                // snarkjs might not be available, skip info
            }
            
            return true;
        } else {
            console.error(`❌ Compilation output not found for ${circuit.name}`);
            return false;
        }

    } catch (error) {
        console.error(`❌ Failed to compile ${circuit.name}:`);
        console.error(error.message);
        return false;
    }
}

function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     WHISTLE PROTOCOL - Production Circuit Compiler         ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    // Check for circom
    try {
        const version = execSync('circom --version', { encoding: 'utf-8' });
        console.log(`\nCircom version: ${version.trim()}`);
    } catch (e) {
        console.error('❌ Circom not found. Please install circom 2.1.0+');
        console.error('   Installation: https://docs.circom.io/getting-started/installation/');
        process.exit(1);
    }

    // Parse arguments
    const specificCircuit = process.argv[2];
    
    // Filter circuits if specific one requested
    let circuitsToCompile = PRODUCTION_CIRCUITS;
    if (specificCircuit) {
        circuitsToCompile = PRODUCTION_CIRCUITS.filter(c => c.name === specificCircuit);
        if (circuitsToCompile.length === 0) {
            console.error(`\n❌ Unknown circuit: ${specificCircuit}`);
            console.log('\nAvailable circuits:');
            PRODUCTION_CIRCUITS.forEach(c => console.log(`  - ${c.name}: ${c.description}`));
            process.exit(1);
        }
    }

    // Ensure build directory exists
    ensureDir(BUILD_DIR);

    // Compile each circuit
    const results = [];
    for (const circuit of circuitsToCompile) {
        const success = compileCircuit(circuit);
        results.push({ name: circuit.name, success });
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('COMPILATION SUMMARY');
    console.log('='.repeat(60));
    
    let allSuccess = true;
    results.forEach(r => {
        const status = r.success ? '✅' : '❌';
        console.log(`${status} ${r.name}`);
        if (!r.success) allSuccess = false;
    });

    console.log('\n' + '='.repeat(60));
    
    if (allSuccess) {
        console.log('✅ All circuits compiled successfully!');
        console.log(`\nOutput directory: ${BUILD_DIR}`);
        console.log('\nNext steps:');
        console.log('1. Run trusted setup: node scripts/trusted-setup.js');
        console.log('2. Convert VK to Solana: node scripts/convert-vk-solana.js');
    } else {
        console.log('❌ Some circuits failed to compile. Please fix errors above.');
        process.exit(1);
    }
}

main();
