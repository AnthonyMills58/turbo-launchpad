import type { Metadata } from 'next'
import { Roboto, Roboto_Mono } from 'next/font/google'
import './globals.css'

import { Web3Providers } from '@/components/providers'
import NavBarWrapper from '@/components/ui/NavBarWrapper'
import { FiltersProvider } from '@/lib/FiltersContext'
import { SyncProvider } from '@/lib/SyncContext' // ✅ NEW

const roboto = Roboto({
  variable: '--font-roboto',
  subsets: ['latin', 'cyrillic'],
  weight: ['300', '400', '500', '600', '700'],
})

const robotoMono = Roboto_Mono({
  variable: '--font-roboto-mono',
  subsets: ['latin', 'cyrillic'],
  weight: ['300', '400', '500', '600', '700'],
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
        className={`${roboto.variable} ${robotoMono.variable} antialiased bg-transparent text-white min-h-screen`}
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










