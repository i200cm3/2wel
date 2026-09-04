import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/auth'

export type LibraryFolder = {
  id: string
  label: string
  srcs: string[]
}

export type LibraryManifest = {
  total: number
  folders: LibraryFolder[]
  items: { src: string; folder: string; name: string; mtime?: number }[]
}

const EMPTY: LibraryManifest = { total: 0, folders: [], items: [] }

async function fetchManifest(projectCode: string): Promise<LibraryManifest> {
  const res = await authFetch(`/api/projects/${encodeURIComponent(projectCode)}/media`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { ok?: boolean; manifest?: LibraryManifest }
  if (!data?.manifest) return EMPTY
  return data.manifest
}

export function useMediaLibrary(projectCode: string) {
  const [manifest, setManifest] = useState<LibraryManifest | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(
    async (next?: LibraryManifest) => {
      if (!projectCode) {
        setManifest(EMPTY)
        setError(null)
        return
      }
      try {
        const data = next ?? (await fetchManifest(projectCode))
        setManifest(data)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось загрузить библиотеку')
      }
    },
    [projectCode],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return { manifest, error, ready: Boolean(manifest) || Boolean(error), reload, setManifest }
}
