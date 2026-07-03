import type { AgentProfile, ProjectAgentScheme, ProjectSkill } from '@sdns/core'
import { selectProjectSkillsForTask } from '@sdns/core'

export interface WritingRoomAgentContext {
  id: string
  name: string
  role: string
  systemPrompt: string
}

function orderAgentIds(agentIds: string[], primaryAgentId?: string): string[] {
  const unique = [...new Set(agentIds)]
  if (!primaryAgentId || !unique.includes(primaryAgentId)) return unique
  return [primaryAgentId, ...unique.filter((id) => id !== primaryAgentId)]
}

export function selectWritingRoomAgents(
  allAgents: AgentProfile[],
  explicitAgentIds?: string[],
  scheme?: ProjectAgentScheme,
): { agents: WritingRoomAgentContext[]; primaryAgent?: WritingRoomAgentContext } {
  const schemeAgentIds = scheme?.agentIds ?? []
  const defaultAgentIds = schemeAgentIds.length
    ? schemeAgentIds
    : allAgents.filter((agent) => agent.enabled).map((agent) => agent.id)
  const wanted = orderAgentIds(explicitAgentIds?.length ? explicitAgentIds : defaultAgentIds, scheme?.primaryAgentId)
  const agentOrder = new Map(wanted.map((agentId, index) => [agentId, index]))
  const agents = allAgents
    .filter((agent) => wanted.includes(agent.id))
    .sort((a, b) => (agentOrder.get(a.id) ?? 999) - (agentOrder.get(b.id) ?? 999))
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      systemPrompt: agent.systemPrompt,
    }))
  const primaryAgent = scheme?.primaryAgentId ? agents.find((agent) => agent.id === scheme.primaryAgentId) : undefined
  return { agents, primaryAgent }
}

export function selectWritingRoomProjectSkills(
  allProjectSkills: ProjectSkill[],
  enabledProjectSkills: ProjectSkill[],
  scheme?: ProjectAgentScheme,
): ProjectSkill[] {
  if (scheme?.skillIds.length) {
    const skillIds = new Set(scheme.skillIds)
    return allProjectSkills.filter((skill) => skill.enabled && skillIds.has(skill.id))
  }
  return selectProjectSkillsForTask(enabledProjectSkills, 'writing_room_review')
}
