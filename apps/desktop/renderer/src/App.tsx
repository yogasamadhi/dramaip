import { Navigate, Route, Routes } from 'react-router-dom'
import { ProjectListPage } from '@/pages/ProjectListPage'
import { CreateProjectPage } from '@/pages/CreateProjectPage'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { CreateAdaptationPage } from '@/pages/CreateAdaptationPage'
import { AdaptationWorkspacePage } from '@/pages/AdaptationWorkspacePage'
import { ScriptWorkspacePage } from '@/pages/ScriptWorkspacePage'
import { ShotWorkspacePage } from '@/pages/ShotWorkspacePage'
import { VideoGenerationPage } from '@/pages/VideoGenerationPage'
import { VideoProviderSettingsPage } from '@/pages/VideoProviderSettingsPage'
import { ModelSettingsPage } from '@/pages/ModelSettingsPage'
import { WritingRoomPage } from '@/pages/WritingRoomPage'
import { AgentSettingsPage } from '@/pages/AgentSettingsPage'
import { TemplatePage } from '@/pages/TemplatePage'
import { GenrePresetPage } from '@/pages/GenrePresetPage'
import { UsageStatsPage } from '@/pages/UsageStatsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectListPage />} />
      <Route path="/projects/new" element={<CreateProjectPage />} />
      <Route path="/projects/:id/writing-room" element={<WritingRoomPage />} />
      <Route path="/projects/:id/*" element={<WorkspacePage />} />
      <Route path="/adaptations/new" element={<CreateAdaptationPage />} />
      <Route path="/adaptations/:id" element={<AdaptationWorkspacePage />} />
      <Route path="/adaptations/:id/scripts" element={<ScriptWorkspacePage />} />
      <Route path="/adaptations/:id/shots" element={<ShotWorkspacePage />} />
      <Route path="/adaptations/:id/video" element={<VideoGenerationPage />} />
      <Route path="/settings" element={<ModelSettingsPage />} />
      <Route path="/settings/video" element={<VideoProviderSettingsPage />} />
      <Route path="/settings/agents" element={<AgentSettingsPage />} />
      <Route path="/settings/usage" element={<UsageStatsPage />} />
      <Route path="/templates" element={<TemplatePage />} />
      <Route path="/genres" element={<GenrePresetPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
