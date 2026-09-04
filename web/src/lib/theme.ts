const STORAGE_KEY = 'promo-theme'

export type ColorTheme = 'light' | 'dark'

export function getColorTheme(): ColorTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyColorTheme(theme: ColorTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
}

export function toggleColorTheme(): ColorTheme {
  const next: ColorTheme = getColorTheme() === 'dark' ? 'light' : 'dark'
  applyColorTheme(next)
  return next
}

export function initColorTheme() {
  applyColorTheme(getColorTheme())
}
