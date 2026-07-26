import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RootLayout } from '@/components/shell/RootLayout'

const ProjectListPage = lazy(() => import('@/pages/ProjectListPage').then((m) => ({ default: m.ProjectListPage })))
const CreateProjectPage = lazy(() => import('@/pages/CreateProjectPage').then((m) => ({ default: m.CreateProjectPage })))
const SearchPage = lazy(() => import('@/pages/SearchPage').then((m) => ({ default: m.SearchPage })))
const WorkspacePage = lazy(() => import('@/pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })))
const CreateAdaptationPage = lazy(() =>
  import('@/pages/CreateAdaptationPage').then((m) => ({ default: m.CreateAdaptationPage })),
)
const AdaptationWorkspacePage = lazy(() =>
  import('@/pages/AdaptationWorkspacePage').then((m) => ({ default: m.AdaptationWorkspacePage })),
)
const ScriptWorkspacePage = lazy(() =>
  import('@/pages/ScriptWorkspacePage').then((m) => ({ default: m.ScriptWorkspacePage })),
)
const ShotWorkspacePage = lazy(() => import('@/pages/ShotWorkspacePage').then((m) => ({ default: m.ShotWorkspacePage })))
const VideoGenerationPage = lazy(() =>
  import('@/pages/VideoGenerationPage').then((m) => ({ default: m.VideoGenerationPage })),
)
const VideoProviderSettingsPage = lazy(() =>
  import('@/pages/VideoProviderSettingsPage').then((m) => ({ default: m.VideoProviderSettingsPage })),
)
const ImageProviderSettingsPage = lazy(() =>
  import('@/pages/ImageProviderSettingsPage').then((m) => ({ default: m.ImageProviderSettingsPage })),
)
const TtsProviderSettingsPage = lazy(() =>
  import('@/pages/TtsProviderSettingsPage').then((m) => ({ default: m.TtsProviderSettingsPage })),
)
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const AppearanceSettingsPage = lazy(() =>
  import('@/pages/AppearanceSettingsPage').then((m) => ({ default: m.AppearanceSettingsPage })),
)
const ModelSettingsPage = lazy(() => import('@/pages/ModelSettingsPage').then((m) => ({ default: m.ModelSettingsPage })))
const DataSettingsPage = lazy(() => import('@/pages/DataSettingsPage').then((m) => ({ default: m.DataSettingsPage })))
const TaskMonitorPage = lazy(() => import('@/pages/TaskMonitorPage').then((m) => ({ default: m.TaskMonitorPage })))
const WritingRoomPage = lazy(() => import('@/pages/WritingRoomPage').then((m) => ({ default: m.WritingRoomPage })))
const ProjectSetupPage = lazy(() => import('@/pages/ProjectSetupPage').then((m) => ({ default: m.ProjectSetupPage })))
const AgentSettingsPage = lazy(() => import('@/pages/AgentSettingsPage').then((m) => ({ default: m.AgentSettingsPage })))
const TemplatePage = lazy(() => import('@/pages/TemplatePage').then((m) => ({ default: m.TemplatePage })))
const GenrePresetPage = lazy(() => import('@/pages/GenrePresetPage').then((m) => ({ default: m.GenrePresetPage })))
const UsageStatsPage = lazy(() => import('@/pages/UsageStatsPage').then((m) => ({ default: m.UsageStatsPage })))
const CaseStudyPage = lazy(() => import('@/pages/CaseStudyPage').then((m) => ({ default: m.CaseStudyPage })))
const AiDiagnosticsPage = lazy(() =>
  import('@/pages/AiDiagnosticsPage').then((m) => ({ default: m.AiDiagnosticsPage })),
)
const CloudAccountSettingsPage = lazy(() =>
  import('@/pages/CloudAccountSettingsPage').then((m) => ({ default: m.CloudAccountSettingsPage })),
)

export default function App() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中...</div>}>
      <Routes>
        <Route element={<RootLayout />}>
          <Route path="/" element={<ProjectListPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/projects/new" element={<CreateProjectPage />} />
          <Route path="/projects/:id/writing-room" element={<WritingRoomPage />} />
          <Route path="/projects/:id/setup" element={<ProjectSetupPage />} />
          <Route path="/projects/:id/*" element={<WorkspacePage />} />
          <Route path="/adaptations/new" element={<CreateAdaptationPage />} />
          <Route path="/adaptations/:id" element={<AdaptationWorkspacePage />} />
          <Route path="/adaptations/:id/scripts" element={<ScriptWorkspacePage />} />
          <Route path="/adaptations/:id/shots" element={<ShotWorkspacePage />} />
          <Route path="/adaptations/:id/video" element={<VideoGenerationPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/appearance" element={<AppearanceSettingsPage />} />
          <Route path="/settings/model" element={<Navigate to="/settings/models" replace />} />
          <Route path="/settings/models" element={<ModelSettingsPage />} />
          <Route path="/settings/data" element={<DataSettingsPage />} />
          <Route path="/settings/tasks" element={<TaskMonitorPage />} />
          <Route path="/settings/video" element={<VideoProviderSettingsPage />} />
          <Route path="/settings/images" element={<ImageProviderSettingsPage />} />
          <Route path="/settings/tts" element={<TtsProviderSettingsPage />} />
          <Route path="/settings/agents" element={<AgentSettingsPage />} />
          <Route path="/settings/usage" element={<UsageStatsPage />} />
          <Route path="/settings/diagnostics" element={<AiDiagnosticsPage />} />
          <Route path="/settings/cloud-account" element={<CloudAccountSettingsPage />} />
          <Route path="/templates" element={<TemplatePage />} />
          <Route path="/genres" element={<GenrePresetPage />} />
          <Route path="/case-studies" element={<CaseStudyPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
