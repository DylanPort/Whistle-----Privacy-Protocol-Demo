'use client'

import { useState, useEffect } from 'react'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { FileText, Trash2, Copy, CheckCircle, ExternalLink } from 'lucide-react'

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

export default function NotesPanel() {
  const [notes, setNotes] = useState<Note[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    const storedNotes = JSON.parse(localStorage.getItem('whistle_notes') || '[]')
    setNotes(storedNotes)
  }, [])

  const deleteNote = (commitment: string) => {
    if (confirm('Delete this note? You will lose access to the shielded funds.')) {
      const updatedNotes = notes.filter(n => n.commitment !== commitment)
      localStorage.setItem('whistle_notes', JSON.stringify(updatedNotes))
      setNotes(updatedNotes)
    }
  }

  const copyNote = (note: Note) => {
    const noteToCopy = {
      secret: note.secret,
      nullifier: note.nullifier,
      amount: note.amount,
      commitment: note.commitment,
      nullifierHash: note.nullifierHash,
    }
    navigator.clipboard.writeText(JSON.stringify(noteToCopy, null, 2))
    setCopiedId(note.commitment)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  const activeNotes = notes.filter(n => !n.spent)
  const spentNotes = notes.filter(n => n.spent)

  return (
    <div className="panel">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
          <FileText className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold">My Notes</h2>
          <p className="text-sm text-gray-500">Your shielded notes stored locally</p>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No notes yet</p>
          <p className="text-sm text-gray-500 mt-1">Shield some SOL to create notes</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Notes */}
          {activeNotes.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-3">
                Active Notes ({activeNotes.length})
              </h3>
              <div className="space-y-3">
                {activeNotes.map((note) => (
                  <div
                    key={note.commitment}
                    className="p-4 rounded-xl bg-black/30 border border-white/10 hover:border-white/20 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-mono text-lg font-bold">
                          {(parseFloat(note.amount) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                        </p>
                        <p className="text-xs text-gray-500">{formatDate(note.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copyNote(note)}
                          className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                          title="Copy note"
                        >
                          {copiedId === note.commitment ? (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => deleteNote(note.commitment)}
                          className="p-2 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-500 transition-colors"
                          title="Delete note"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Commitment</span>
                        <span className="font-mono text-gray-400">
                          {note.commitment.slice(0, 12)}...{note.commitment.slice(-8)}
                        </span>
                      </div>
                      {note.leafIndex !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Leaf Index</span>
                          <span className="font-mono text-gray-400">{note.leafIndex}</span>
                        </div>
                      )}
                      {note.txSignature && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">TX</span>
                          <a
                            href={`https://solscan.io/tx/${note.txSignature}?cluster=devnet`}
                            target="_blank"
                            className="text-green-400 hover:underline flex items-center gap-1"
                          >
                            View <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spent Notes */}
          {spentNotes.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-3">
                Spent Notes ({spentNotes.length})
              </h3>
              <div className="space-y-2 opacity-50">
                {spentNotes.map((note) => (
                  <div
                    key={note.commitment}
                    className="p-3 rounded-xl bg-black/20 border border-white/5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono text-sm line-through">
                          {(parseFloat(note.amount) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                        </p>
                        <p className="text-xs text-gray-600">{formatDate(note.createdAt)}</p>
                      </div>
                      <span className="text-xs text-gray-500 px-2 py-1 rounded bg-white/5">
                        SPENT
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-white/10">
        <p className="text-xs text-gray-500">
          Notes are stored in your browser's local storage. 
          <strong className="text-yellow-500"> Back them up</strong> to avoid losing access to funds.
        </p>
      </div>
    </div>
  )
}
