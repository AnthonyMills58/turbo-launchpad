import type { Metadata } from 'next'
import { Comic_Neue } from 'next/font/google'
import './globals.css'

import { Web3Providers } from '@/components/providers'
import NavBarWrapper from '@/components/ui/NavBarWrapper'
import { FiltersProvider } from '@/lib/FiltersContext'
import { SyncProvider } from '@/lib/SyncContext' // ✅ NEW

const comicNeue = Comic_Neue({
  variable: '--font-comic-neue',
  subsets: ['latin'],
  weight: ['300', '400', '700'],
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
        className={`${comicNeue.variable} antialiased bg-transparent text-white min-h-screen`}
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










