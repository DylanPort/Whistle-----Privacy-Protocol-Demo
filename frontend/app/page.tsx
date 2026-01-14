'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Shield, Unlock, Activity, Eye, EyeOff, Github } from 'lucide-react'
import ShieldPanel from '@/components/ShieldPanel'
import UnshieldPanel from '@/components/UnshieldPanel'
import NotesPanel from '@/components/NotesPanel'
import PoolStats from '@/components/PoolStats'
import Image from 'next/image'

type Tab = 'shield' | 'unshield' | 'notes'

export default function Home() {
  const { connected } = useWallet()
  const [activeTab, setActiveTab] = useState<Tab>('shield')
  const [showPrivacy, setShowPrivacy] = useState(true)
  const [mounted, setMounted] = useState(false)

  // Fix hydration issues with wallet adapter
  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <main className="min-h-screen relative">
      {/* Manga speedlines background */}
      <div className="manga-speedlines" />
      
      {/* Subtle grid overlay */}
      <div 
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
          opacity: 0.3,
        }}
      />

      {/* Radial gradient for depth */}
      <div 
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background: `
            radial-gradient(circle at 50% 50%, transparent 0%, rgba(0, 0, 0, 0.5) 100%),
            radial-gradient(circle at 20% 80%, rgba(255, 255, 255, 0.02) 0%, transparent 40%)
          `,
        }}
      />

      {/* Devnet Testing Banner */}
      <div className="relative z-50 bg-white/5 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white">TESTING ON DEVNET</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-400">This is a demo for Solana Privacy Hackathon</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-gray-400">
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Step 1:</span>
                <span>Switch wallet to Devnet</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Step 2:</span>
                <a 
                  href="https://faucet.solana.com/" 
                  target="_blank" 
                  className="text-white hover:underline"
                >
                  Get free SOL from faucet
                </a>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Step 3:</span>
                <span>Shield and unshield SOL</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="relative z-50 border-b border-white/10 backdrop-blur-xl sticky top-0 bg-black/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Image 
              src="/logo.png" 
              alt="Whistle" 
              width={48} 
              height={48}
              className="rounded-xl"
            />
            <div>
              <h1 className="text-xl font-bold tracking-[0.2em] uppercase">WHISTLE</h1>
              <p className="text-[10px] text-gray-500 font-mono tracking-widest">PRIVACY PROTOCOL</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Hackathon Badge */}
            <div className="hackathon-badge flex items-center gap-1">
              SOLANA PRIVACY HACK
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 border border-white/20">
              <div className="status-dot status-active" />
              <span className="text-xs font-mono text-gray-400">DEVNET</span>
            </div>
            {mounted && <WalletMultiButton />}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      {!connected && (
        <section className="relative z-10 py-20 px-6">
          <div className="max-w-4xl mx-auto text-center">
            {/* Logo large */}
            <div className="mb-8 flex justify-center">
              <Image 
                src="/logo.png" 
                alt="Whistle" 
                width={120} 
                height={120}
                className="rounded-2xl shadow-2xl shadow-white/5"
              />
            </div>
            
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/50 border border-white/20 mb-8">
              <Eye className="w-4 h-4 text-white" />
              <span className="text-sm font-mono">Zero-Knowledge Privacy on Solana</span>
            </div>
            
            <h2 className="text-5xl md:text-7xl font-bold mb-6 leading-tight tracking-tight">
              YOUR TRANSACTIONS,
              <br />
              <span className="neon-glow">
                COMPLETELY PRIVATE
              </span>
            </h2>
            
            <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
              Shield your SOL with zero-knowledge proofs. Deposit any amount, 
              withdraw in fixed denominations. <span className="text-white font-semibold">No one can trace your transactions.</span>
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-4">
              {mounted && <WalletMultiButton />}
            </div>
            
            <a 
              href="https://github.com/DylanPort/Whistle-----Privacy-Protocol-Demo" 
              target="_blank"
              className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors text-sm"
            >
              <Github className="w-4 h-4" />
              View Source Code
            </a>

            {/* Features */}
            <div className="grid md:grid-cols-3 gap-6 mt-20">
              <div className="panel animated-border">
                <Shield className="w-10 h-10 text-white mb-4" />
                <h3 className="text-lg font-bold mb-2 tracking-wide">SHIELD SOL</h3>
                <p className="text-sm text-gray-400">
                  Deposit any amount into the privacy pool. Your funds become untraceable.
                </p>
              </div>
              <div className="panel animated-border">
                <Eye className="w-10 h-10 text-gray-400 mb-4" />
                <h3 className="text-lg font-bold mb-2 tracking-wide">ZK PROOFS</h3>
                <p className="text-sm text-gray-400">
                  Groth16 proofs verify ownership without revealing your identity.
                </p>
              </div>
              <div className="panel animated-border">
                <Unlock className="w-10 h-10 text-white mb-4" />
                <h3 className="text-lg font-bold mb-2 tracking-wide">UNSHIELD</h3>
                <p className="text-sm text-gray-400">
                  Withdraw to any address. Break the link between deposit and withdrawal.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main App */}
      {connected && (
        <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
          {/* Stats */}
          <PoolStats />

          {/* Tab Navigation */}
          <div className="flex gap-2 mb-6 p-1.5 bg-black/50 rounded-xl border border-white/10 w-fit backdrop-blur-lg">
            <button
              onClick={() => setActiveTab('shield')}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm tracking-wide transition-all ${
                activeTab === 'shield'
                  ? 'bg-white text-black'
                  : 'text-gray-500 hover:text-white'
              }`}
            >
              <Shield className="w-4 h-4" />
              SHIELD
            </button>
            <button
              onClick={() => setActiveTab('unshield')}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm tracking-wide transition-all ${
                activeTab === 'unshield'
                  ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white'
                  : 'text-gray-500 hover:text-white'
              }`}
            >
              <Unlock className="w-4 h-4" />
              UNSHIELD
            </button>
            <button
              onClick={() => setActiveTab('notes')}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm tracking-wide transition-all ${
                activeTab === 'notes'
                  ? 'bg-black border border-white text-white'
                  : 'text-gray-500 hover:text-white'
              }`}
            >
              <Activity className="w-4 h-4" />
              MY NOTES
            </button>
          </div>

          {/* Content Panels */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              {activeTab === 'shield' && <ShieldPanel />}
              {activeTab === 'unshield' && <UnshieldPanel />}
              {activeTab === 'notes' && <NotesPanel />}
            </div>
            
            {/* Privacy Toggle */}
            <div className="panel h-fit">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold tracking-wide">PRIVACY MODE</h3>
                <button
                  onClick={() => setShowPrivacy(!showPrivacy)}
                  className="p-2 rounded-lg bg-black/50 border border-white/10 hover:border-white/30 transition-colors"
                >
                  {showPrivacy ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
              
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Shielded Balance</span>
                  <span className="font-mono">
                    {showPrivacy ? '•••••' : '0.00'} SOL
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Active Notes</span>
                  <span className="font-mono">
                    {showPrivacy ? '•' : '0'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Pending Proofs</span>
                  <span className="font-mono">0</span>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-white/10">
                <p className="text-xs text-gray-500">
                  Your shielded notes are stored locally in your browser. 
                  Back them up to avoid losing access to your funds.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 mt-20 bg-black/30 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Image 
                src="/logo.png" 
                alt="Whistle" 
                width={32} 
                height={32}
                className="rounded-lg"
              />
              <span className="font-bold tracking-wide">WHISTLE PROTOCOL</span>
            </div>
            <div className="hackathon-badge">
              SOLANA PRIVACY HACKATHON 2026
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <a href="https://github.com/DylanPort/Whistle-----Privacy-Protocol-Demo" 
                 target="_blank" 
                 className="hover:text-white transition-colors flex items-center gap-2">
                <Github className="w-4 h-4" />
                GitHub
              </a>
              <a href="https://whistle.ninja" target="_blank" className="hover:text-white transition-colors">
                whistle.ninja
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}

