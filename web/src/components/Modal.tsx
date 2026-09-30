import { useEffect, useRef, type ReactNode } from 'react'

// Native dialog supplies a focus trap, focus restoration and Escape handling.
export function Modal({
  label,
  onCancel,
  busy = false,
  children,
}: {
  label: string
  onCancel: () => void
  busy?: boolean
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      aria-label={label}
      className="app-modal"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
    >
      {children}
    </dialog>
  )
}
