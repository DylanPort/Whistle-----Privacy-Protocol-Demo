'use client'

import { useState, useCallback } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram, 
  LAMPORTS_PER_SOL 
} from '@solana/web3.js'
import { Shield, Loader2, CheckCircle, AlertCircle, Copy, ExternalLink } from 'lucide-react'
import { computeNoteHashes } from '@/lib/zkProof'

const POOL_PROGRAM_ID = new PublicKey('AMtxCTW99zCBfhukVdN8YvA3AsdSJ7nsgnUdHpth7QTD')
const MIN_DEPOSIT = 0.001

const SHIELD_DISCRIMINATOR = Buffer.from([220, 198, 253, 246, 231, 84, 147, 98])

function bigintToBytes32(n: bigint): Buffer {
  const hex = n.toString(16).padStart(64, '0')
  return Buffer.from(hex, 'hex')
}

function u64ToBuffer(n: number): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(Math.floor(n)))
  return buf
}

// Generate random field element (31 bytes to stay in BN254 field)
function generateRandomFieldElement(): bigint {
  const bytes = new Uint8Array(31)
  crypto.getRandomValues(bytes)
  return BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''))
}

export default function ShieldPanel() {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [txSignature, setTxSignature] = useState('')
  const [noteData, setNoteData] = useState<any>(null)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleShield = useCallback(async () => {
    if (!publicKey || !amount) return
    
    const amountNum = parseFloat(amount)
    if (amountNum < MIN_DEPOSIT) {
      alert(`Minimum deposit is ${MIN_DEPOSIT} SOL`)
      return
    }

    setLoading(true)
    setLoadingText('Generating note...')
    setStatus('idle')
    setErrorMsg('')

    try {
      // Generate random secret and nullifier
      const secret = generateRandomFieldElement()
      const nullifier = generateRandomFieldElement()
      const amountLamports = BigInt(Math.floor(amountNum * LAMPORTS_PER_SOL))
      
      setLoadingText('Computing Poseidon hashes...')
      
      // Compute commitment and nullifier hash using Poseidon
      const { commitment, nullifierHash } = await computeNoteHashes(secret, nullifier, amountLamports)
      
      const note = {
        secret: secret.toString(),
        nullifier: nullifier.toString(),
        amount: amountLamports.toString(),
        commitment: commitment.toString(),
        commitmentBytes: bigintToBytes32(commitment),
        nullifierHash: nullifierHash.toString(),
        createdAt: Date.now(),
      }
      
      setNoteData(note)
      setLoadingText('Building transaction...')

      const [pool] = PublicKey.findProgramAddressSync([Buffer.from('pool')], POOL_PROGRAM_ID)
      const [poolVault] = PublicKey.findProgramAddressSync([Buffer.from('vault')], POOL_PROGRAM_ID)
      const [merkleTree] = PublicKey.findProgramAddressSync([Buffer.from('merkle_tree')], POOL_PROGRAM_ID)
      const [rootsHistory] = PublicKey.findProgramAddressSync([Buffer.from('roots_history')], POOL_PROGRAM_ID)

      // Get current leaf index BEFORE the deposit
      let leafIndex = 0
      try {
        const poolAccountInfo = await connection.getAccountInfo(pool)
        if (poolAccountInfo) {
          // next_index is at offset 9 (after discriminator 8 + merkle_levels 1)
          leafIndex = Number(poolAccountInfo.data.readBigUInt64LE(9))
        }
      } catch (e) {
        console.log('Could not read leaf index, defaulting to 0')
      }

      const lamports = Math.floor(amountNum * LAMPORTS_PER_SOL)
      const data = Buffer.concat([
        SHIELD_DISCRIMINATOR,
        note.commitmentBytes,
        u64ToBuffer(lamports),
      ])

      const shieldIx = new TransactionInstruction({
        keys: [
          { pubkey: pool, isSigner: false, isWritable: true },
          { pubkey: merkleTree, isSigner: false, isWritable: true },
          { pubkey: rootsHistory, isSigner: false, isWritable: true },
          { pubkey: poolVault, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: POOL_PROGRAM_ID,
        data,
      })

      const transaction = new Transaction().add(shieldIx)
      
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey
      
      setLoadingText('Awaiting signature...')
      
      console.log('🔒 Shielding with Poseidon commitment')
      console.log('Commitment:', commitment.toString().slice(0, 20) + '...')
      
      const signature = await sendTransaction(transaction, connection, {
        skipPreflight: true,  // Skip preflight to avoid simulation errors
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })
      
      setLoadingText('Confirming on-chain...')
      console.log('TX submitted:', signature)
      await connection.confirmTransaction(signature, 'confirmed')
      
      setTxSignature(signature)
      setStatus('success')

      // Save note to localStorage (including leafIndex for merkle proof)
      const noteToStore = {
        secret: note.secret,
        nullifier: note.nullifier,
        amount: note.amount,
        commitment: note.commitment,
        nullifierHash: note.nullifierHash,
        createdAt: note.createdAt,
        txSignature: signature,
        leafIndex: leafIndex,  // Store leaf index for merkle proof generation
        spent: false,
      }
      
      try {
        // Clear any corrupted or oversized storage first
        const existingData = localStorage.getItem('whistle_notes')
        let storedNotes: any[] = []
        
        if (existingData) {
          try {
            storedNotes = JSON.parse(existingData)
            // Keep only unspent notes, max 10
            storedNotes = storedNotes.filter((n: any) => !n.spent).slice(-9)
          } catch {
            storedNotes = [] // Reset if corrupted
          }
        }
        
        storedNotes.push(noteToStore)
        localStorage.setItem('whistle_notes', JSON.stringify(storedNotes))
        console.log('✅ Note saved to localStorage')
      } catch (storageError) {
        console.error('⚠️ CRITICAL: Could not save note!', storageError)
        // Force clear and try one more time
        try {
          localStorage.removeItem('whistle_notes')
          localStorage.setItem('whistle_notes', JSON.stringify([noteToStore]))
          console.log('✅ Note saved after clearing storage')
        } catch {
          alert('⚠️ STORAGE FAILED! Copy your note NOW or funds will be lost!')
        }
      }
      
      console.log('✅ Shield complete!')

    } catch (error: any) {
      console.error('Shield error:', error)
      
      let errorMessage = error.message || 'Transaction failed'
      
      if (error.logs) {
        console.error('Transaction logs:', error.logs)
      }
      
      if (error.message?.includes('insufficient funds')) {
        errorMessage = 'Insufficient SOL balance.'
      } else if (error.message?.includes('User rejected')) {
        errorMessage = 'Transaction rejected.'
      } else if (error.message?.includes('Simulation failed')) {
        errorMessage = 'Simulation failed. Check contract state.'
      }
      
      setErrorMsg(errorMessage)
      setStatus('error')
    } finally {
      setLoading(false)
      setLoadingText('')
    }
  }, [publicKey, amount, connection, sendTransaction])

  const copyNote = () => {
    if (noteData) {
      const noteToCopy = {
        secret: noteData.secret,
        nullifier: noteData.nullifier,
        amount: noteData.amount,
        commitment: noteData.commitment,
        nullifierHash: noteData.nullifierHash,
      }
      navigator.clipboard.writeText(JSON.stringify(noteToCopy, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const quickAmounts = [0.01, 0.05, 0.1, 0.5, 1]

  return (
    <div className="panel">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-whistle-accent/20 flex items-center justify-center">
          <Shield className="w-5 h-5 text-whistle-accent" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Shield SOL</h2>
          <p className="text-sm text-whistle-muted">Deposit with Poseidon commitment</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-whistle-muted mb-2">Amount (SOL)</label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              step="0.001"
              min={MIN_DEPOSIT}
              className="input-field pr-16"
              disabled={loading}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-whistle-muted font-mono">
              SOL
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {quickAmounts.map((amt) => (
            <button
              key={amt}
              onClick={() => setAmount(amt.toString())}
              className="px-3 py-1.5 rounded-lg bg-whistle-bg border border-whistle-border 
                         text-sm font-mono hover:border-whistle-accent hover:text-whistle-accent 
                         transition-all"
            >
              {amt} SOL
            </button>
          ))}
        </div>

        <div className="p-4 rounded-xl bg-gradient-to-br from-green-500/5 to-emerald-500/5 border border-green-500/20">
          <h4 className="text-sm font-medium mb-2 text-green-400">🔐 ZK-Ready Shield</h4>
          <ul className="text-xs text-whistle-muted space-y-1">
            <li>• Uses Poseidon hash (ZK-friendly)</li>
            <li>• Commitment stored in on-chain Merkle tree</li>
            <li>• Withdraw later with cryptographic proof</li>
            <li>• No one can link deposit ↔ withdrawal</li>
          </ul>
        </div>

        <button
          onClick={handleShield}
          disabled={loading || !amount || parseFloat(amount) < MIN_DEPOSIT || !publicKey}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {loadingText || 'Processing...'}
            </>
          ) : (
            <>
              <Shield className="w-5 h-5" />
              Shield {amount || '0'} SOL
            </>
          )}
        </button>

        {status === 'success' && noteData && (
          <div className="mt-4 p-4 rounded-xl bg-whistle-accent/10 border border-whistle-accent/30">
            <div className="flex items-center gap-2 text-whistle-accent mb-3">
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">Successfully Shielded!</span>
            </div>
            
            <div className="space-y-3">
              <div>
                <p className="text-xs text-whistle-muted mb-1">Transaction</p>
                <a 
                  href={`https://solscan.io/tx/${txSignature}?cluster=devnet`}
                  target="_blank"
                  className="text-sm font-mono text-whistle-accent hover:underline flex items-center gap-1"
                >
                  {txSignature.slice(0, 20)}...
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="p-3 rounded-lg bg-whistle-bg border border-whistle-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-whistle-muted">Your Secret Note (ZK-Ready)</span>
                  <button
                    onClick={copyNote}
                    className="flex items-center gap-1 text-xs text-whistle-accent hover:underline"
                  >
                    <Copy className="w-3 h-3" />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="text-xs font-mono text-whistle-muted overflow-x-auto max-h-32 overflow-y-auto">
{JSON.stringify({
  secret: noteData.secret,
  nullifier: noteData.nullifier,
  amount: noteData.amount,
  commitment: noteData.commitment,
}, null, 2)}
                </pre>
              </div>

              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                <p className="text-xs text-yellow-500">
                  <strong>⚠️ SAVE THIS NOTE!</strong> You need it to withdraw. Lost note = lost funds.
                </p>
              </div>
              
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                <p className="text-xs text-green-400">
                  ✅ Note auto-saved locally. Go to "Unshield" tab to withdraw privately with ZK proof.
                </p>
              </div>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 text-red-500">
              <AlertCircle className="w-5 h-5" />
              <span className="font-semibold">Transaction Failed</span>
            </div>
            <p className="text-sm text-whistle-muted mt-2 whitespace-pre-wrap">
              {errorMsg || 'Please try again.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
