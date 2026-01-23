#!/usr/bin/env node
/**
 * Whistle Protocol - Genesis Ceremony Setup
 * 
 * Creates the initial (genesis) contribution from the compiled circuit.
 * This should only be run once by the protocol team.
 */

const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CIRCUIT_NAME = 'withdraw_merkle';
const BUILD_DIR = path.join(__dirname, '..', 'build', 'production', CIRCUIT_NAME);
const PTAU_DIR = path.join(__dirname, '..', 'ptau');
const CONTRIBUTIONS_DIR = path.join(__dirname, 'contributions');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(msg, color = '') {
  console.log(`${color}${msg}${colors.reset}`);
}

async function main() {
  console.clear();
  log('═'.repeat(60), colors.cyan);
  log('   WHISTLE PROTOCOL - GENESIS CEREMONY SETUP', colors.bright);
  log('═'.repeat(60), colors.cyan);
  
  const r1csPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}.r1cs`);
  const ptauPath = path.join(PTAU_DIR, 'powersOfTau28_hez_final_15.ptau');
  const genesisZkey = path.join(CONTRIBUTIONS_DIR, `${CIRCUIT_NAME}_0000.zkey`);
  
  // Check prerequisites
  log('\n📋 Checking prerequisites...', colors.cyan);
  
  if (!fs.existsSync(r1csPath)) {
    log(`\n❌ Circuit R1CS not found: ${r1csPath}`, colors.red);
    log('   Run the circuit compilation first.', colors.yellow);
    process.exit(1);
  }
  log(`  ✓ Circuit R1CS: ${r1csPath}`, colors.green);
  
  if (!fs.existsSync(ptauPath)) {
    log(`\n❌ Powers of Tau not found: ${ptauPath}`, colors.red);
    log('   Download it first: npm run download-ptau', colors.yellow);
    process.exit(1);
  }
  log(`  ✓ Powers of Tau: ${ptauPath}`, colors.green);
  
  // Create contributions directory
  if (!fs.existsSync(CONTRIBUTIONS_DIR)) {
    fs.mkdirSync(CONTRIBUTIONS_DIR, { recursive: true });
  }
  
  // Check if genesis already exists
  if (fs.existsSync(genesisZkey)) {
    log(`\n⚠️  Genesis zkey already exists: ${genesisZkey}`, colors.yellow);
    log('   Delete it first if you want to regenerate.', colors.yellow);
    process.exit(1);
  }
  
  // Generate genesis contribution
  log('\n🔧 Generating genesis contribution...', colors.cyan);
  log('   This creates the initial zkey from the circuit.', colors.magenta);
  log('   This may take several minutes...\n', colors.yellow);
  
  const startTime = Date.now();
  
  try {
    // Create the initial zkey (Phase 2 setup)
    await snarkjs.zKey.newZKey(
      r1csPath,
      ptauPath,
      genesisZkey
    );
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    log('\n' + '═'.repeat(60), colors.green);
    log('   ✅ GENESIS CONTRIBUTION CREATED', colors.bright + colors.green);
    log('═'.repeat(60), colors.green);
    
    // Get file hash
    const hash = crypto.createHash('sha256');
    const fileBuffer = fs.readFileSync(genesisZkey);
    hash.update(fileBuffer);
    const fileHash = hash.digest('hex');
    
    log(`\n📁 Output: ${genesisZkey}`, colors.cyan);
    log(`⏱️  Duration: ${duration} seconds`);
    log(`📏 Size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    log(`🔐 SHA256: ${fileHash.slice(0, 32)}...`);
    
    // Create initial log
    const logEntry = {
      number: 0,
      timestamp: new Date().toISOString(),
      type: 'genesis',
      r1cs: path.basename(r1csPath),
      ptau: path.basename(ptauPath),
      output: path.basename(genesisZkey),
      hash: fileHash,
    };
    
    const logPath = path.join(CONTRIBUTIONS_DIR, 'contribution_log.json');
    fs.writeFileSync(logPath, JSON.stringify([logEntry], null, 2));
    
    log('\n📋 Next steps:', colors.yellow);
    log('   1. Commit the genesis zkey to the repository');
    log('   2. Announce the ceremony start');
    log('   3. Contributors run: npm run contribute');
    log('   4. After enough contributions, finalize with: npm run finalize\n');
    
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, colors.red);
    console.error(error);
    process.exit(1);
  }
}

main().catch(console.error);
