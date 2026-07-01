import type { Category } from '../api/resourceTypes'

// Per-category accent colors (Gemini: visual anchoring). Full literal class
// strings (incl. dark: variants) so Tailwind's JIT scanner picks them up — never
// build these by string interpolation or airgap builds drop the styles.
export interface Accent {
  text: string
  bg: string
  border: string
  dot: string
  badge: string
}

export const ACCENT: Record<Category, Accent> = {
  'gateway-api': {
    text: 'text-cyan-700 dark:text-cyan-400',
    bg: 'bg-cyan-50 dark:bg-cyan-500/10',
    border: 'border-cyan-200 dark:border-cyan-500/20',
    dot: 'bg-cyan-500',
    badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  },
  traffic: {
    text: 'text-blue-700 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    border: 'border-blue-200 dark:border-blue-500/20',
    dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  },
  security: {
    text: 'text-emerald-700 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    border: 'border-emerald-200 dark:border-emerald-500/20',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  telemetry: {
    text: 'text-slate-600 dark:text-slate-400',
    bg: 'bg-slate-100 dark:bg-slate-500/10',
    border: 'border-slate-200 dark:border-slate-500/20',
    dot: 'bg-slate-500',
    badge: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  },
}

export const CATEGORY_ORDER: Category[] = ['gateway-api', 'traffic', 'security', 'telemetry']

export const CATEGORY_ICON: Record<Category, string> = {
  'gateway-api': 'grid',
  traffic: 'bolt',
  security: 'shield',
  telemetry: 'chart',
}

export function accentFor(cat?: Category): Accent {
  return (cat && ACCENT[cat]) || ACCENT.telemetry
}
