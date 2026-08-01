import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { init, use } from "echarts/core";
import { PieChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import {
  adminAPI,
  APIError,
  AuditEntry,
  CostAlert,
  Customer,
  DeliveryAttempt,
  OrderSummary,
  Overview,
  Principal,
  ProjectionException,
  Reconciliation,
  SubscriptionSummary,
  UserSummary,
} from "./api";
import "./styles.css";

use([PieChart, TooltipComponent, CanvasRenderer]);

type Dashboard = {
  overview: Overview;
  users: UserSummary[];
  usersNextCursor: string;
  orders: OrderSummary[];
  subscriptions: SubscriptionSummary[];
  exceptions: ProjectionException[];
  audit: AuditEntry[];
};
type Operation =
  | "suspend"
  | "recover"
  | "refund"
  | "resume"
  | "quota"
  | "notify";
type PendingOperation = { kind: Operation; targetID: string };
type JobOperation = "reconcile" | "reconciliation_action" | "retry_delivery";
type PendingJobOperation = {
  kind: JobOperation;
  targetID: string;
  action?: string;
};
type StoredAdminSession = {
  token: string;
  principal: Principal;
  expiresAt: number;
};

const adminSessionKey = "dramaip.admin.session";

function readAdminSession(): StoredAdminSession | null {
  try {
    const raw = window.sessionStorage.getItem(adminSessionKey);
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredAdminSession;
    if (!session.token || !session.principal || session.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(adminSessionKey);
      return null;
    }
    return session;
  } catch {
    window.sessionStorage.removeItem(adminSessionKey);
    return null;
  }
}

function writeAdminSession(
  token: string,
  principal: Principal,
  expiresIn: number,
) {
  window.sessionStorage.setItem(
    adminSessionKey,
    JSON.stringify({ token, principal, expiresAt: Date.now() + expiresIn * 1000 }),
  );
}

function clearAdminSession() {
  window.sessionStorage.removeItem(adminSessionKey);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
function formatDate(value?: string) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}
function short(value: string) {
  return value.length > 14
    ? `${value.slice(0, 8)}…${value.slice(-4)}`
    : value || "—";
}

function OverviewChart({ overview }: { overview: Overview }) {
  const node = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!node.current) return;
    const chart = init(node.current);
    chart.setOption({
      tooltip: { trigger: "item" },
      series: [
        {
          type: "pie",
          radius: ["54%", "78%"],
          label: { color: "#c9d5ee" },
          data: [
            { value: overview.paid_order_count, name: "已支付订单" },
            { value: overview.active_subscription_count, name: "活跃订阅" },
            {
              value: overview.open_exception_count,
              name: "待处理异常",
              itemStyle: { color: "#f08f62" },
            },
          ],
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [overview]);
  return <div className="chart" ref={node} aria-label="运营概览图表" />;
}

function Login({
  onLogin,
}: {
  onLogin: (token: string, principal: Principal, expiresIn: number) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
      setError("");
    try {
      const login = await adminAPI.login(email, password);
      onLogin(login.access_token, login.principal, login.expires_in);
    } catch (cause) {
      setError(cause instanceof APIError ? cause.message : "登录暂不可用");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">DRAMAIP / OPERATIONS</p>
        <h1>管理台</h1>
        <p>使用独立管理员身份登录；不会接受 C 端 Cookie 或访问令牌。</p>
        <form onSubmit={submit}>
          <label>
            邮箱
            <input
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>
          <label>
            密码
            <input
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              minLength={8}
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy}>{busy ? "验证中…" : "安全登录"}</button>
        </form>
        <small>令牌仅保留在当前浏览器标签页；关闭标签页或令牌过期后需重新登录。</small>
      </section>
    </main>
  );
}

function App() {
  const [initialSession] = useState(readAdminSession);
  const [token, setToken] = useState<string | null>(initialSession?.token || null);
  const [principal, setPrincipal] = useState<Principal | null>(
    initialSession?.principal || null,
  );
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState<ProjectionException | null>(null);
  const [reason, setReason] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [costAlerts, setCostAlerts] = useState<CostAlert[]>([]);
  const [reconciliation, setReconciliation] =
    useState<Reconciliation | null>(null);
  const [deliveryAttempts, setDeliveryAttempts] = useState<DeliveryAttempt[]>(
    [],
  );
  const [pendingOperation, setPendingOperation] =
    useState<PendingOperation | null>(null);
  const [pendingJobOperation, setPendingJobOperation] =
    useState<PendingJobOperation | null>(null);
  const [operationReason, setOperationReason] = useState("");
  const [quotaDelta, setQuotaDelta] = useState(0);
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationBody, setNotificationBody] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  async function refresh(activeToken = token, userQuery = appliedSearch) {
    if (!activeToken) return;
    setLoading(true);
    setError("");
    try {
      const canBilling = principal?.permissions.includes("billing.write");
      const canNotify = principal?.permissions.includes("notification.write");
      const [
        overview,
        users,
        orders,
        subscriptions,
        exceptions,
        audit,
        costs,
        reconciliationResult,
        deliveryResult,
      ] = await Promise.all([
          adminAPI.overview(activeToken),
          adminAPI.users(activeToken, "", userQuery),
          adminAPI.orders(activeToken),
          adminAPI.subscriptions(activeToken),
          adminAPI.exceptions(activeToken),
          adminAPI.audit(activeToken),
          adminAPI.costAlerts(activeToken),
          canBilling
            ? adminAPI.reconciliation(activeToken)
            : Promise.resolve(null),
          canNotify
            ? adminAPI.deliveryAttempts(activeToken)
            : Promise.resolve(null),
        ]);
      setData({
        overview,
        users: users.users,
        usersNextCursor: users.next_cursor,
        orders: orders.orders,
        subscriptions: subscriptions.subscriptions,
        exceptions: exceptions.exceptions,
        audit: audit.entries,
      });
      setCostAlerts(costs.alerts);
      setReconciliation(reconciliationResult);
      setDeliveryAttempts(deliveryResult?.attempts || []);
    } catch (cause) {
      const message =
        cause instanceof APIError ? cause.message : "报表暂不可用";
      setError(message);
      if (cause instanceof APIError && cause.status === 401) {
        clearAdminSession();
        setToken(null);
        setPrincipal(null);
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [token]);
  useEffect(() => {
    const userID = new URLSearchParams(window.location.search).get("user");
    if (token && userID) void openCustomer(userID);
  }, [token]);
  async function resolve() {
    if (!token || !resolving || reason.trim().length < 4) return;
    setLoading(true);
    setError("");
    try {
      const confirmation = await adminAPI.createResolutionConfirmation(
        token,
        resolving.id,
        reason.trim(),
      );
      await adminAPI.resolveException(
        token,
        resolving.id,
        confirmation.confirmation.id,
      );
      setResolving(null);
      setReason("");
      await refresh(token);
    } catch (cause) {
      setError(cause instanceof APIError ? cause.message : "异常确认失败");
    } finally {
      setLoading(false);
    }
  }
  async function openCustomer(userID: string) {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const detail = await adminAPI.customer(token, userID);
      setCustomer(detail);
      const url = new URL(window.location.href);
      url.searchParams.set("user", userID);
      window.history.replaceState({}, "", url);
    } catch (cause) {
      setError(cause instanceof APIError ? cause.message : "用户详情暂不可用");
    } finally {
      setLoading(false);
    }
  }
  function closeCustomer() {
    setCustomer(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("user");
    window.history.replaceState({}, "", url);
  }
  async function loadMoreUsers() {
    if (!token || !data?.usersNextCursor) return;
    setLoading(true);
    setError("");
    try {
      const page = await adminAPI.users(
        token,
        data.usersNextCursor,
        appliedSearch,
      );
      setData((current) =>
        current
          ? {
              ...current,
              users: [...current.users, ...page.users],
              usersNextCursor: page.next_cursor,
            }
          : current,
      );
    } catch (cause) {
      setError(
        cause instanceof APIError ? cause.message : "下一页用户加载失败",
      );
    } finally {
      setLoading(false);
    }
  }
  async function applyUserSearch() {
    const userQuery = search.trim();
    setAppliedSearch(userQuery);
    await refresh(token, userQuery);
  }
  async function runOperation() {
    if (
      !token ||
      !customer ||
      !pendingOperation ||
      operationReason.trim().length < 4
    )
      return;
    const actionByOperation: Record<Operation, string> = {
      suspend: "customer.status.set",
      recover: "customer.status.set",
      refund: "billing.refund.request",
      resume: "billing.subscription.resume",
      quota: "quota.adjust",
      notify: "notification.send",
    };
    const subscriptionID = customer.subscription?.id || "";
    const targetID = pendingOperation.targetID;
    if (
      (pendingOperation.kind === "refund" ||
        pendingOperation.kind === "resume" ||
        pendingOperation.kind === "quota") &&
      !subscriptionID
    )
      return;
    if (pendingOperation.kind === "quota" && quotaDelta === 0) {
      setError("额度调整不能为 0");
      return;
    }
    if (
      pendingOperation.kind === "notify" &&
      (!notificationTitle.trim() || !notificationBody.trim())
    ) {
      setError("请填写通知标题和正文");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const confirmation = await adminAPI.createConfirmation(
        token,
        actionByOperation[pendingOperation.kind],
        targetID,
        operationReason.trim(),
      );
      const confirmationID = confirmation.confirmation.id;
      if (
        pendingOperation.kind === "suspend" ||
        pendingOperation.kind === "recover"
      )
        await adminAPI.setCustomerStatus(
          token,
          customer.profile.id,
          pendingOperation.kind === "suspend" ? "suspended" : "active",
          confirmationID,
        );
      if (pendingOperation.kind === "refund")
        await adminAPI.requestRefund(
          token,
          customer.profile.id,
          subscriptionID,
          confirmationID,
        );
      if (pendingOperation.kind === "resume")
        await adminAPI.resumeSubscription(
          token,
          customer.profile.id,
          subscriptionID,
          confirmationID,
        );
      if (pendingOperation.kind === "quota")
        await adminAPI.adjustQuota(
          token,
          customer.profile.id,
          subscriptionID,
          quotaDelta,
          confirmationID,
        );
      if (pendingOperation.kind === "notify")
        await adminAPI.sendNotification(
          token,
          customer.profile.id,
          notificationTitle.trim(),
          notificationBody.trim(),
          confirmationID,
        );
      setPendingOperation(null);
      setOperationReason("");
      setQuotaDelta(0);
      setNotificationTitle("");
      setNotificationBody("");
      await openCustomer(customer.profile.id);
      await refresh(token);
    } catch (cause) {
      setError(cause instanceof APIError ? cause.message : "运营操作未完成");
    } finally {
      setLoading(false);
    }
  }
  async function runJobOperation() {
    if (
      !token ||
      !pendingJobOperation ||
      operationReason.trim().length < 4
    )
      return;
    const actionByOperation: Record<JobOperation, string> = {
      reconcile: "billing.reconciliation.start",
      reconciliation_action: "billing.reconciliation.action",
      retry_delivery: "notification.delivery.retry",
    };
    setLoading(true);
    setError("");
    try {
      const confirmation = await adminAPI.createConfirmation(
        token,
        actionByOperation[pendingJobOperation.kind],
        pendingJobOperation.targetID,
        operationReason.trim(),
      );
      if (pendingJobOperation.kind === "reconcile")
        await adminAPI.startReconciliation(token, confirmation.confirmation.id);
      if (pendingJobOperation.kind === "reconciliation_action")
        await adminAPI.applyReconciliationAction(
          token,
          pendingJobOperation.targetID,
          pendingJobOperation.action || "manual_confirm",
          confirmation.confirmation.id,
        );
      if (pendingJobOperation.kind === "retry_delivery")
        await adminAPI.retryDelivery(
          token,
          pendingJobOperation.targetID,
          confirmation.confirmation.id,
        );
      setPendingJobOperation(null);
      setOperationReason("");
      await refresh(token);
    } catch (cause) {
      setError(cause instanceof APIError ? cause.message : "领域操作未完成");
    } finally {
      setLoading(false);
    }
  }
  const filteredUsers = data?.users || [];
  if (!token || !principal)
    return (
      <Login
        onLogin={(nextToken, nextPrincipal, expiresIn) => {
          writeAdminSession(nextToken, nextPrincipal, expiresIn);
          setToken(nextToken);
          setPrincipal(nextPrincipal);
        }}
      />
    );
  return (
    <main className="app-shell">
      <header>
        <div>
          <p className="eyebrow">DRAMAIP / ADMIN</p>
          <h1>运营与报表</h1>
        </div>
        <div className="identity">
          <span>{principal.email}</span>
          <small>{principal.roles.join(" · ")}</small>
          <button
            className="quiet"
            onClick={() => {
              clearAdminSession();
              setToken(null);
              setPrincipal(null);
              setData(null);
            }}
          >
            退出
          </button>
        </div>
      </header>
      <section className="notice">
        数据来自异步事件投影，可能有短暂延迟；运营动作通过各领域服务执行，并使用一次性确认、幂等键与不可变审计记录。
      </section>
      {error && (
        <p className="error global" role="alert">
          {error}
        </p>
      )}
      <div className="toolbar">
        <button onClick={() => void refresh()} disabled={loading}>
          {loading ? "更新中…" : "刷新报表"}
        </button>
        <span>上次事件：{formatDate(data?.overview.last_event_at)}</span>
      </div>
      {data && (
        <>
          <section className="summary-grid">
            <Metric label="用户" value={data.overview.user_count} />
            <Metric label="已支付订单" value={data.overview.paid_order_count} />
            <Metric
              label="活跃订阅"
              value={data.overview.active_subscription_count}
            />
            <Metric
              label="累计 Tokens"
              value={data.overview.total_tokens}
              warn={data.overview.open_exception_count}
            />
          </section>
          <section className="panel chart-panel">
            <div>
              <h2>运营信号</h2>
              <p>订单、订阅与投影异常。</p>
            </div>
            <OverviewChart overview={data.overview} />
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>用户检索与处置</h2>
                <p>
                  按用户 ID
                  或套餐过滤；选择用户可查看订单、额度、通知与关联状态。
                </p>
              </div>
              <div className="search-form">
                <input
                  className="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void applyUserSearch();
                  }}
                  placeholder="用户 ID 或套餐"
                  aria-label="按用户 ID 或套餐筛选用户"
                />
                <button
                  className="quiet"
                  disabled={loading}
                  onClick={() => void applyUserSearch()}
                >
                  检索
                </button>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>套餐</th>
                  <th>Tokens</th>
                  <th>最近活动</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length ? (
                  filteredUsers.map((row) => (
                    <tr key={row.user_id}>
                      <td title={row.user_id}>{short(row.user_id)}</td>
                      <td>{row.last_plan_code || "—"}</td>
                      <td>{formatCount(row.total_tokens)}</td>
                      <td>{formatDate(row.last_seen_at)}</td>
                      <td>
                        <button
                          className="quiet"
                          onClick={() => void openCustomer(row.user_id)}
                        >
                          查看链路
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty" colSpan={5}>
                      没有匹配用户
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {data.usersNextCursor && (
              <div className="list-pagination">
                <span>已加载 {data.users.length} 名用户</span>
                <button
                  className="quiet"
                  disabled={loading}
                  onClick={() => void loadMoreUsers()}
                >
                  加载更多用户
                </button>
              </div>
            )}
          </section>
          <section className="table-grid">
            <Table
              title="近期订单"
              headers={["订单", "套餐", "渠道", "金额", "状态"]}
              rows={data.orders.map((row) => [
                short(row.order_id),
                row.plan_code,
                row.provider,
                `${row.amount} ${row.currency}`,
                row.status,
              ])}
            />
            <Table
              title="活跃订阅"
              headers={["订阅", "用户", "套餐", "周期结束"]}
              rows={data.subscriptions.map((row) => [
                short(row.subscription_id),
                short(row.user_id),
                row.plan_code,
                formatDate(row.period_end),
              ])}
            />
            <Table
              title="AI 成本告警"
              headers={["用户", "事件", "成本 / 阈值", "链路"]}
              rows={costAlerts
                .slice(0, 10)
                .map((row) => [
                  short(row.user_id),
                  row.event_type,
                  `¥${row.observed_cost_cny} / ¥${row.threshold_cny}`,
                  short(row.trace_id),
                ])}
            />
          </section>
          {principal.permissions.includes("billing.write") && (
            <section className="panel operations-panel">
              <div className="panel-heading">
                <div>
                  <h2>账务对账处置</h2>
                  <p>
                    由 Billing Job 完成扫描与受控修复；管理台不会直接修改账务表。
                  </p>
                </div>
                <button
                  className="quiet"
                  disabled={loading}
                  onClick={() =>
                    setPendingJobOperation({
                      kind: "reconcile",
                      targetID: "billing-reconciliation",
                    })
                  }
                >
                  发起对账
                </button>
              </div>
              <p className="operation-meta">
                最近运行：{reconciliation?.latest_run
                  ? `${reconciliation.latest_run.status} · 扫描 ${reconciliation.latest_run.scanned_items} · 发现 ${reconciliation.latest_run.detected_items} · ${formatDate(reconciliation.latest_run.started_at)}`
                  : "暂无运行记录"}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>问题</th>
                    <th>对象</th>
                    <th>建议</th>
                    <th>状态</th>
                    <th>最近发现</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation?.items.length ? (
                    reconciliation.items.map((row) => {
                      const action =
                        row.recommendation === "retry_quota_provision"
                          ? "retry_quota_provision"
                          : "manual_confirm";
                      return (
                        <tr key={row.id}>
                          <td>
                            {row.mismatch_type}
                            <small>{row.severity}</small>
                          </td>
                          <td title={row.order_id || row.subscription_id}>
                            {short(row.order_id || row.subscription_id)}
                          </td>
                          <td>{row.recommendation}</td>
                          <td>{row.status}</td>
                          <td>{formatDate(row.last_detected_at)}</td>
                          <td>
                            {row.status === "resolved" ? (
                              "已解决"
                            ) : (
                              <button
                                className="quiet"
                                disabled={loading}
                                onClick={() =>
                                  setPendingJobOperation({
                                    kind: "reconciliation_action",
                                    targetID: row.id,
                                    action,
                                  })
                                }
                              >
                                {action === "retry_quota_provision"
                                  ? "重试额度开通"
                                  : "人工确认"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="empty">
                        暂无待处置对账项
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          )}
          {principal.permissions.includes("notification.write") && (
            <section className="panel operations-panel">
              <div className="panel-heading">
                <div>
                  <h2>失败投递重试</h2>
                  <p>
                    仅展示失败尝试。重试会复用原始事件，并重新走 Notification Job 的 inbox 与通道链路。
                  </p>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>通道</th>
                    <th>失败原因</th>
                    <th>时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryAttempts.length ? (
                    deliveryAttempts.map((row) => (
                      <tr key={row.id}>
                        <td title={row.user_id}>{short(row.user_id)}</td>
                        <td>{row.channel}</td>
                        <td>{row.failure || "—"}</td>
                        <td>{formatDate(row.attempted_at)}</td>
                        <td>
                          <button
                            className="quiet"
                            disabled={loading}
                            onClick={() =>
                              setPendingJobOperation({
                                kind: "retry_delivery",
                                targetID: row.id,
                              })
                            }
                          >
                            重试投递
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty">
                        没有失败投递
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          )}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>异步异常分诊</h2>
                <p>
                  确认“已处理”只关闭投影告警；请在对应的领域工作流中完成真实修复。
                </p>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>事件</th>
                  <th>摘要</th>
                  <th>链路</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.exceptions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      没有待处理的投影异常
                    </td>
                  </tr>
                ) : (
                  data.exceptions.map((row) => (
                    <tr key={row.id}>
                      <td title={row.event_id}>
                        {row.event_type}
                        <small>{short(row.event_id)}</small>
                      </td>
                      <td>{row.summary}</td>
                      <td>{short(row.trace_id)}</td>
                      <td>{formatDate(row.created_at)}</td>
                      <td>
                        {principal.permissions.includes("reporting.write") ? (
                          <button
                            className="quiet"
                            onClick={() => setResolving(row)}
                          >
                            确认已处理
                          </button>
                        ) : (
                          "只读"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <h2>审计轨迹</h2>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>动作</th>
                  <th>资源</th>
                  <th>原因</th>
                  <th>链路</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.created_at)}</td>
                    <td>{row.action}</td>
                    <td>
                      {row.resource_type} / {short(row.resource_id)}
                    </td>
                    <td>{row.reason}</td>
                    <td>{short(row.trace_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
      {resolving && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resolve-title"
          >
            <h2 id="resolve-title">确认异常已处理</h2>
            <p>此操作会创建一次性确认与审计记录，然后仅关闭报表投影异常。</p>
            <label>
              处置说明
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={4}
                maxLength={300}
                placeholder="说明已在何处完成修复"
              />
            </label>
            <div className="modal-actions">
              <button
                className="quiet"
                onClick={() => {
                  setResolving(null);
                  setReason("");
                }}
              >
                取消
              </button>
              <button
                disabled={loading || reason.trim().length < 4}
                onClick={() => void resolve()}
              >
                确认并关闭投影异常
              </button>
            </div>
          </section>
        </div>
      )}
      {customer && (
        <CustomerDrawer
          customer={customer}
          principal={principal}
          busy={loading}
          onClose={closeCustomer}
          onAction={(kind, targetID) => setPendingOperation({ kind, targetID })}
        />
      )}
      {pendingOperation && customer && (
        <OperationDialog
          operation={pendingOperation.kind}
          customer={customer}
          reason={operationReason}
          quotaDelta={quotaDelta}
          notificationTitle={notificationTitle}
          notificationBody={notificationBody}
          busy={loading}
          onReason={setOperationReason}
          onQuota={setQuotaDelta}
          onTitle={setNotificationTitle}
          onBody={setNotificationBody}
          onCancel={() => {
            setPendingOperation(null);
            setOperationReason("");
          }}
          onConfirm={() => void runOperation()}
        />
      )}
      {pendingJobOperation && (
        <JobOperationDialog
          operation={pendingJobOperation}
          reason={operationReason}
          busy={loading}
          onReason={setOperationReason}
          onCancel={() => {
            setPendingJobOperation(null);
            setOperationReason("");
          }}
          onConfirm={() => void runJobOperation()}
        />
      )}
    </main>
  );
}
function Metric({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: number;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{formatCount(value)}</strong>
      {warn !== undefined && (
        <small className={warn ? "warn" : ""}>
          {warn ? `${warn} 条待处理异常` : "无待处理异常"}
        </small>
      )}
    </article>
  );
}
function Table({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={`${title}-${index}`}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="empty" colSpan={headers.length}>
                暂无数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
function CustomerDrawer({
  customer,
  principal,
  busy,
  onClose,
  onAction,
}: {
  customer: Customer;
  principal: Principal;
  busy: boolean;
  onClose: () => void;
  onAction: (kind: Operation, targetID: string) => void;
}) {
  const subscriptionID = customer.subscription?.id || "";
  const canCustomer = principal.permissions.includes("customer.write");
  const canBilling = principal.permissions.includes("billing.write");
  const canQuota = principal.permissions.includes("quota.write");
  const canNotify = principal.permissions.includes("notification.write");
  return (
    <div className="drawer-backdrop" role="presentation">
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="用户运营详情"
      >
        <div className="drawer-heading">
          <div>
            <p className="eyebrow">CUSTOMER TRACE</p>
            <h2>
              {customer.profile.display_name || short(customer.profile.id)}
            </h2>
            <p>{customer.profile.email || customer.profile.id}</p>
          </div>
          <button className="quiet" onClick={onClose}>
            关闭
          </button>
        </div>
        <section className="detail-grid">
          <Detail label="状态" value={customer.profile.status} />
          <Detail label="套餐" value={customer.balance?.plan || "—"} />
          <Detail
            label="剩余额度"
            value={
              customer.balance
                ? formatCount(customer.balance.remaining_tokens)
                : "—"
            }
          />
          <Detail label="订阅" value={customer.subscription?.status || "—"} />
        </section>
        <section className="action-row">
          {canCustomer && (
            <button
              className={customer.profile.status === "active" ? "danger" : ""}
              disabled={busy}
              onClick={() =>
                onAction(
                  customer.profile.status === "active" ? "suspend" : "recover",
                  customer.profile.id,
                )
              }
            >
              {customer.profile.status === "active" ? "冻结用户" : "恢复用户"}
            </button>
          )}
          {canNotify && (
            <button
              className="quiet"
              disabled={busy}
              onClick={() => onAction("notify", customer.profile.id)}
            >
              发送通知
            </button>
          )}
          {canBilling && subscriptionID && (
            <>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => onAction("refund", subscriptionID)}
              >
                发起退款
              </button>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => onAction("resume", subscriptionID)}
              >
                恢复订阅
              </button>
            </>
          )}
          {canQuota && subscriptionID && (
            <button
              className="quiet"
              disabled={busy}
              onClick={() => onAction("quota", subscriptionID)}
            >
              调整额度
            </button>
          )}
        </section>
        <section>
          <h3>订单</h3>
          <MiniTable
            headers={["订单", "渠道", "金额", "状态"]}
            rows={customer.orders.map((row) => [
              short(row.id),
              row.provider,
              `${row.amount} ${row.currency}`,
              row.status,
            ])}
          />
        </section>
        <section>
          <h3>近期用量</h3>
          <MiniTable
            headers={["模型", "Tokens", "状态", "时间"]}
            rows={customer.usage.map((row) => [
              row.model,
              formatCount(row.total_tokens),
              row.status,
              formatDate(row.created_at),
            ])}
          />
        </section>
        <section>
          <h3>通知投递</h3>
          <MiniTable
            headers={["标题", "状态", "时间"]}
            rows={customer.notifications.map((row) => [
              row.title,
              row.read_at ? "已读" : "未读",
              formatDate(row.created_at),
            ])}
          />
        </section>
      </aside>
    </div>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
function MiniTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <table className="mini-table">
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((row, index) => (
            <tr key={index}>
              {row.map((value, cell) => (
                <td key={cell}>{value}</td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td className="empty" colSpan={headers.length}>
              暂无记录
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
function JobOperationDialog({
  operation,
  reason,
  busy,
  onReason,
  onCancel,
  onConfirm,
}: {
  operation: PendingJobOperation;
  reason: string;
  busy: boolean;
  onReason: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const labels: Record<JobOperation, string> = {
    reconcile: "发起账务对账",
    reconciliation_action:
      operation.action === "retry_quota_provision"
        ? "重试额度开通"
        : "人工确认对账项",
    retry_delivery: "重试通知投递",
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-operation-title"
      >
        <p className="eyebrow">SECOND CONFIRMATION</p>
        <h2 id="job-operation-title">{labels[operation.kind]}</h2>
        <p>
          此操作会创建一次性确认与审计记录。目标
          <strong>{short(operation.targetID)}</strong> 仅会由对应 Job 的 mTLS
          领域接口处理。
        </p>
        <label>
          处置说明
          <textarea
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            minLength={4}
            maxLength={300}
            placeholder="说明授权依据与预期结果"
          />
        </label>
        <div className="modal-actions">
          <button className="quiet" onClick={onCancel}>
            取消
          </button>
          <button disabled={busy || reason.trim().length < 4} onClick={onConfirm}>
            确认执行
          </button>
        </div>
      </section>
    </div>
  );
}
function OperationDialog({
  operation,
  customer,
  reason,
  quotaDelta,
  notificationTitle,
  notificationBody,
  busy,
  onReason,
  onQuota,
  onTitle,
  onBody,
  onCancel,
  onConfirm,
}: {
  operation: Operation;
  customer: Customer;
  reason: string;
  quotaDelta: number;
  notificationTitle: string;
  notificationBody: string;
  busy: boolean;
  onReason: (value: string) => void;
  onQuota: (value: number) => void;
  onTitle: (value: string) => void;
  onBody: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const labels: Record<Operation, string> = {
    suspend: "冻结用户",
    recover: "恢复用户",
    refund: "发起退款",
    resume: "恢复订阅",
    quota: "调整额度",
    notify: "发送通知",
  };
  const dangerous =
    operation === "suspend" || operation === "refund" || operation === "quota";
  const ready =
    reason.trim().length >= 4 &&
    (operation !== "quota" || quotaDelta !== 0) &&
    (operation !== "notify" ||
      (notificationTitle.trim() && notificationBody.trim()));
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-title"
      >
        <p className="eyebrow">SECOND CONFIRMATION</p>
        <h2 id="operation-title">{labels[operation]}</h2>
        <p>
          将为 <strong>{short(customer.profile.id)}</strong>{" "}
          创建一次性确认。领域服务使用该确认 ID
          作为幂等键，操作人和原因会写入审计轨迹。
        </p>
        {operation === "quota" && (
          <label>
            额度增减（Tokens）
            <input
              type="number"
              value={quotaDelta}
              onChange={(event) => onQuota(Number(event.target.value))}
            />
          </label>
        )}
        {operation === "notify" && (
          <>
            <label>
              通知标题
              <input
                value={notificationTitle}
                onChange={(event) => onTitle(event.target.value)}
                maxLength={120}
              />
            </label>
            <label>
              通知正文
              <textarea
                value={notificationBody}
                onChange={(event) => onBody(event.target.value)}
                maxLength={1000}
              />
            </label>
          </>
        )}
        <label>
          处置说明
          <textarea
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            minLength={4}
            maxLength={300}
            placeholder="说明授权依据与预期结果"
          />
        </label>
        <div className="modal-actions">
          <button className="quiet" onClick={onCancel}>
            取消
          </button>
          <button
            className={dangerous ? "danger" : ""}
            disabled={busy || !ready}
            onClick={onConfirm}
          >
            {dangerous ? "确认高风险操作" : "确认执行"}
          </button>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
