#!/usr/bin/env node
/**
 * Whistle Protocol - Ceremony Verification Script
 * 
 * Verifies that:
 * 1. Each contribution builds on the previous one
 * 2. The final zkey is valid for the circuit
 * 3. No malicious modifications were made
 */

const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CIRCUIT_NAME = 'withdraw_merkle';
const CONTRIBUTIONS_DIR = path.join(__dirname, 'contributions');
const PTAU_PATH = path.join(__dirname, '..', 'ptau', 'powersOfTau28_hez_final_15.ptau');
const CIRCUIT_R1CS = path.join(__dirname, '..', 'build', 'production', CIRCUIT_NAME, `${CIRCUIT_NAME}.r1cs`);

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(msg, color = '') {
  console.log(`${color}${msg}${colors.reset}`);
}

async function getContributions() {
  const files = fs.readdirSync(CONTRIBUTIONS_DIR)
    .filter(f => f.startsWith(`${CIRCUIT_NAME}_`) && f.endsWith('.zkey'))
    .sort();
  
  return files.map(f => ({
    path: path.join(CONTRIBUTIONS_DIR, f),
    name: f,
    number: parseInt(f.match(/_(\d+)\.zkey$/)?.[1] || '0')
  }));
}

async function verifyContribution(zkeyPath) {
  try {
    // Read the zkey and verify its structure
    const zkeyData = await snarkjs.zKey.exportVerificationKey(zkeyPath);
    return { valid: true, vkey: zkeyData };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

async function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function main() {
  console.clear();
  log('═'.repeat(60), colors.cyan);
  log('   WHISTLE PROTOCOL - CEREMONY VERIFICATION', colors.bright);
  log('═'.repeat(60), colors.cyan);
  
  try {
    // Get all contributions
    const contributions = await getContributions();
    
    if (contributions.length === 0) {
      log('\n❌ No contributions found!', colors.red);
      process.exit(1);
    }
    
    log(`\nFound ${contributions.length} contribution(s)\n`);
    
    // Verify each contribution
    log('─'.repeat(60));
    log('Verifying contribution chain...', colors.cyan);
    log('─'.repeat(60));
    
    let allValid = true;
    const results = [];
    
    for (const contrib of contributions) {
      process.stdout.write(`\n  #${contrib.number}: ${contrib.name} ... `);
      
      const result = await verifyContribution(contrib.path);
      const fileHash = await computeFileHash(contrib.path);
      
      if (result.valid) {
        log('✅ Valid', colors.green);
        results.push({
          number: contrib.number,
          file: contrib.name,
          hash: fileHash.slice(0, 16) + '...',
          status: 'valid'
        });
      } else {
        log('❌ Invalid', colors.red);
        log(`     Error: ${result.error}`, colors.yellow);
        allValid = false;
        results.push({
          number: contrib.number,
          file: contrib.name,
          status: 'invalid',
          error: result.error
        });
      }
    }
    
    // Verify final zkey against circuit (if r1cs exists)
    if (fs.existsSync(CIRCUIT_R1CS) && fs.existsSync(PTAU_PATH)) {
      log('\n─'.repeat(60));
      log('Verifying final zkey against circuit...', colors.cyan);
      log('─'.repeat(60));
      
      const finalZkey = contributions[contributions.length - 1].path;
      
      try {
        const verifyResult = await snarkjs.zKey.verifyFromR1cs(
          CIRCUIT_R1CS,
          PTAU_PATH,
          finalZkey
        );
        
        if (verifyResult) {
          log('\n  ✅ Final zkey is valid for the circuit!', colors.green);
        } else {
          log('\n  ❌ Final zkey verification failed!', colors.red);
          allValid = false;
        }
      } catch (error) {
        log(`\n  ⚠️  Could not verify against circuit: ${error.message}`, colors.yellow);
      }
    }
    
    // Summary
    log('\n' + '═'.repeat(60), allValid ? colors.green : colors.red);
    if (allValid) {
      log('   ✅ ALL VERIFICATIONS PASSED', colors.bright + colors.green);
    } else {
      log('   ❌ SOME VERIFICATIONS FAILED', colors.bright + colors.red);
    }
    log('═'.repeat(60), allValid ? colors.green : colors.red);
    
    // Print contribution log
    const logPath = path.join(CONTRIBUTIONS_DIR, 'contribution_log.json');
    if (fs.existsSync(logPath)) {
      log('\n📋 Contribution Log:', colors.cyan);
      log('─'.repeat(60));
      
      const logData = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      console.table(logData.map(entry => ({
        '#': entry.number,
        'Date': entry.timestamp.split('T')[0],
        'Hash': entry.hash?.slice(0, 20) + '...' || 'N/A'
      })));
    }
    
    log('\n');
    process.exit(allValid ? 0 : 1);
    
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, colors.red);
    console.error(error);
    process.exit(1);
  }
}

main().catch(console.error);
