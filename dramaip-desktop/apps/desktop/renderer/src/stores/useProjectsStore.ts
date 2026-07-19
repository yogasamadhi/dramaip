import { create } from 'zustand'
import { ipc } from '@/lib/ipc'
import type { OptionalId, Project, ProjectHomeSummary } from '@sdns/core'

interface ProjectsState {
  projects: Project[]
  summaries: ProjectHomeSummary[]
  loading: boolean
  fetch: () => Promise<void>
  create: (data: OptionalId<Project> & { title: string; shortDramaType: string }) => Promise<Project>
  remove: (id: string) => Promise<void>
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  summaries: [],
  loading: false,
  fetch: async () => {
    set({ loading: true })
    try {
      const summaries = await ipc.project.listHomeSummaries()
      set({ summaries, projects: summaries.map((summary) => summary.project) })
    } finally {
      set({ loading: false })
    }
  },
  create: async (data) => {
    const project = await ipc.project.create(data)
    set({ projects: [project, ...get().projects] })
    return project
  },
  remove: async (id) => {
    await ipc.project.remove(id)
    set({
      projects: get().projects.filter((p) => p.id !== id),
      summaries: get().summaries.filter((summary) => summary.project.id !== id),
    })
  },
}))
