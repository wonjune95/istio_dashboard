import { NavLink } from 'react-router-dom'
import { useResourceTypes, CATEGORY_LABELS, type ResourceType } from '../api/resourceTypes'
import { useResources } from '../api/resources'
import { CATEGORY_ORDER, CATEGORY_ICON, accentFor } from '../ui/categories'
import { useNamespace } from '../ui/namespace'
import { Icon } from './icons'

export function Sidebar() {
  const { data, isLoading } = useResourceTypes()
  const installed = (data ?? []).filter((t) => t.installed)

  const topLink = (extra = '') => ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 font-medium transition ${extra} ${
      isActive ? 'bg-accent-soft text-accent' : 'text-muted row-hover'
    }`

  return (
    <nav className="w-60 shrink-0 overflow-y-auto border-r border-base bg-white/60 px-2.5 py-3 text-sm backdrop-blur-md dark:bg-slate-950/80">
      <NavLink to="/" end className={topLink()}>
        <Icon name="home" className="h-4 w-4" /> 홈
      </NavLink>
      <NavLink to="/overview" className={topLink()}>
        <Icon name="grid" className="h-4 w-4" /> 전체 보기
      </NavLink>
      <NavLink to="/flowmap" className={topLink('mb-3')}>
        <Icon name="bolt" className="h-4 w-4" /> 트래픽 흐름
      </NavLink>

      {isLoading && <div className="px-2 text-xs text-faint">로딩 중…</div>}

      {CATEGORY_ORDER.map((cat) => {
        const items = installed.filter((t) => t.category === cat)
        if (items.length === 0) return null
        const accent = accentFor(cat)
        return (
          <div key={cat} className="mb-3">
            <div className={`mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide ${accent.text}`}>
              <Icon name={CATEGORY_ICON[cat]} className="h-3.5 w-3.5" />
              {CATEGORY_LABELS[cat]}
            </div>
            {items.map((t) => <KindLink key={t.typeId} t={t} accentText={accent.text} accentBg={accent.bg} />)}
          </div>
        )
      })}
    </nav>
  )
}

function KindLink({ t, accentText, accentBg }: { t: ResourceType; accentText: string; accentBg: string }) {
  const { ns } = useNamespace()
  const { data } = useResources(t.typeId, ns) // shares cache with the list page
  const count = data?.length

  return (
    <NavLink
      to={`/resources/${t.typeId}`}
      className={({ isActive }) =>
        `flex items-center justify-between rounded-md px-2.5 py-1 transition ${
          isActive ? `${accentBg} ${accentText} font-medium` : 'text-muted row-hover'
        }`
      }
    >
      <span className="flex items-center gap-1.5 truncate">
        {t.kind}
        {t.dangerous && <Icon name="warning" className="h-3.5 w-3.5 text-amber-500" />}
      </span>
      {count !== undefined && (
        <span className="ml-2 shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] tabular-nums text-faint dark:bg-slate-800">
          {count}
        </span>
      )}
    </NavLink>
  )
}
