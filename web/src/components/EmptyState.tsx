import type { ReactNode } from 'react'
import { Icon } from './icons'

export function EmptyState({
  icon = 'cube',
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="mt-4 text-sm font-semibold text-strong">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs leading-6 text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
