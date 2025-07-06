// validateTokenForm.ts
export interface TokenForm {
  name: string
  symbol: string   // 🆕 Add this line
  description: string
  image: string
  twitter: string
  telegram: string
  website: string
  supply: number
  raiseTarget: number
  dex: string
  curveType: string
}

export function validateTokenForm(form: TokenForm, proMode: boolean): string | null {
  if (form.name.length < 3 || form.name.length > 32)
    return 'Token name must be between 3 and 32 characters.'

  if (!/^[a-zA-Z0-9\- ]+$/.test(form.name))
    return 'Token name can only include letters, numbers, spaces, and dashes.'

  if (!form.description || form.description.length > 256)
    return 'Description is required and must be under 256 characters.'

  if (form.image && !isValidUrl(form.image))
    return 'Image URL must be a valid link.'

  if (form.twitter && !/^https:\/\/twitter\.com\/[A-Za-z0-9_]{1,15}$/.test(form.twitter))
    return 'Twitter link must be a valid https://twitter.com/username link.'

  if (form.telegram && !/^https:\/\/t\.me\/[A-Za-z0-9_]{3,32}$/.test(form.telegram))
    return 'Telegram link must be a valid https://t.me/username link.'

  if (form.website && !/^https?:\/\/[^\s]+$/.test(form.website))
    return 'Website must start with http:// or https:// and be a valid URL.'

  if (proMode && Number(form.supply) < 1000)
    return 'Total supply must be at least 1,000.'

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
