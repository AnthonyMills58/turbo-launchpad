import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

import { Web3Providers } from '@/components/providers'
import NavBarWrapper from '@/components/ui/NavBarWrapper'
import { FiltersProvider } from '@/lib/FiltersContext' // ✅ NEW

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
          <FiltersProvider> {/* ✅ Wrap everything below */}
            <NavBarWrapper />
            <main>{children}</main>
          </FiltersProvider>
        </Web3Providers>
      </body>
    </html>
  )
}









