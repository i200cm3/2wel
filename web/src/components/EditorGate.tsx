import { useEffect, useState, type ReactNode } from 'react'
import { EditorLoginPage } from '@/components/EditorLoginPage'
import { editorSessionOk, loginEditor } from '@/lib/auth'

export function EditorGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void editorSessionOk().then((ok) => {
      if (cancelled) return
      setAuthed(ok)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) {
    return <div className="app boot">Загрузка…</div>
  }

  if (!authed) {
    return (
      <EditorLoginPage
        error={error}
        pending={pending}
        onLogin={(email, password) => {
          setPending(true)
          setError(null)
          void loginEditor(email, password)
            .then(() => setAuthed(true))
            .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось войти'))
            .finally(() => setPending(false))
        }}
      />
    )
  }

  return children
}
