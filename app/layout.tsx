import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

import { Web3Providers } from '@/components/providers'
import NavBarWrapper from '@/components/ui/NavBarWrapper'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Turbo Launch',
  description: 'Create and trade bonding curve tokens',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0d0f1a] text-white min-h-screen`}
      >
        <Web3Providers>
          <NavBarWrapper />
          <main className="a">{children}</main>
        </Web3Providers>
      </body>
    </html>
  )
}








