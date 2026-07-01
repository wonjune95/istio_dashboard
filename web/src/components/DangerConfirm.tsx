import { useState } from 'react'

// Typed-confirmation modal for high-risk kinds (Gemini review ⑦): the user must
// type the resource name to proceed.
export function DangerConfirm({
  name,
  action,
  onConfirm,
  onCancel,
}: {
  name: string
  action: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const ok = typed === name

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="panel w-96 rounded-lg p-5 shadow-xl">
        <h3 className="mb-2 text-base font-semibold text-red-600 dark:text-red-400">고위험 리소스 {action}</h3>
        <p className="mb-3 text-sm text-muted">
          이 리소스는 오타 하나로 메시 전체에 영향을 줄 수 있습니다. 계속하려면 리소스 이름
          <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-slate-800">{name}</code>을 입력하세요.
        </p>
        <input
          autoFocus
          className="input-base mb-4"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={name}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost text-sm">취소</button>
          <button
            onClick={onConfirm}
            disabled={!ok}
            className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-40"
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  )
}
