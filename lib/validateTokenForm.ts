// validateTokenForm.ts
export interface TokenForm {
  name: string
  description: string
  image: string
  twitter: string
  telegram: string
  supply: number
  raiseTarget: number
  dex: string
  curveType: string
}

export function validateTokenForm(form: TokenForm, proMode: boolean): string | null {
  if (form.name.length < 3 || form.name.length > 32) return 'Token name must be between 3 and 32 characters.'
  if (!/^[a-zA-Z0-9\- ]+$/.test(form.name)) return 'Token name can only include letters, numbers, spaces, and dashes.'
  if (!form.description || form.description.length > 256) return 'Description is required and must be under 256 characters.'
  if (form.image && !isValidUrl(form.image)) return 'Image URL must be a valid link.'
  if (form.twitter && (!form.twitter.startsWith('https://') || !form.twitter.includes('twitter.com'))) return 'Twitter link must start with https:// and contain twitter.com'
  if (form.telegram && (!form.telegram.startsWith('https://') || !form.telegram.includes('t.me'))) return 'Telegram link must start with https:// and contain t.me'
  if (proMode && Number(form.supply) < 1000) return 'Total supply must be at least 1,000.'
  return null
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}
