import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import WalletProviders from '@/components/WalletProviders'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Whistle Protocol - ZK Privacy on Solana',
  description: 'Anonymous SOL transactions using Zero-Knowledge proofs on Solana',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-black text-white antialiased`}>
        <WalletProviders>
          {children}
        </WalletProviders>
      </body>
    </html>
  )
}
