'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { apiClient } from '../lib/api-client'
import { formatApiError } from '../lib/api-error'
import { Button } from './ui/Button'

export function TeamManagement() {
  const queryClient = useQueryClient()
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: () => apiClient.getWorkspaces() })
  const [selectedID, setSelectedID] = useState('')
  const selected = useMemo(
    () => workspaces.data?.find((item) => item.id === selectedID) ?? workspaces.data?.[0],
    [selectedID, workspaces.data],
  )
  const members = useQuery({
    queryKey: ['workspace-members', selected?.id],
    queryFn: () => apiClient.getWorkspaceMembers(selected!.id),
    enabled: Boolean(selected?.id),
  })
  const invitations = useQuery({
    queryKey: ['workspace-invitations', selected?.id],
    queryFn: () => apiClient.getWorkspaceInvitations(selected!.id),
    enabled: Boolean(selected?.id && selected.currentUserRole !== 'member'),
  })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [inviteLink, setInviteLink] = useState('')
  const [acceptToken, setAcceptToken] = useState('')

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    await queryClient.invalidateQueries({ queryKey: ['workspace-members', selected?.id] })
    await queryClient.invalidateQueries({ queryKey: ['workspace-invitations', selected?.id] })
  }
  const invite = useMutation({
    mutationFn: () => apiClient.inviteWorkspaceMember({ workspaceId: selected!.id, email, role, expiresInHours: 72 }),
    onSuccess: async (result) => {
      setEmail('')
      setInviteLink(result.token ? `${window.location.origin}/account/team?invite=${encodeURIComponent(result.token)}` : '')
      await refresh()
    },
  })
  const updateRole = useMutation({
    mutationFn: (input: { memberId: string; role: 'admin' | 'member' }) => apiClient.updateWorkspaceMember({ workspaceId: selected!.id, memberId: input.memberId, role: input.role }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (memberId: string) => apiClient.removeWorkspaceMember({ workspaceId: selected!.id, memberId }),
    onSuccess: refresh,
  })
  const revoke = useMutation({
    mutationFn: (invitationId: string) => apiClient.revokeWorkspaceInvitation({ workspaceId: selected!.id, invitationId }),
    onSuccess: refresh,
  })
  const accept = useMutation({
    mutationFn: () => apiClient.acceptWorkspaceInvitation(acceptToken.trim()),
    onSuccess: async () => { setAcceptToken(''); await refresh() },
  })
  const mutationError = invite.error ?? updateRole.error ?? remove.error ?? revoke.error ?? accept.error

  if (workspaces.isLoading) return <p className="text-sm text-stone-600">正在加载工作区...</p>
  if (workspaces.error) return <ErrorMessage error={workspaces.error} fallback="无法加载工作区。" />

  return (
    <div className="space-y-6">
      <section className="grid gap-5 rounded-3xl border border-stone-200 bg-white p-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <label className="grid gap-2 text-sm font-medium text-stone-700">
            当前工作区
            <select className="h-11 rounded-xl border border-stone-300 bg-white px-3" value={selected?.id ?? ''} onChange={(event) => setSelectedID(event.target.value)}>
              {(workspaces.data ?? []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          </label>
        </div>
        {selected ? <div className="text-sm text-stone-600"><strong className="text-ink">{selected.activeMemberCount}/{selected.includedSeats}</strong> 席已用 · {selected.planCode}</div> : null}
      </section>

      {selected && selected.includedSeats <= 1 ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold text-amber-950">当前套餐仅包含 1 个席位</h2>
          <p className="mt-2 text-sm text-amber-900">升级到 Studio 可获得 5 个包含 owner 的团队席位；外部审片人不占席位。</p>
        </section>
      ) : null}

      {selected?.currentUserRole !== 'member' ? (
        <section className="rounded-3xl border border-stone-200 bg-white p-6">
          <h2 className="text-xl font-semibold text-ink">邀请成员</h2>
          <form className="mt-5 grid gap-3 sm:grid-cols-[1fr_150px_auto]" onSubmit={(event) => { event.preventDefault(); invite.mutate() }}>
            <input required type="email" maxLength={254} className="h-11 rounded-xl border border-stone-300 px-3 text-sm" placeholder="member@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
            <select className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'member')}>
              <option value="member">成员</option><option value="admin">管理员</option>
            </select>
            <Button disabled={invite.isPending || !selected || selected.activeMemberCount + selected.pendingInvitationCount >= selected.includedSeats}>创建邀请</Button>
          </form>
          {inviteLink ? (
            <div className="mt-4 rounded-xl bg-stone-100 p-4 text-sm">
              <p className="font-medium text-ink">一次性邀请链接（只显示这一次）</p>
              <p className="mt-2 break-all font-mono text-xs text-stone-600">{inviteLink}</p>
              <Button className="mt-3" variant="secondary" onClick={() => navigator.clipboard.writeText(inviteLink)}>复制链接</Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-3xl border border-stone-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-ink">成员</h2>
        {members.isLoading ? <p className="mt-4 text-sm text-stone-600">加载中...</p> : null}
        <div className="mt-4 divide-y divide-stone-100">
          {(members.data?.members ?? []).map((member) => (
            <div key={member.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{member.displayName || member.email}</p>
                <p className="truncate text-sm text-stone-500">{member.email}</p>
              </div>
              {member.role === 'owner' || selected?.currentUserRole === 'member' ? (
                <span className="text-sm text-stone-500">{roleLabel(member.role)}</span>
              ) : (
                <>
                  <select aria-label={`修改 ${member.email} 的角色`} className="h-9 rounded-lg border border-stone-300 bg-white px-2 text-sm" value={member.role} onChange={(event) => updateRole.mutate({ memberId: member.id, role: event.target.value as 'admin' | 'member' })}>
                    <option value="member">成员</option><option value="admin">管理员</option>
                  </select>
                  <Button variant="secondary" onClick={() => remove.mutate(member.id)} disabled={remove.isPending}>移除</Button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {selected?.currentUserRole !== 'member' && (invitations.data?.invitations.length ?? 0) > 0 ? (
        <section className="rounded-3xl border border-stone-200 bg-white p-6">
          <h2 className="text-xl font-semibold text-ink">待接受邀请</h2>
          <div className="mt-4 divide-y divide-stone-100">
            {invitations.data?.invitations.map((invitation) => (
              <div key={invitation.id} className="flex items-center gap-4 py-4">
                <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink">{invitation.email}</p><p className="text-sm text-stone-500">{roleLabel(invitation.role)} · {new Date(invitation.expiresAt).toLocaleString('zh-CN')} 到期</p></div>
                <Button variant="secondary" onClick={() => revoke.mutate(invitation.id)}>撤销</Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-stone-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-ink">接受已有邀请</h2>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); accept.mutate() }}>
          <input required className="h-11 min-w-0 flex-1 rounded-xl border border-stone-300 px-3 font-mono text-sm" placeholder="粘贴一次性邀请 token" value={acceptToken} onChange={(event) => setAcceptToken(event.target.value)} />
          <Button disabled={accept.isPending}>接受邀请</Button>
        </form>
      </section>

      {mutationError ? <ErrorMessage error={mutationError} fallback="团队操作失败。" /> : null}
    </div>
  )
}

function ErrorMessage({ error, fallback }: { error: unknown; fallback: string }) {
  return <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">{formatApiError(error, fallback)}</p>
}
function roleLabel(role: string) { return ({ owner: '所有者', admin: '管理员', member: '成员' } as Record<string, string>)[role] ?? role }
