import type { Category } from '../api/resourceTypes'
import { accentFor } from '../ui/categories'

export function KindBadge({ kind, category }: { kind: string; category?: Category }) {
  const a = accentFor(category)
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${a.badge}`}>{kind}</span>
  )
}
