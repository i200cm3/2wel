import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { fetchProjects, fetchTemplates } from '@/lib/api'

export function LegacyEditorRedirect() {
  const [to, setTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { projects } = await fetchProjects()
        const project = projects[0]
        if (!project) {
          if (!cancelled) setError('Нет проектов')
          return
        }
        const { templates } = await fetchTemplates(project.code)
        const template = templates.find((item) => item.isDefault) ?? templates[0]
        if (!template) {
          if (!cancelled) setError('Нет шаблонов')
          return
        }
        if (!cancelled) {
          setTo(`/app/projects/${project.code}/templates/${template.code}/edit`)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось открыть конструктор')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="app boot home-gate">
        <p>{error}</p>
      </div>
    )
  }
  if (!to) return <div className="app boot">Загрузка…</div>
  return <Navigate to={to} replace />
}
