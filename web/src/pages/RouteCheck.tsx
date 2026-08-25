import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'
import { checkRoute, type RouteMatchResult } from '../api/routematch'
import { Icon } from '../components/icons'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

// 요청이 어느 라우팅 룰에 매치되어 어디로 가는지 설정으로 계산해 보여준다.
// 실제 요청을 보내지 않으므로 부작용이 없다.
export function RouteCheck() {
  const [host, setHost] = useState('')
  const [path, setPath] = useState('/')
  const [method, setMethod] = useState('GET')
  const [headers, setHeaders] = useState([{ key: '', value: '' }])
  const [result, setResult] = useState<RouteMatchResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const setHeader = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setHeaders((prev) => prev.map((h, j) => (i === j ? { ...h, ...patch } : h)))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!host.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      setResult(await checkRoute({ host: host.trim(), path, method, headers }))
    } catch (err) {
      setResult(null)
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-strong">경로 확인</h2>
        <p className="mt-1 text-sm text-muted">
          요청이 어느 VirtualService·HTTPRoute 룰에 매치되어 어디로 가는지 설정으로 계산합니다. 실제 요청은 보내지 않습니다.
        </p>
      </div>

      <form onSubmit={submit} className="panel space-y-3 rounded-xl p-5">
        <div className="flex flex-wrap gap-2">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="input-base !w-28 shrink-0">
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="호스트 (예: shop.example.com)"
            autoComplete="off"
            className="input-base min-w-0 flex-1"
          />
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/경로?쿼리=값"
            autoComplete="off"
            className="input-base min-w-0 flex-1"
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">헤더 (카나리 라우팅 확인용)</p>
          {headers.map((h, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={h.key}
                onChange={(e) => setHeader(i, { key: e.target.value })}
                placeholder="이름 (예: x-user)"
                autoComplete="off"
                className="input-base min-w-0 flex-1"
              />
              <input
                value={h.value}
                onChange={(e) => setHeader(i, { value: e.target.value })}
                placeholder="값 (예: beta)"
                autoComplete="off"
                className="input-base min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={() => setHeaders((prev) => (prev.length === 1 ? [{ key: '', value: '' }] : prev.filter((_, j) => j !== i)))}
                className="btn-ghost shrink-0 px-2.5"
                title="헤더 삭제"
              >
                −
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setHeaders((prev) => [...prev, { key: '', value: '' }])} className="text-xs text-accent hover:underline">
            + 헤더 추가
          </button>
        </div>

        <button type="submit" disabled={!host.trim() || busy} className="btn-primary disabled:opacity-50">
          {busy ? '계산 중…' : '경로 확인'}
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>

      {result && <Result result={result} />}
    </div>
  )
}

function Result({ result }: { result: RouteMatchResult }) {
  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${result.matched
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-amber-500/30 bg-amber-500/5'}`}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon name={result.matched ? 'check' : 'warning'} className={`h-4 w-4 ${result.matched ? 'text-emerald-500' : 'text-amber-500'}`} />
          {result.matched ? '매치되는 라우트를 찾았습니다' : '매치되는 라우트가 없습니다'}
        </div>

        {result.destinations.length > 0 && (
          <div className="mt-3 space-y-2">
            {result.destinations.map((d, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm dark:bg-slate-900/60">
                <span className="font-medium text-strong">
                  {d.host}{d.port ? <span className="font-normal text-muted">:{d.port}</span> : null}
                </span>
                {d.subset && (
                  <span className={`chip ${d.subsetOk === false
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'bg-accent-soft text-accent'}`}>
                    subset {d.subset}{d.subsetOk === false ? ' · DR에 정의 없음' : ''}
                  </span>
                )}
                {d.weight ? <span className="chip bg-gray-500/10 text-gray-500 dark:text-slate-400">weight {d.weight}</span> : null}
                {d.external ? (
                  <span className="chip bg-gray-500/10 text-gray-500 dark:text-slate-400">외부 호스트</span>
                ) : d.exists ? (
                  <span className={`chip ${d.endpoints > 0
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                    엔드포인트 {d.endpoints}
                  </span>
                ) : (
                  <span className="chip bg-red-500/10 text-red-600 dark:text-red-400">서비스 없음</span>
                )}
              </div>
            ))}
          </div>
        )}

        {result.notes?.map((n, i) => <p key={i} className="mt-2 text-xs text-muted">· {n}</p>)}
      </div>

      <div className="panel rounded-xl p-5">
        <h3 className="mb-3 text-sm font-semibold text-strong">평가 과정</h3>
        {result.candidates.length === 0 ? (
          <p className="text-sm text-muted">이 호스트를 다루는 라우트가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {result.candidates.map((c, i) => (
              <li key={i} className={`rounded-lg border p-3 text-sm ${c.winner
                ? 'border-accent bg-accent-soft'
                : c.matched ? 'border-base' : 'border-base opacity-70'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${c.matched ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-gray-500/10 text-gray-500 dark:text-slate-400'}`}>
                    {c.matched ? '매치' : '불매치'}
                  </span>
                  <Link to={`/resources/${c.typeId}/${c.namespace}/${c.name}`} className="font-medium text-strong hover:text-accent">
                    {c.kind} · {c.namespace}/{c.name}
                  </Link>
                  <span className="text-xs text-muted">rule[{c.ruleIndex}]</span>
                  {c.winner && <span className="chip bg-accent text-white">선택됨</span>}
                </div>
                <p className="mt-1 text-xs text-muted">{c.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
