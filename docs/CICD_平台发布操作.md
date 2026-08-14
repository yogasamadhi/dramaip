# DramaIP Staging GitOps 发布操作

平台代码在 GitLab 合并到受保护的 `main` 后，只执行验证与 SonarQube
质量门禁；它不会自动部署。Staging 发布只能由仓库根目录的
`run-platform-cicd.py` 发起。该入口不保存 Harbor/GitLab Token，也不执行
`kubectl apply` 或 `helm upgrade`。

## 管理员前置条件

按 `GitLab_CICD_完整教程.md` 完成 GitLab、Runner、Harbor、SonarQube 和 Argo
CD 安装后，管理员需要手工创建：

- GitLab 项目 `platform/dramaip` 与空项目 `platform/dramaip-gitops`；
- Harbor 私有项目 `dramaip`，本机发布者使用 Push Robot 登录，Kubernetes 使用仅 Pull Robot；
- `dramaip-staging` 命名空间中的 runtime、Registry Pull、Ingress TLS Secret；
- Argo CD 到 GitOps 仓库的只读凭据、GitOps `main` 保护规则和允许发布者直推的 `staging` 分支；
- Harbor 中固定版本的 JDK 21、Maven、Node、Desktop Node、Docker、Trivy、Helm 和 SonarScanner 工具镜像。

本机需要预先执行 `docker login harbor.home.arpa`，并通过 `ssh-add -l` 确认
GitLab SSH Key 已加载。不要把密码、Robot Token、GitLab Token 或 kubeconfig
提交到仓库。

## 首次初始化

克隆管理员手工创建的空 GitOps 仓库后，执行一次 Bootstrap。以下端点均为示例，
必须替换为实际 Staging 端点：

```bash
python3 run-platform-cicd.py bootstrap \
  --gitops-dir ../dramaip-gitops \
  --apply \
  --postgres-host postgres.staging.internal \
  --redis-addr redis.staging.internal:6379 \
  --rabbitmq-host rabbitmq.staging.internal \
  --otel-endpoint https://otel-collector.staging.internal:4318 \
  --ingress-host api.staging.example.com \
  --web-origin https://app.staging.example.com \
  --admin-origin https://admin.staging.example.com
```

Bootstrap 会用当前 Chart 初始化 GitOps 的 `main` 与 `staging`。管理员在确认
GitOps `main` 后，手工应用一次根 Application；后续不得由本机脚本直接应用
Kubernetes 资源。

### Chart 所有权迁移

Bootstrap 是一次性的迁移种子：它会排除源码中的 Dev、Staging 和临时 Staging Values、
开发基础设施模板和可生成 Secret 的模板，并把默认示例凭据清空。生成的 GitOps
Chart 只允许引用管理员创建的 Secret。确认 GitOps `main` 已推送并通过 CI 后，
后续对 Chart 的修改只能在 `platform/dramaip-gitops` 完成；源码树中的 Chart 仅在
这个迁移完成前保留为种子。此时创建一个独立的源码 Merge Request 删除
`platform/deploy/helm/dramaip-platform`；不要在 GitOps 初始化成功前删除它。
遗留人工脚本需设置 `DRAMAIP_GITOPS_DIR=../dramaip-gitops`，以读取 GitOps Chart。

## 日常发布与回滚

```bash
python3 run-platform-cicd.py check --gitops-dir ../dramaip-gitops
python3 run-platform-cicd.py verify --gitops-dir ../dramaip-gitops
python3 run-platform-cicd.py update-trivy-db
python3 run-platform-cicd.py release --gitops-dir ../dramaip-gitops --dry-run
python3 run-platform-cicd.py release --gitops-dir ../dramaip-gitops
```

`release` 只接受干净的源码 `main` 和 GitOps `staging`。它构建全部 19 个同一
Commit SHA 镜像、扫描全部镜像、全部通过后才推送 Harbor，然后 fast-forward
GitOps `staging` 并更新全部镜像引用。最后等待 Argo CD 同步成功。
Trivy 的逐镜像 JSON 与 `index.json` 保存在
`${XDG_CACHE_HOME:-~/.cache}/dramaip/trivy-reports/sha-<commit>`，便于审核。
`--dry-run` 会实际执行 `check` 与 `verify`，但不会构建、推送、提交 GitOps 或写入
Kubernetes。

发布入口自身的离线回归可以使用：

```bash
python3 -m py_compile run-platform-cicd.py
python3 -m unittest tests/test_run_platform_cicd.py
```

回滚只修改 GitOps：

```bash
python3 run-platform-cicd.py rollback \
  --gitops-dir ../dramaip-gitops \
  --commit <错误的GitOps发布提交>
```

该命令创建 `rollback/staging-*` 分支。创建并合并到 `staging` 的 Merge Request
后，Argo CD 才会执行回滚。
