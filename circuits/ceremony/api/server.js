/**
 * Whistle Ceremony - Contribution Upload API
 * 
 * Handles automatic contribution uploads and tracking
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3006;

// Configuration
const CONTRIBUTIONS_DIR = process.env.CONTRIBUTIONS_DIR || '/var/www/ceremony-whistle/contributions';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'ceremony.db');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max
const CIRCUIT_NAME = 'withdraw_merkle';

// Initialize database
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER UNIQUE NOT NULL,
    filename TEXT NOT NULL,
    hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS ceremony_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Initialize config if not exists
const initConfig = db.prepare('INSERT OR IGNORE INTO ceremony_config (key, value) VALUES (?, ?)');
initConfig.run('status', 'Active');
initConfig.run('goal', '100');
initConfig.run('started', new Date().toISOString().split('T')[0]);

// Ensure contributions directory exists
if (!fs.existsSync(CONTRIBUTIONS_DIR)) {
  fs.mkdirSync(CONTRIBUTIONS_DIR, { recursive: true });
}

// Middleware
app.use(cors({
  origin: ['https://ceremony.whistle.ninja', 'http://localhost:3000', 'http://localhost:3001'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, '/tmp');
  },
  filename: (req, file, cb) => {
    cb(null, `upload_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.zkey`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.zkey')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zkey files are allowed'));
    }
  }
});

// Get current stats
function getStats() {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM contributions').get();
  const latestRow = db.prepare('SELECT MAX(number) as latest FROM contributions').get();
  const configRows = db.prepare('SELECT key, value FROM ceremony_config').all();
  
  const config = {};
  configRows.forEach(row => config[row.key] = row.value);
  
  return {
    count: countRow.count,
    latest: latestRow.latest || 0,
    status: config.status || 'Active',
    goal: parseInt(config.goal) || 100,
    started: config.started,
    circuit: CIRCUIT_NAME
  };
}

// Update static stats.json file
function updateStatsFile() {
  const stats = getStats();
  const statsPath = path.join(CONTRIBUTIONS_DIR, 'stats.json');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  
  // Also update latest.json
  if (stats.latest > 0) {
    const latestRow = db.prepare('SELECT * FROM contributions WHERE number = ?').get(stats.latest);
    if (latestRow) {
      const latestPath = path.join(CONTRIBUTIONS_DIR, 'latest.json');
      fs.writeFileSync(latestPath, JSON.stringify({
        number: latestRow.number,
        filename: latestRow.filename,
        hash: latestRow.hash,
        timestamp: latestRow.created_at
      }, null, 2));
    }
  }
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get ceremony stats
app.get('/stats', (req, res) => {
  res.json(getStats());
});

// Get all contributions
app.get('/contributions', (req, res) => {
  const contributions = db.prepare(`
    SELECT number, filename, hash, size, created_at 
    FROM contributions 
    ORDER BY number DESC
  `).all();
  res.json(contributions);
});

// Get latest contribution info
app.get('/latest', (req, res) => {
  const stats = getStats();
  if (stats.latest === 0) {
    res.json({
      number: 0,
      filename: `${CIRCUIT_NAME}_0000.zkey`,
      hash: 'genesis',
      timestamp: stats.started
    });
  } else {
    const latest = db.prepare('SELECT * FROM contributions WHERE number = ?').get(stats.latest);
    res.json({
      number: latest.number,
      filename: latest.filename,
      hash: latest.hash,
      timestamp: latest.created_at
    });
  }
});

// Upload contribution
app.post('/upload', upload.single('contribution'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { contributionHash } = req.body;
    if (!contributionHash) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Contribution hash is required' });
    }

    // Get next contribution number
    const stats = getStats();
    const nextNumber = stats.latest + 1;
    const filename = `${CIRCUIT_NAME}_${String(nextNumber).padStart(4, '0')}.zkey`;
    const destPath = path.join(CONTRIBUTIONS_DIR, filename);

    // Calculate file hash for verification
    const fileBuffer = fs.readFileSync(req.file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Move file to contributions directory
    fs.renameSync(req.file.path, destPath);

    // Record in database
    const insert = db.prepare(`
      INSERT INTO contributions (number, filename, hash, size, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    insert.run(
      nextNumber,
      filename,
      contributionHash || fileHash,
      fileBuffer.length,
      req.ip || req.connection.remoteAddress,
      req.get('User-Agent') || 'Unknown'
    );

    // Update stats files
    updateStatsFile();

    console.log(`✅ Contribution #${nextNumber} received: ${filename}`);

    res.json({
      success: true,
      number: nextNumber,
      filename,
      hash: contributionHash,
      message: `Contribution #${nextNumber} received successfully!`
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up temp file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Verify a contribution exists
app.get('/verify/:number', (req, res) => {
  const number = parseInt(req.params.number);
  const contribution = db.prepare('SELECT * FROM contributions WHERE number = ?').get(number);
  
  if (contribution) {
    const filePath = path.join(CONTRIBUTIONS_DIR, contribution.filename);
    const fileExists = fs.existsSync(filePath);
    
    res.json({
      exists: true,
      fileExists,
      ...contribution
    });
  } else {
    res.json({ exists: false });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('═'.repeat(50));
  console.log('  WHISTLE CEREMONY - Upload API');
  console.log('═'.repeat(50));
  console.log(`  Port: ${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
  console.log(`  Contributions: ${CONTRIBUTIONS_DIR}`);
  console.log('');
  console.log('  Endpoints:');
  console.log('    GET  /health        - Health check');
  console.log('    GET  /stats         - Ceremony statistics');
  console.log('    GET  /latest        - Latest contribution');
  console.log('    GET  /contributions - All contributions');
  console.log('    POST /upload        - Upload contribution');
  console.log('═'.repeat(50));
  console.log('');
  
  // Initialize stats file
  updateStatsFile();
});

module.exports = app;
