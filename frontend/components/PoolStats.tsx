'use client'

import { useState, useEffect } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { TrendingUp, Users, Lock, Activity, ExternalLink } from 'lucide-react'

const POOL_PROGRAM_ID = new PublicKey('6juimdEmwGPbDwV6WX9Jr3FcvKTKXb7oreb53RzBKbNu')

export default function PoolStats() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const [stats, setStats] = useState({
    poolBalance: 0,
    userBalance: 0,
    totalNotes: 0,
    vaultAddress: '',
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [poolVault] = PublicKey.findProgramAddressSync(
          [Buffer.from('vault')],
          POOL_PROGRAM_ID
        )
        
        const vaultBalance = await connection.getBalance(poolVault)
        
        let userBalance = 0
        if (publicKey) {
          userBalance = await connection.getBalance(publicKey)
        }

        const notes = JSON.parse(localStorage.getItem('whistle_notes') || '[]')
        const activeNotes = notes.filter((n: any) => !n.spent).length

        setStats({
          poolBalance: vaultBalance / LAMPORTS_PER_SOL,
          userBalance: userBalance / LAMPORTS_PER_SOL,
          totalNotes: activeNotes,
          vaultAddress: poolVault.toBase58(),
        })
      } catch (error) {
        console.error('Error fetching stats:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }, [connection, publicKey])

  const statCards = [
    {
      label: 'Pool Balance',
      value: `${stats.poolBalance.toFixed(4)} SOL`,
      icon: Lock,
      color: 'text-white',
      bgColor: 'bg-white/10',
      link: stats.vaultAddress ? `https://solscan.io/account/${stats.vaultAddress}?cluster=devnet` : null,
    },
    {
      label: 'Your Balance',
      value: `${stats.userBalance.toFixed(4)} SOL`,
      icon: TrendingUp,
      color: 'text-white',
      bgColor: 'bg-white/10',
    },
    {
      label: 'Your Notes',
      value: stats.totalNotes.toString(),
      icon: Activity,
      color: 'text-white',
      bgColor: 'bg-white/10',
    },
    {
      label: 'Network',
      value: 'Devnet',
      icon: Users,
      color: 'text-white',
      bgColor: 'bg-white/10',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {statCards.map((stat) => (
        <div key={stat.label} className="panel p-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${stat.bgColor} flex items-center justify-center`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <div className="flex-1">
              <p className="text-xs text-whistle-muted">{stat.label}</p>
              <div className="flex items-center gap-1">
                <p className={`font-mono font-bold ${loading ? 'animate-pulse' : ''}`}>
                  {loading ? '...' : stat.value}
                </p>
                {stat.link && (
                  <a 
                    href={stat.link} 
                    target="_blank" 
                    className="text-whistle-muted hover:text-whistle-accent"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
