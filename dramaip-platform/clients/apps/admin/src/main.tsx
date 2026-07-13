import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { init, use } from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { adminAPI, APIError, AuditEntry, OrderSummary, Overview, Principal, ProjectionException, SubscriptionSummary, UserSummary } from './api'
import './styles.css'

use([PieChart, TooltipComponent, CanvasRenderer])

type Dashboard = { overview: Overview; users: UserSummary[]; orders: OrderSummary[]; subscriptions: SubscriptionSummary[]; exceptions: ProjectionException[]; audit: AuditEntry[] }

function formatCount(value: number) { return new Intl.NumberFormat('zh-CN').format(value) }
function formatDate(value?: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' }
function short(value: string) { return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value || '—' }

function OverviewChart({ overview }: { overview: Overview }) {
  const node = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!node.current) return
    const chart = init(node.current)
    chart.setOption({
      tooltip: { trigger: 'item' },
      series: [{ type: 'pie', radius: ['54%', '78%'], label: { color: '#c9d5ee' }, data: [
        { value: overview.paid_order_count, name: '已支付订单' },
        { value: overview.active_subscription_count, name: '活跃订阅' },
        { value: overview.open_exception_count, name: '待处理异常', itemStyle: { color: '#f08f62' } },
      ] }],
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(node.current)
    return () => { observer.disconnect(); chart.dispose() }
  }, [overview])
  return <div className="chart" ref={node} aria-label="运营概览图表" />
}

function Login({ onLogin }: { onLogin: (token: string, principal: Principal) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { const login = await adminAPI.login(email, password); onLogin(login.access_token, login.principal) }
    catch (cause) { setError(cause instanceof APIError ? cause.message : '登录暂不可用') }
    finally { setBusy(false) }
  }
  return <main className="login-shell"><section className="login-card"><p className="eyebrow">DRAMAIP / OPERATIONS</p><h1>管理台</h1><p>使用独立管理员身份登录；不会接受 C 端 Cookie 或访问令牌。</p><form onSubmit={submit}><label>邮箱<input autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></label><label>密码<input autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={8} required /></label>{error && <p className="error" role="alert">{error}</p>}<button disabled={busy}>{busy ? '验证中…' : '安全登录'}</button></form><small>令牌仅存在当前页面内存；刷新后需重新登录。</small></section></main>
}

function App() {
  const [token, setToken] = useState<string | null>(null)
  const [principal, setPrincipal] = useState<Principal | null>(null)
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState<ProjectionException | null>(null)
  const [reason, setReason] = useState('')

  async function refresh(activeToken = token) {
    if (!activeToken) return
    setLoading(true); setError('')
    try {
      const [overview, users, orders, subscriptions, exceptions, audit] = await Promise.all([adminAPI.overview(activeToken), adminAPI.users(activeToken), adminAPI.orders(activeToken), adminAPI.subscriptions(activeToken), adminAPI.exceptions(activeToken), adminAPI.audit(activeToken)])
      setData({ overview, users: users.users, orders: orders.orders, subscriptions: subscriptions.subscriptions, exceptions: exceptions.exceptions, audit: audit.entries })
    } catch (cause) {
      const message = cause instanceof APIError ? cause.message : '报表暂不可用'
      setError(message)
      if (cause instanceof APIError && cause.status === 401) { setToken(null); setPrincipal(null); setData(null) }
    } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [token])
  async function resolve() {
    if (!token || !resolving || reason.trim().length < 4) return
    setLoading(true); setError('')
    try {
      const confirmation = await adminAPI.createResolutionConfirmation(token, resolving.id, reason.trim())
      await adminAPI.resolveException(token, resolving.id, confirmation.confirmation.id)
      setResolving(null); setReason(''); await refresh(token)
    } catch (cause) { setError(cause instanceof APIError ? cause.message : '异常确认失败') }
    finally { setLoading(false) }
  }
  if (!token || !principal) return <Login onLogin={(nextToken, nextPrincipal) => { setToken(nextToken); setPrincipal(nextPrincipal) }} />
  return <main className="app-shell"><header><div><p className="eyebrow">DRAMAIP / ADMIN</p><h1>运营与报表</h1></div><div className="identity"><span>{principal.email}</span><small>{principal.roles.join(' · ')}</small><button className="quiet" onClick={() => { setToken(null); setPrincipal(null); setData(null) }}>退出</button></div></header><section className="notice">数据来自异步事件投影，可能有短暂延迟；这里不显示原始创作内容、支付密钥或财务账本。</section>{error && <p className="error global" role="alert">{error}</p>}<div className="toolbar"><button onClick={() => void refresh()} disabled={loading}>{loading ? '更新中…' : '刷新报表'}</button><span>上次事件：{formatDate(data?.overview.last_event_at)}</span></div>{data && <><section className="summary-grid"><Metric label="用户" value={data.overview.user_count} /><Metric label="已支付订单" value={data.overview.paid_order_count} /><Metric label="活跃订阅" value={data.overview.active_subscription_count} /><Metric label="累计 Tokens" value={data.overview.total_tokens} warn={data.overview.open_exception_count} /></section><section className="panel chart-panel"><div><h2>运营信号</h2><p>订单、订阅与投影异常。</p></div><OverviewChart overview={data.overview} /></section><section className="table-grid"><Table title="近期用户" headers={['用户', '套餐', 'Tokens', '最近活动']} rows={data.users.map((row) => [short(row.user_id), row.last_plan_code || '—', formatCount(row.total_tokens), formatDate(row.last_seen_at)])} /><Table title="近期订单" headers={['订单', '套餐', '渠道', '金额', '状态']} rows={data.orders.map((row) => [short(row.order_id), row.plan_code, row.provider, `${row.amount} ${row.currency}`, row.status])} /><Table title="活跃订阅" headers={['订阅', '用户', '套餐', '周期结束']} rows={data.subscriptions.map((row) => [short(row.subscription_id), short(row.user_id), row.plan_code, formatDate(row.period_end)])} /></section><section className="panel"><div className="panel-heading"><div><h2>异步异常分诊</h2><p>确认“已处理”只关闭投影告警；请在对应的领域工作流中完成真实修复。</p></div></div><table><thead><tr><th>事件</th><th>摘要</th><th>链路</th><th>时间</th><th>操作</th></tr></thead><tbody>{data.exceptions.length === 0 ? <tr><td colSpan={5} className="empty">没有待处理的投影异常</td></tr> : data.exceptions.map((row) => <tr key={row.id}><td title={row.event_id}>{row.event_type}<small>{short(row.event_id)}</small></td><td>{row.summary}</td><td>{short(row.trace_id)}</td><td>{formatDate(row.created_at)}</td><td>{principal.permissions.includes('reporting.write') ? <button className="quiet" onClick={() => setResolving(row)}>确认已处理</button> : '只读'}</td></tr>)}</tbody></table></section><section className="panel"><h2>审计轨迹</h2><table><thead><tr><th>时间</th><th>动作</th><th>资源</th><th>原因</th><th>链路</th></tr></thead><tbody>{data.audit.map((row) => <tr key={row.id}><td>{formatDate(row.created_at)}</td><td>{row.action}</td><td>{row.resource_type} / {short(row.resource_id)}</td><td>{row.reason}</td><td>{short(row.trace_id)}</td></tr>)}</tbody></table></section></>}{resolving && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="resolve-title"><h2 id="resolve-title">确认异常已处理</h2><p>此操作会创建一次性确认与审计记录，然后仅关闭报表投影异常。</p><label>处置说明<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={4} maxLength={300} placeholder="说明已在何处完成修复" /></label><div className="modal-actions"><button className="quiet" onClick={() => { setResolving(null); setReason('') }}>取消</button><button disabled={loading || reason.trim().length < 4} onClick={() => void resolve()}>确认并关闭投影异常</button></div></section></div>}</main>
}
function Metric({ label, value, warn }: { label: string; value: number; warn?: number }) { return <article className="metric"><span>{label}</span><strong>{formatCount(value)}</strong>{warn !== undefined && <small className={warn ? 'warn' : ''}>{warn ? `${warn} 条待处理异常` : '无待处理异常'}</small>}</article> }
function Table({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) { return <section className="panel"><h2>{title}</h2><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={`${title}-${index}`}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>) : <tr><td className="empty" colSpan={headers.length}>暂无数据</td></tr>}</tbody></table></section> }

createRoot(document.getElementById('root')!).render(<App />)
