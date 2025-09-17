import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

import { Web3Providers } from '@/components/providers'
import NavBarWrapper from '@/components/ui/NavBarWrapper'
import { FiltersProvider } from '@/lib/FiltersContext'
import { SyncProvider } from '@/lib/SyncContext' // ✅ NEW

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
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
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-transparent text-white min-h-screen`}
      >
        <Web3Providers>
          <SyncProvider> {/* ✅ Wrap everything here */}
            <FiltersProvider>
              <NavBarWrapper />
              <main>{children}</main>
            </FiltersProvider>
          </SyncProvider>
        </Web3Providers>
      </body>
    </html>
  )
}










