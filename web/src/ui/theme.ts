import { useEffect, useState } from 'react'

// Light-by-default theme. Persisted to localStorage, applied
// as a class on <html> so Tailwind's `dark:` variants + .dark CSS rules switch.
export type Theme = 'dark' | 'light'

const KEY = 'istio-dash-theme'

export function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY)
  return saved === 'dark' ? 'dark' : 'light' // default light
}

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(KEY, theme)
  }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}
