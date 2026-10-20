import { useEffect } from 'react'
import { useApp, useSel } from './context'

export function ToastHost() {
  const { ctl } = useApp()
  const toast = useSel((s) => s.toast)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => ctl.dismissToast(), toast.kind === 'error' ? 8000 : 5000)
    return () => clearTimeout(timer)
  }, [toast, ctl])
  if (!toast) return null
  return (
    <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} onClick={() => ctl.dismissToast()}>
      {toast.text}
    </div>
  )
}
