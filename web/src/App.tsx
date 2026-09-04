import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { IntegrationsPage } from '@/cabinet/IntegrationsPage'
import { CabinetLayout, RequireAuth } from '@/cabinet/CabinetLayout'
import { EditorPage } from '@/cabinet/EditorPage'
import { EditorPageV2 } from '@/cabinet/EditorPageV2'
import { LegacyEditorRedirect } from '@/cabinet/LegacyEditorRedirect'
import { LinksPage } from '@/cabinet/LinksPage'
import { LoginPage } from '@/cabinet/LoginPage'
import { RegisterPage } from '@/cabinet/RegisterPage'
import { ForgotPage } from '@/cabinet/ForgotPage'
import { ResetPage } from '@/cabinet/ResetPage'
import { AccountPage } from '@/cabinet/AccountPage'
import { AdminUsersPage } from '@/cabinet/AdminUsersPage'
import { AdminTtsUsagePage } from '@/cabinet/AdminTtsUsagePage'
import { AppIndex, OverviewPage } from '@/cabinet/OverviewPage'
import { PlanPage } from '@/cabinet/PlanPage'
import { TemplatesPage } from '@/cabinet/TemplatesPage'
import { VoicePage } from '@/cabinet/VoicePage'
import { PlayerLoading } from '@/components/PlayerLoading'
import { Presentation } from '@/components/Presentation'
import { shareIdFromPath, usePropertyConfig } from '@/hooks/usePropertyConfig'
import { OfferPage } from '@/marketing/OfferPage'
import './App.css'

function PlayerPage() {
  const { config, guestNameFromShare, ready, loadError, shareId } = usePropertyConfig('player')

  if (!ready) {
    return <PlayerLoading label="Открываем презентацию" value={null} />
  }
  if (loadError) {
    return (
      <div className="app boot home-gate">
        <p>{loadError}</p>
      </div>
    )
  }
  return <Presentation property={config} guestNameOverride={guestNameFromShare ?? undefined} publicId={shareId} />
}

function HomePage() {
  if (new URLSearchParams(window.location.search).get('property')) {
    return <PlayerPage />
  }
  return <OfferPage />
}

function ShareOrNotFound() {
  const id = shareIdFromPath()
  if (id) return <PlayerPage />
  return <Navigate to="/" replace />
}

function ApiToIntegrations() {
  const { code } = useParams()
  const { search } = useLocation()
  return <Navigate to={`/app/projects/${code}/integrations${search}`} replace />
}

function HashLegacyRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    const hash = window.location.hash
    if (hash.startsWith('#/editor')) {
      navigate(`/editor${window.location.search}`, { replace: true })
    }
  }, [navigate])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <HashLegacyRedirect />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot" element={<ForgotPage />} />
        <Route path="/reset" element={<ResetPage />} />
        <Route
          path="/editor/*"
          element={
            <RequireAuth>
              <LegacyEditorRedirect />
            </RequireAuth>
          }
        />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <CabinetLayout />
            </RequireAuth>
          }
        >
          <Route index element={<AppIndex />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="users/:userId" element={<AdminUsersPage />} />
          <Route path="tts-usage" element={<AdminTtsUsagePage />} />
          <Route path="projects/:code" element={<OverviewPage />} />
          <Route path="projects/:code/templates" element={<TemplatesPage />} />
          <Route path="projects/:code/templates/:templateCode/edit" element={<EditorPage />} />
          <Route path="projects/:code/templates/:templateCode/edit-v2" element={<EditorPageV2 />} />
          <Route path="projects/:code/links" element={<LinksPage />} />
          <Route path="projects/:code/api" element={<ApiToIntegrations />} />
          <Route path="projects/:code/integrations" element={<IntegrationsPage />} />
          <Route path="projects/:code/voice" element={<VoicePage />} />
          <Route path="projects/:code/plan" element={<PlanPage />} />
        </Route>
        <Route path="/" element={<HomePage />} />
        <Route path="/:shareId" element={<ShareOrNotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
