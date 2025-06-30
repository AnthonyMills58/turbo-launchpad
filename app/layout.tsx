import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

import { Web3Providers } from '@/components/providers'
import NavBar from '@/components/ui/NavBar' // ✅ Make sure this path matches your project

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
  <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
    <Web3Providers>
      <NavBar />
      <main className="a">{children}</main>
    </Web3Providers>
  </body>
</html>

  )
}




