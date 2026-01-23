#!/usr/bin/env node
/**
 * Whistle Protocol - Ceremony Contribution Script
 * 
 * This script allows anyone to contribute randomness to the trusted setup.
 * The more contributors, the more secure the system becomes.
 */

const snarkjs = require('snarkjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CIRCUIT_NAME = 'withdraw_merkle';
const CONTRIBUTIONS_DIR = path.join(__dirname, 'contributions');

// ANSI colors for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(msg, color = '') {
  console.log(`${color}${msg}${colors.reset}`);
}

function logStep(step, msg) {
  console.log(`\n${colors.cyan}[Step ${step}]${colors.reset} ${colors.bright}${msg}${colors.reset}`);
}

async function getLatestContribution() {
  if (!fs.existsSync(CONTRIBUTIONS_DIR)) {
    fs.mkdirSync(CONTRIBUTIONS_DIR, { recursive: true });
  }
  
  const files = fs.readdirSync(CONTRIBUTIONS_DIR)
    .filter(f => f.startsWith(`${CIRCUIT_NAME}_`) && f.endsWith('.zkey'))
    .sort();
  
  if (files.length === 0) {
    // Check for initial zkey
    const initialPath = path.join(__dirname, '..', 'build', 'production', CIRCUIT_NAME, `${CIRCUIT_NAME}_0000.zkey`);
    if (fs.existsSync(initialPath)) {
      return { path: initialPath, number: 0 };
    }
    throw new Error('No initial contribution found. Run the genesis setup first.');
  }
  
  const latest = files[files.length - 1];
  const match = latest.match(/_(\d+)\.zkey$/);
  const number = match ? parseInt(match[1]) : 0;
  
  return { path: path.join(CONTRIBUTIONS_DIR, latest), number };
}

async function collectKeyboardEntropy() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    log('\n🎲 ENTROPY COLLECTION - Keyboard', colors.magenta);
    log('━'.repeat(50));
    log('Type random characters for 30 seconds.');
    log('Mash your keyboard randomly - the more chaotic, the better!');
    log('Press ENTER when done (or wait for timeout).\n');
    
    let entropy = '';
    let startTime = Date.now();
    const timeout = 30000; // 30 seconds
    
    process.stdin.setRawMode(true);
    process.stdin.resume();
    
    const keyHandler = (key) => {
      // Ctrl+C to exit
      if (key === '\u0003') {
        process.exit();
      }
      
      // Enter to finish
      if (key === '\r' || key === '\n') {
        finish();
        return;
      }
      
      // Add keystroke with timing
      const timing = Date.now() - startTime;
      entropy += `${key}:${timing}|`;
      process.stdout.write('*');
    };
    
    process.stdin.on('data', keyHandler);
    
    const timer = setTimeout(finish, timeout);
    
    function finish() {
      clearTimeout(timer);
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', keyHandler);
      rl.close();
      
      // Hash the entropy to fixed size
      const hash = crypto.createHash('sha256').update(entropy).digest('hex');
      log(`\n\n✓ Collected ${entropy.length} bytes of keyboard entropy`, colors.green);
      resolve(hash);
    }
  });
}

async function collectSystemEntropy() {
  log('\n🖥️  ENTROPY COLLECTION - System', colors.magenta);
  log('━'.repeat(50));
  log('Collecting system entropy (CPU timing, memory state)...\n');
  
  const parts = [];
  
  // High-resolution timing
  for (let i = 0; i < 1000; i++) {
    const start = process.hrtime.bigint();
    // Do some variable work
    let x = 0;
    for (let j = 0; j < Math.random() * 1000; j++) {
      x += Math.random();
    }
    const end = process.hrtime.bigint();
    parts.push((end - start).toString());
  }
  
  // Memory state
  const memUsage = process.memoryUsage();
  parts.push(JSON.stringify(memUsage));
  
  // Current time with nanosecond precision
  parts.push(process.hrtime.bigint().toString());
  
  // Random bytes from OS
  parts.push(crypto.randomBytes(64).toString('hex'));
  
  // Process ID and uptime
  parts.push(`${process.pid}:${process.uptime()}`);
  
  const combined = parts.join('|');
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  
  log(`✓ Collected ${combined.length} bytes of system entropy`, colors.green);
  return hash;
}

async function generateContributionEntropy(keyboardEntropy, systemEntropy) {
  // Combine all entropy sources
  const combined = `${keyboardEntropy}|${systemEntropy}|${Date.now()}|${crypto.randomBytes(32).toString('hex')}`;
  
  // Create a strong entropy string for snarkjs
  // snarkjs expects a string that it will hash internally
  return combined;
}

async function main() {
  console.clear();
  log('═'.repeat(60), colors.cyan);
  log('   WHISTLE PROTOCOL - TRUSTED SETUP CEREMONY', colors.bright);
  log('═'.repeat(60), colors.cyan);
  log('\nThank you for contributing to the security of Whistle Protocol!');
  log('Your contribution makes the ZK privacy pool trustless.\n');
  
  try {
    // Step 1: Find latest contribution
    logStep(1, 'Finding latest contribution...');
    const latest = await getLatestContribution();
    log(`Found contribution #${latest.number}: ${path.basename(latest.path)}`, colors.green);
    
    const nextNumber = latest.number + 1;
    const nextPath = path.join(CONTRIBUTIONS_DIR, `${CIRCUIT_NAME}_${String(nextNumber).padStart(4, '0')}.zkey`);
    
    // Step 2: Collect entropy
    logStep(2, 'Collecting randomness (entropy)...');
    
    const keyboardEntropy = await collectKeyboardEntropy();
    const systemEntropy = await collectSystemEntropy();
    const contributionEntropy = await generateContributionEntropy(keyboardEntropy, systemEntropy);
    
    // Step 3: Generate contribution
    logStep(3, 'Generating contribution (this may take a few minutes)...');
    log('\n⏳ Processing... Do not close this window.\n', colors.yellow);
    
    const startTime = Date.now();
    
    // Run the actual contribution
    const contributionHash = await snarkjs.zKey.contribute(
      latest.path,
      nextPath,
      `Whistle Contributor #${nextNumber}`,
      contributionEntropy
    );
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Step 4: Success!
    logStep(4, 'Contribution complete!');
    
    log('\n' + '═'.repeat(60), colors.green);
    log('   ✅ CONTRIBUTION SUCCESSFUL!', colors.bright + colors.green);
    log('═'.repeat(60), colors.green);
    
    log(`\n📁 Output file: ${nextPath}`, colors.cyan);
    log(`⏱️  Duration: ${duration} seconds`);
    log(`🔐 Contribution hash:`, colors.yellow);
    log(`   ${contributionHash}`, colors.bright);
    
    log('\n' + '─'.repeat(60));
    log('IMPORTANT - SECURITY STEPS:', colors.yellow + colors.bright);
    log('─'.repeat(60));
    log('1. ✅ Your random entropy has been mixed into the ceremony');
    log('2. 🗑️  Delete any notes or records of your random input');
    log('3. 📤 Upload your contribution: npm run upload');
    log('4. 🔍 Verify your contribution: npm run verify');
    log('─'.repeat(60));
    
    log('\n🎉 Thank you for making Whistle Protocol more secure!\n', colors.magenta);
    
    // Log contribution details
    const logEntry = {
      number: nextNumber,
      timestamp: new Date().toISOString(),
      hash: contributionHash,
      inputFile: path.basename(latest.path),
      outputFile: path.basename(nextPath),
    };
    
    const logPath = path.join(CONTRIBUTIONS_DIR, 'contribution_log.json');
    let log_data = [];
    if (fs.existsSync(logPath)) {
      log_data = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
    log_data.push(logEntry);
    fs.writeFileSync(logPath, JSON.stringify(log_data, null, 2));
    
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, colors.yellow);
    console.error(error);
    process.exit(1);
  }
}

main().catch(console.error);
