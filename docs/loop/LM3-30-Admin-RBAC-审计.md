# LM3-30：Admin BFF、独立认证与 RBAC

## 交付边界

本轮新增 `services/app/admin/interface` 与版本化 `api/admin/interface/v1`，经 Kong 的 `/v1/admin` 路由提供独立管理员登录、角色权限、操作确认、管理员挂起和审计读取。

- 不接受 Web/Desktop/Mobile 的 JWT、Cookie 或 refresh token；Admin 使用独立 RSA key、issuer `dramaip-admin`、audience `dramaip-admin-api` 与 10 分钟 access session。
- `admin` schema 只保存管理员主体、角色、session、确认和审计元数据；`dramaip_admin` 无权访问 auth、billing、quota、AI、notification 或 inspiration schema。
- 当前角色：`viewer`/`operator` 有 `audit.read`，仅 `security_admin` 有 `principal.write`。
- 挂起管理员必须先 `POST /v1/admin/confirmations` 创建 5 分钟、一次性的 `principal.suspend` 确认，再 `POST /v1/admin/principals/suspend` 消费确认。禁止自我挂起。
- 审计记录保存操作者、原因、trace、资源和 JSON 前后状态；数据库触发器及 role 权限拒绝审计行更新/删除。

LM3-31 才负责 `clients/apps/admin`、跨域 reporting/read-model 和运营查询；本轮不增加 C 端页面、不跨 schema JOIN、不执行退款、付款、供应商调用或通用报表同步。

## 运行与配置

开发 Compose 默认使用进程内临时 Admin RSA key，重启会使旧 admin token 失效，适合本地测试。生产必须挂载仅给 `admin-bff` 的 `ADMIN_JWT_PRIVATE_KEY_FILE` 和 `ADMIN_JWT_JWKS_FILE`，设置 `ADMIN_JWT_ACTIVE_KID`，且 JWKS 必须包含与私钥匹配的当前 key 和保留公钥。不得复用 Auth/Web key set，也不得把私钥提交至 Git、Compose 默认文件或客户端。

迁移不创建默认管理员，也没有公开 bootstrap API。首个管理员由受控离线运维流程创建，密码仅以 bcrypt hash 写入 `admin.principals`，并只授予所需最小角色。生产在 Kong 增加 Admin 的独立 JWT credential 前，保持该入口为内网/受控入口；绝不能把 C 端 Cookie JWT 作为兼容回退。

## 验证与回滚

```bash
cd dramaip-platform/services
buf lint
go test ./app/admin/interface/... ./pkg/platform

cd ../
docker compose -f deploy/docker-drama/docker-compose.yaml config --quiet
helm template dramaip deploy/helm/dramaip-platform \
  --values deploy/helm/dramaip-platform/values-dev.yaml \
  --set devInfra.persistence.enabled=false
```

测试覆盖 C 端 token 拒绝、Admin session 撤销、角色越权、二次确认、审计前后状态与 HTTP 路由。健康的 staging 环境还应使用由受控运维创建的测试管理员，验证 Kong 路由、独立 JWKS、RBAC 与审计触发器；当前用户拥有的本地 Compose 栈未被启动、停止或重建。

回滚时先在 Kong 禁用 `/v1/admin` 写路由或缩至内网，再回滚 admin-bff 应用；保留 `admin.audit_logs`、确认和 session 审计记录，绝不通过删除审计数据回滚。数据库迁移是前向新增，恢复期间可关闭管理写操作，但不应让 C 端 BFF 接管该接口。
