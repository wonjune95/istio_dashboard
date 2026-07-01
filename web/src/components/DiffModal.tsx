import { useState } from 'react'
import { diffLines } from 'diff'

// "kubectl diff"-style preview before applying: shows line-level changes between
// the current object and the dry-run result. For dangerous kinds, requires typing
// the resource name to confirm.
export function DiffModal({
  oldYaml,
  newYaml,
  name,
  dangerous,
  busy,
  title = '적용 미리보기',
  subtitle = '검증(dry-run) 통과 · 변경사항을 확인하세요',
  confirmLabel = '확인하고 적용',
  warn = false,
  onConfirm,
  onCancel,
}: {
  oldYaml: string
  newYaml: string
  name: string
  dangerous: boolean
  busy: boolean
  title?: string
  subtitle?: string
  confirmLabel?: string
  warn?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const parts = diffLines(oldYaml, newYaml)
  const noChange = parts.every((p) => !p.added && !p.removed)
  const confirmOk = (!dangerous || typed === name) && !busy

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="panel flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl shadow-xl">
        <div className="flex items-center justify-between border-b border-base px-5 py-3">
          <h3 className={`text-base font-semibold ${warn ? 'text-amber-600 dark:text-amber-400' : 'text-strong'}`}>{title}</h3>
          <span className="text-xs text-faint">{subtitle}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {noChange ? (
            <div className="py-8 text-center text-sm text-faint">변경사항이 없습니다.</div>
          ) : (
            <pre className="overflow-x-auto rounded-lg border border-base bg-slate-50 p-3 text-xs leading-5 dark:bg-slate-950">
              {parts.flatMap((p, pi) =>
                p.value.replace(/\n$/, '').split('\n').map((line, li) => {
                  const cls = p.added
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : p.removed
                      ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                      : 'text-muted'
                  const sign = p.added ? '+' : p.removed ? '-' : ' '
                  return (
                    <div key={`${pi}-${li}`} className={`whitespace-pre ${cls}`}>
                      <span className="select-none opacity-50">{sign} </span>
                      {line}
                    </div>
                  )
                }),
              )}
            </pre>
          )}
        </div>

        <div className="border-t border-base px-5 py-3">
          {dangerous && (
            <div className="mb-3">
              <p className="mb-1.5 text-xs text-red-600 dark:text-red-400">
                고위험 리소스입니다. 계속하려면 이름 <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{name}</code> 을 입력하세요.
              </p>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={name}
                className="input-base"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="btn-ghost text-sm">취소</button>
            <button
              onClick={onConfirm}
              disabled={!confirmOk}
              className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 ${dangerous || warn ? 'bg-red-600 hover:bg-red-700' : 'btn-primary'}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
