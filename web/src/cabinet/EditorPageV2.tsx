import { useEffect } from 'react'
import { Link, Navigate, useOutletContext, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { ConstructorV2 } from '@/components/ConstructorV2'
import { Button } from '@/components/ui/button'
import { fetchTemplates } from '@/lib/api'
import { useTemplateEditor } from '@/hooks/useTemplateEditor'
import { constructorForPlan, editorPathForPlan } from '@/lib/plans'

export function EditorPageV2() {
  const { user, project } = useOutletContext<CabinetOutlet>()
  const { code, templateCode } = useParams()
  const projectCode = code?.trim() ?? ''
  const tplCode = templateCode?.trim() ?? ''
  const planId = project?.plan?.id
  const {
    config,
    ready,
    loadError,
    hasDraft,
    saveState,
    publishState,
    saveError,
    publishError,
    draftError,
    updateConfig,
    save,
    publish,
    resetConfig,
    retryDraft,
  } = useTemplateEditor(projectCode, tplCode)

  useEffect(() => {
    document.documentElement.classList.add('cabinet-editor')
    return () => document.documentElement.classList.remove('cabinet-editor')
  }, [])

  useEffect(() => {
    if (!projectCode) return
    void fetchTemplates(projectCode).catch(() => undefined)
  }, [projectCode])

  if (project && projectCode && tplCode && constructorForPlan(planId) !== 'v2') {
    return <Navigate to={editorPathForPlan(planId, projectCode, tplCode)} replace />
  }

  if (!projectCode || !tplCode) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-center text-sm">
        Не указан шаблон
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-sm">
        Загрузка…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-destructive text-sm">{loadError}</p>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to={`/app/projects/${projectCode}/templates`} />}
        >
          К шаблонам
        </Button>
      </div>
    )
  }

  return (
    <ConstructorV2
      config={config}
      onChange={updateConfig}
      onReset={resetConfig}
      hasDraft={hasDraft}
      saveState={saveState}
      publishState={publishState}
      saveError={saveError}
      publishError={publishError}
      draftError={draftError}
      projectCode={projectCode}
      templateCode={tplCode}
      isAdmin={user.isAdmin}
      onSave={() => {
        void save().then((result) => {
          if (result) toast.success('Опубликовано — гости и CRM видят эту версию')
        })
      }}
      onPublish={() => void publish()}
      onRetryDraft={() => retryDraft()}
    />
  )
}
