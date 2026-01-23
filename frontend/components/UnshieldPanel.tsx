'use client'

import { useState, useEffect, useCallback } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { 
  PublicKey, 
  LAMPORTS_PER_SOL, 
  Transaction, 
  TransactionInstruction,
  SystemProgram 
} from '@solana/web3.js'
import { Unlock, Loader2, CheckCircle, AlertCircle, ExternalLink, Trash2, Shield, Zap } from 'lucide-react'
import { generateWithdrawProof, computeNoteHashes, type ZKProofInput } from '@/lib/zkProof'

interface Note {
  secret: string
  nullifier: string
  amount: string
  commitment: string
  nullifierHash: string
  createdAt: number
  txSignature?: string
  leafIndex?: number
  spent: boolean
}

const POOL_PROGRAM_ID = new PublicKey('AMtxCTW99zCBfhukVdN8YvA3AsdSJ7nsgnUdHpth7QTD')
// Relayer URL - auto-detect production vs development
const RELAYER_URL = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? `${window.location.protocol}//${window.location.hostname}/privacy-api`  // Production (nginx proxy)
  : 'http://localhost:3005'                                                  // Development

const DENOMINATIONS = [
  { value: 0.01, label: '0.01 SOL', lamports: 10_000_000 },
  { value: 0.05, label: '0.05 SOL', lamports: 50_000_000 },
  { value: 0.1, label: '0.1 SOL', lamports: 100_000_000 },
]

export default function UnshieldPanel() {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [selectedDenom, setSelectedDenom] = useState<number | null>(null)
  const [recipient, setRecipient] = useState('')
  const [useZKProof, setUseZKProof] = useState(true)
  const [relayerStatus, setRelayerStatus] = useState<'unknown' | 'online' | 'offline'>('unknown')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'generating' | 'proving' | 'submitting' | 'success' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [txSignature, setTxSignature] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  // Load notes from localStorage
  useEffect(() => {
    const storedNotes = JSON.parse(localStorage.getItem('whistle_notes') || '[]')
    setNotes(storedNotes.filter((n: Note) => !n.spent))
  }, [])

  // Check relayer status
  useEffect(() => {
    const checkRelayer = async () => {
      try {
        const res = await fetch(`${RELAYER_URL}/health`)
        if (res.ok) {
          setRelayerStatus('online')
        } else {
          setRelayerStatus('offline')
        }
      } catch {
        setRelayerStatus('offline')
      }
    }
    checkRelayer()
    const interval = setInterval(checkRelayer, 30000)
    return () => clearInterval(interval)
  }, [])

  // ZK Proof withdrawal via relayer
  const handleZKWithdraw = useCallback(async () => {
    if (!selectedNote || !recipient || !selectedDenom) return

    setLoading(true)
    setStatus('generating')
    setProgress(0)
    setProgressText('Preparing...')
    setErrorMsg('')

    try {
      // Validate recipient
      let recipientPubkey: PublicKey
      try {
        recipientPubkey = new PublicKey(recipient)
      } catch {
        throw new Error('Invalid recipient address')
      }

      console.log('🔒 Starting ZK PROOF withdrawal...')
      
      setStatus('proving')
      setProgressText('Generating ZK proof...')
      setProgress(20)

      // Parse note secrets
      const secret = BigInt(selectedNote.secret)
      const nullifier = BigInt(selectedNote.nullifier)
      const noteAmount = BigInt(selectedNote.amount)

      // Recompute hashes to verify
      const { commitment, nullifierHash } = await computeNoteHashes(secret, nullifier, noteAmount)
      
      console.log('Note commitment:', commitment.toString().slice(0, 20) + '...')

      // Generate ZK proof
      // Circuit requires: noteAmount === withdrawAmount + relayerFee
      const relayerFeeLamports = BigInt(0) // No fee for now
      const withdrawAmountLamports = noteAmount - relayerFeeLamports // Full withdrawal
      
      const proofInput: ZKProofInput = {
        secret,
        nullifier,
        noteAmount,
        commitment,
        nullifierHash,
        recipient: recipientPubkey.toBytes(),
        withdrawAmount: withdrawAmountLamports,
        relayerFee: relayerFeeLamports,
        // Include merkle proof data
        leafIndex: selectedNote.leafIndex,
        connection: connection,
      }

      const zkProof = await generateWithdrawProof(proofInput, (stage, pct) => {
        setProgressText(stage)
        setProgress(20 + pct * 0.5) // 20-70%
      })

      console.log('✅ ZK proof generated!')
      
      setStatus('submitting')
      setProgressText('Sending to relayer...')
      setProgress(75)

      // Send to relayer with full ZK proof (production uses merkle root instead of commitment)
      const response = await fetch(`${RELAYER_URL}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proof_a: Array.from(zkProof.proof_a),
          proof_b: Array.from(zkProof.proof_b),
          proof_c: Array.from(zkProof.proof_c),
          merkleRoot: Array.from(zkProof.merkleRoot),
          nullifierHash: Array.from(zkProof.nullifierHash),
          recipient: recipientPubkey.toBase58(),
          amount: Number(zkProof.amount),
          fee: Number(zkProof.fee),
        }),
      })

      const result = await response.json()
      
      if (!response.ok) {
        throw new Error(result.error || 'Relayer error')
      }

      setProgress(100)
      setProgressText('Complete!')
      setStatus('success')
      setTxSignature(result.signature)

      console.log('🎉 ZK withdrawal successful!')
      console.log('TX:', result.signature)

      // Mark note as spent
      const updatedNotes = notes.map(n => 
        n.commitment === selectedNote.commitment 
          ? { ...n, spent: true }
          : n
      )
      localStorage.setItem('whistle_notes', JSON.stringify(updatedNotes))
      setNotes(updatedNotes.filter(n => !n.spent))
      setSelectedNote(null)
      setSelectedDenom(null)

    } catch (error: any) {
      console.error('ZK withdraw error:', error)
      setErrorMsg(error.message || 'Withdrawal failed')
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }, [selectedNote, recipient, selectedDenom, notes])

  // Demo withdrawal via relayer (no ZK proof)
  const handleDemoWithdraw = useCallback(async () => {
    if (!selectedNote || !recipient || !selectedDenom) return

    setLoading(true)
    setStatus('submitting')
    setProgress(0)
    setProgressText('Sending to relayer...')
    setErrorMsg('')

    try {
      let recipientPubkey: PublicKey
      try {
        recipientPubkey = new PublicKey(recipient)
      } catch {
        throw new Error('Invalid recipient address')
      }

      setProgress(40)

      const response = await fetch(`${RELAYER_URL}/demo-withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: recipientPubkey.toBase58(),
          amount: selectedDenom,
        }),
      })

      const result = await response.json()
      
      if (!response.ok) {
        throw new Error(result.error || 'Relayer error')
      }

      setProgress(100)
      setStatus('success')
      setTxSignature(result.signature)

      // Mark note as spent
      const updatedNotes = notes.map(n => 
        n.commitment === selectedNote.commitment ? { ...n, spent: true } : n
      )
      localStorage.setItem('whistle_notes', JSON.stringify(updatedNotes))
      setNotes(updatedNotes.filter(n => !n.spent))
      setSelectedNote(null)
      setSelectedDenom(null)

    } catch (error: any) {
      console.error('Demo withdraw error:', error)
      setErrorMsg(error.message || 'Withdrawal failed')
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }, [selectedNote, recipient, selectedDenom, notes])

  const handleWithdraw = useZKProof ? handleZKWithdraw : handleDemoWithdraw

  const deleteNote = (commitment: string) => {
    if (confirm('Delete this note? You will lose access to the funds.')) {
      const updatedNotes = notes.filter(n => n.commitment !== commitment)
      localStorage.setItem('whistle_notes', JSON.stringify(updatedNotes))
      setNotes(updatedNotes)
      if (selectedNote?.commitment === commitment) setSelectedNote(null)
    }
  }

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  const availableDenoms = selectedNote 
    ? DENOMINATIONS.filter(d => d.lamports <= parseInt(selectedNote.amount))
    : []

  return (
    <div className="panel">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
          <Unlock className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Private Withdrawal</h2>
          <p className="text-sm text-gray-500">ZK proof verified on-chain</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* ZK Mode Toggle */}
        <div className="p-4 rounded-xl bg-black/30 border border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${useZKProof ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
              <div>
                <p className="font-medium">{useZKProof ? '🔐 Full ZK Mode' : '⚡ Demo Mode'}</p>
                <p className="text-xs text-gray-500">
                  {useZKProof 
                    ? 'Real ZK proof generated & verified on-chain' 
                    : 'Quick demo - relayer submits without proof'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setUseZKProof(!useZKProof)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                useZKProof 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                  : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
              }`}
            >
              {useZKProof ? 'ZK PROOF' : 'DEMO'}
            </button>
          </div>
          
          <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${relayerStatus === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-500">
              Relayer: {relayerStatus === 'online' ? 'Online' : relayerStatus === 'offline' ? 'Offline' : 'Checking...'}
            </span>
          </div>
        </div>

        {/* Notes Selection */}
        <div>
          <label className="block text-sm text-gray-500 mb-2">Select Note</label>
          {notes.length === 0 ? (
            <div className="p-6 rounded-xl bg-black/30 border border-white/10 text-center">
              <p className="text-gray-400">No shielded notes</p>
              <p className="text-xs text-gray-500 mt-1">Shield SOL first</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {notes.map((note) => (
                <div
                  key={note.commitment}
                  onClick={() => { setSelectedNote(note); setSelectedDenom(null); }}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    selectedNote?.commitment === note.commitment
                      ? 'bg-purple-500/10 border-purple-500'
                      : 'bg-black/30 border-white/10 hover:border-purple-500/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono">
                        {(parseFloat(note.amount) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                      </p>
                      <p className="text-xs text-gray-500">{formatDate(note.createdAt)}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteNote(note.commitment); }}
                      className="p-2 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedNote && (
          <>
            {/* Denomination Selection */}
            <div>
              <label className="block text-sm text-gray-500 mb-2">Withdrawal Amount</label>
              <div className="flex flex-wrap gap-2">
                {availableDenoms.map((denom) => (
                  <button
                    key={denom.lamports}
                    onClick={() => setSelectedDenom(denom.lamports)}
                    className={`px-4 py-2 rounded-lg border font-mono transition-all ${
                      selectedDenom === denom.lamports
                        ? 'bg-purple-500 text-white border-purple-500'
                        : 'bg-black/30 border-white/10 hover:border-purple-500'
                    }`}
                  >
                    {denom.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Recipient */}
            <div>
              <label className="block text-sm text-gray-500 mb-2">
                Recipient Address 
                <span className="text-green-400 ml-2">(Use a fresh wallet!)</span>
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Enter any Solana address"
                className="input-field text-sm"
                disabled={loading}
              />
              <p className="text-xs text-gray-500 mt-1">
                This address receives the SOL. No connection needed.
              </p>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleWithdraw}
              disabled={loading || !selectedNote || !recipient || !selectedDenom || relayerStatus !== 'online'}
              className={`w-full py-3 px-6 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                useZKProof 
                  ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white' 
                  : 'bg-yellow-600 hover:bg-yellow-500 text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {progressText || 'Processing...'}
                </>
              ) : (
                <>
                  {useZKProof ? <Shield className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                  {useZKProof ? 'Withdraw with ZK Proof' : 'Quick Demo Withdraw'}
                </>
              )}
            </button>
          </>
        )}

        {/* Progress */}
        {loading && (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{progressText}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-black/30 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all ${useZKProof ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-yellow-500'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Success */}
        {status === 'success' && (
          <div className="mt-4 p-4 rounded-xl bg-green-500/10 border border-green-500/30">
            <div className="flex items-center gap-2 text-green-500 mb-2">
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">
                {useZKProof ? '🔐 ZK Withdrawal Complete!' : '⚡ Demo Withdrawal Complete!'}
              </span>
            </div>
            {txSignature && (
              <a 
                href={`https://solscan.io/tx/${txSignature}?cluster=devnet`}
                target="_blank"
                className="text-sm font-mono text-green-400 hover:underline flex items-center gap-1"
              >
                View on Solscan <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <p className="text-xs text-gray-400 mt-2">
              {useZKProof 
                ? '✅ ZK proof verified on-chain - maximum privacy!' 
                : '✅ Transaction submitted by relayer'}
            </p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 text-red-500">
              <AlertCircle className="w-5 h-5" />
              <span className="font-semibold">Error</span>
            </div>
            <p className="text-sm text-gray-400 mt-2">{errorMsg}</p>
          </div>
        )}

        {/* ZK Info */}
        {useZKProof && (
          <div className="p-4 rounded-xl bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20">
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2 text-green-400">
              <Shield className="w-4 h-4" />
              How ZK Proof Works
            </h4>
            <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
              <li>Browser generates cryptographic proof (~3 sec)</li>
              <li>Proof sent to relayer (you stay anonymous)</li>
              <li>Relayer submits to blockchain</li>
              <li>Contract verifies proof on-chain</li>
              <li>Funds sent to recipient</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}
