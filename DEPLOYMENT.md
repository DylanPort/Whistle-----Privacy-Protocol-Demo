# Whistle Protocol - Deployment Guide

## Prerequisites
- Node.js 18+
- PM2 (for process management)

## 1. Frontend Deployment

### Build (already done)
```bash
cd whistle-protocol/frontend
npm run build
```

### Deploy to server
Copy these folders to your server:
- `frontend/.next/` - Built app
- `frontend/public/` - Static assets (including circuits)
- `frontend/package.json`
- `frontend/next.config.js`

### On Server
```bash
cd /path/to/frontend
npm install --production
pm2 start npm --name "whistle-frontend" -- start -- -p 3000
```

## 2. Relayer Deployment

### On Server
```bash
cd /path/to/relayer
npm install
pm2 start npm --name "whistle-relayer" -- run start
```

### Environment Variables (Relayer)
Create `relayer/.env`:
```
PORT=3005
RPC_URL=https://api.devnet.solana.com
```

## 3. Nginx Configuration

```nginx
# Frontend
server {
    listen 80;
    server_name privacy.whistle.ninja;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Relayer API
server {
    listen 80;
    server_name whistle-relayer.whistle.ninja;
    
    location / {
        proxy_pass http://localhost:3005;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # CORS headers
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type' always;
    }
}
```

## 4. Update Frontend Config

Before building, set the relayer URL in `components/UnshieldPanel.tsx`:
```typescript
const RELAYER_URL = 'https://whistle-relayer.whistle.ninja'
```

## 5. Fund Relayer Wallet

The relayer needs SOL to pay transaction fees:
```bash
# Get relayer address from startup logs
solana airdrop 2 <RELAYER_ADDRESS> --url devnet
```

## Files to Upload

### Frontend
```
frontend/
├── .next/           # Build output
├── public/
│   └── circuits/    # ZK circuit files (IMPORTANT)
├── package.json
├── next.config.js
└── node_modules/    # Or run npm install on server
```

### Relayer
```
relayer/
├── src/
├── package.json
├── tsconfig.json
└── relayer-keypair.json  # Relayer wallet (KEEP SECURE)
```

