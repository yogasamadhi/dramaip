import assert from 'node:assert/strict'
import test from 'node:test'

import { createApiClient } from '../src/index'

test('uses server-owned payment availability and resource-shaped workspace routes', async () => {
  const client = createApiClient({ baseURL: 'http://example.test', webSession: true })
  const calls: Array<{ method?: string; url?: string; data?: unknown }> = []
  const workspace = {
    id: 'workspace-1', ownerUserId: 'user-owner', name: '短剧工作区', planCode: 'studio',
    includedSeats: 5, activeMemberCount: 1, pendingInvitationCount: 0, currentUserRole: 'owner',
    reviewStorageBytes: 1024, reviewRetentionDays: 30, status: 'active', createdAt: '2026-08-01T00:00:00Z',
  }
  const member = {
    id: 'member-1', workspaceId: 'workspace-1', userId: 'user-1', role: 'member', status: 'active',
    displayName: '成员', email: 'member@example.com', createdAt: '2026-08-01T00:00:00Z',
  }
  const invitation = {
    id: 'invitation-1', workspaceId: 'workspace-1', email: 'member@example.com', role: 'member',
    invitedBy: 'user-owner', expiresAt: '2026-08-04T00:00:00Z', acceptedBy: null,
    acceptedAt: null, revokedAt: null, createdAt: '2026-08-01T00:00:00Z', token: 't'.repeat(64),
  }

  client.http.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, data: config.data })
    const url = config.url ?? ''
    let data: unknown
    if (url === '/api/v1/payment-providers') data = [
      { provider: 'wechatPay', state: 'unavailable', version: 'unconfigured-v1', limitations: ['merchant evidence absent'], paymentActionTypes: ['qrCode'] },
      { provider: 'simulated', state: 'verified', version: 'dev-test-v1', limitations: ['dev/test only'], paymentActionTypes: ['qrCode'] },
    ]
    else if (url === '/api/v1/workspaces') data = [workspace]
    else if (url.endsWith('/members') && config.method === 'get') data = [member]
    else if (url.endsWith('/invitations') && config.method === 'get') data = [invitation]
    else if (url.endsWith('/invitations') && config.method === 'post') data = invitation
    else if (url.includes('/members/member-1') && config.method === 'patch') data = { ...member, role: 'admin' }
    else if (url.includes('/members/member-1') && config.method === 'delete') data = { ...member, status: 'removed' }
    else if (url.includes('/invitations/invitation-1') && config.method === 'delete') data = { ...invitation, revokedAt: '2026-08-01T01:00:00Z', token: '' }
    else if (url.includes('/workspace-invitations/') && url.endsWith('/accept')) data = member
    else throw new Error(`unexpected request ${config.method} ${url}`)
    return {
      data: { code: 'OK', message: 'OK', data, requestId: 'request-1', traceId: 'trace-1' },
      status: 200, statusText: 'OK', headers: {}, config,
    }
  }

  const providers = await client.getPaymentProviders()
  assert.equal(providers[0]?.state, 'unavailable')
  assert.equal((await client.getWorkspaces())[0]?.currentUserRole, 'owner')
  assert.equal((await client.getWorkspaceMembers('workspace-1')).members[0]?.displayName, '成员')
  await client.getWorkspaceInvitations('workspace-1')
  await client.inviteWorkspaceMember({ workspaceId: 'workspace-1', email: 'member@example.com', role: 'member', expiresInHours: 72 })
  await client.updateWorkspaceMember({ workspaceId: 'workspace-1', memberId: 'member-1', role: 'admin' })
  await client.removeWorkspaceMember({ workspaceId: 'workspace-1', memberId: 'member-1' })
  await client.revokeWorkspaceInvitation({ workspaceId: 'workspace-1', invitationId: 'invitation-1' })
  await client.acceptWorkspaceInvitation('t'.repeat(64))

  assert.ok(calls.some((call) => call.url === '/api/v1/workspaces/workspace-1/members/member-1' && call.method === 'patch'))
  assert.ok(calls.some((call) => call.url === `/api/v1/workspace-invitations/${'t'.repeat(64)}/accept`))
  assert.ok(calls.every((call) => !call.url?.includes('workspace_id=')))
})
