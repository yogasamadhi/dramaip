# Loop Engineering Rules

本文档定义 Astra 项目中可重复使用的 Loop Engineering 执行规则。适用于迁移、
功能开发、重构、验证补齐、文档收口和 release baseline 工作。

## 1. 核心定义

Loop Engineering 是一种小闭环工程方法：

1. 每个 loop 只完成一个明确目标。
2. 每个 loop 必须有清晰范围、验收标准和验证方式。
3. 每个 loop 完成后必须审查 diff、运行测试、提交代码。
4. 每个 loop 提交后必须同步远程分支并推送。
5. 任一 loop 失败时，应停在可审计状态，先修复或明确记录阻塞原因。

一个 loop 的交付物可以是一个功能点、一个迁移切片、一个验证入口、一个文档闭环
或一个 release gate。不要把多个无关目标混进同一个 loop。

## 2. 标准 Loop 流程

每个 loop 必须按以下顺序执行。

### 2.1 同步远程

开始前先同步目标分支：

```bash
git fetch origin
git status --short --branch
```

如果 `origin/<branch>` 有新提交，先合并远程分支：

```bash
git merge --no-edit origin/<branch>
```

禁止用会丢失他人提交的方式推进，例如未经明确授权的 `git reset --hard`、
强推或覆盖远端历史。

### 2.2 执行单个 loop

执行时必须控制范围：

- 只改本 loop 所需文件。
- 不顺手做无关重构。
- 不迁移缓存、构建产物、本地虚拟环境、密钥或临时文件。
- legacy 目录只允许 README、ROADMAP、兼容说明或极薄 wrapper，除非有明确安全修复理由。

### 2.3 本地验证

每个 loop 至少运行与变更直接相关的最小验证。

常见验证包括：

```bash
git diff --check
scripts/ci/check-legacy-freeze.sh
scripts/hub/test-migrated-services.sh
scripts/hub/test-hub-suites.sh
go test ./...
pnpm run typecheck
python3 -m py_compile <file>
```

验证范围按风险扩大：

- 文档-only loop：至少 `git diff --check`，涉及 legacy 时加 freeze check。
- 单模块 loop：运行该模块测试或编译检查。
- 共享脚本、公共协议、迁移边界 loop：运行相关集成或总回归。
- release/final loop：运行全量约定回归，并记录验证命令。

### 2.4 审查 diff

提交前必须审查：

```bash
git status --short
git diff --check
git diff
```

确认：

- 没有未预期文件。
- 没有凭据、token、密码、`.env`、`.venv`、`node_modules`、`__pycache__`、`.DS_Store`。
- 没有误改用户或远端合入的无关内容。
- 文档中的路径和命令能对应真实仓库路径。

### 2.5 提交

每个 loop 一个 commit。提交信息建议包含 loop 编号和动作：

```bash
git add <files>
git commit -m "loop2(14): add nova health smoke"
```

提交应满足：

- 一个 commit 对应一个可解释的 loop。
- commit 可单独审查、回滚和验证。
- 不把“未完成”状态提交成完成状态。

### 2.6 再次同步远程

提交后必须再次同步远程：

```bash
git fetch origin
git status --short --branch
```

如果远程有新提交，先合并：

```bash
git merge --no-edit origin/<branch>
```

合并后必须重新运行受影响测试。若远端变更与当前 loop 无关，至少重新运行本 loop
验证和关键 smoke；若涉及共享模块或测试基础设施，运行更大范围回归。

### 2.7 推送远程

测试和审查通过后推送：

```bash
git push origin <branch>
```

推送后确认本地与远端对齐：

```bash
git status --short --branch
```

目标状态应无 ahead/behind，或明确记录无法推送的原因。

## 3. Loop 文档要求

迁移或复杂开发应维护 LOOPMAP 类文档，至少包含：

| 字段 | 含义 |
| --- | --- |
| Loop | 编号，如 `L2-14` |
| Owner | 负责人或执行角色 |
| 状态 | `todo`、`doing`、`partial`、`done` |
| 目标 | 本 loop 要完成什么 |
| 主要范围 | 涉及目录、模块或文件 |
| 验收 | 可验证的完成标准 |

状态规则：

- `todo`: 尚未开始。
- `doing`: 当前正在执行。
- `partial`: 已做一部分，但未满足验收。
- `done`: 已实现、验证、审查、提交并推送远程。

注意：如果代码已提交但未推送，loop 不应视为完整闭环，只能算本地完成。

## 4. 远程协作规则

多人或多 agent 协作时：

- 每个 loop 开始和结束都要 `git fetch origin`。
- 推送前必须合并远端新提交，禁止覆盖别人提交。
- 如果远端频繁变化，以“先合远端、再测、再推”为准。
- 合并远端后，相关测试必须重跑。
- 推送成功后再宣告 loop 完成。

推荐最终确认：

```bash
git log --oneline --decorate --max-count=8
git status --short --branch
```

## 5. 测试与审查分级

### 5.1 最小验证

适用于低风险文档或局部脚本变更：

```bash
git diff --check
```

### 5.2 模块验证

适用于单模块代码变更：

```bash
go test ./<module>/...
pnpm run typecheck
python3 -m compileall <package>
```

### 5.3 迁移基线验证

适用于 Hub 迁移相关变更：

```bash
scripts/ci/check-legacy-freeze.sh
scripts/hub/test-migrated-services.sh
```

### 5.4 全量 Hub 验证

适用于 release、兼容层、共享协议或跨模块变更：

```bash
scripts/hub/test-hub-suites.sh
scripts/hub/test-migrated-services.sh
```

## 6. 安全与凭据规则

- 不把密码、token、cookie、私钥写入文件或 commit。
- 不把密码放进 shell 命令参数。
- 如果必须临时输入凭据，只通过交互式提示输入。
- 凭据一旦出现在聊天、日志或终端记录中，应尽快轮换。
- `.env` 只允许提交 `.env.example`。

## 7. Legacy 迁移规则

Legacy 目录默认 read-only：

- 新功能必须进入新目标目录。
- legacy 只保留冻结快照、README 指引、ROADMAP、兼容说明或极薄 wrapper。
- 删除 legacy 前必须有替代路径、验证命令、release note 和删除计划。
- 删除 legacy 前至少经过一个 release 周期。

Hub legacy freeze 检查：

```bash
scripts/ci/check-legacy-freeze.sh
```

## 8. 完成定义

一个 loop 只有同时满足以下条件，才算完成：

1. 目标实现。
2. 文档状态更新。
3. 本地验证通过。
4. diff 审查通过。
5. commit 已创建。
6. 已合并远程最新分支。
7. 合并后必要测试通过。
8. 已推送到远程分支。
9. `git status --short --branch` 显示本地与远端对齐。

最终总结必须说明：

- 完成了哪些 loop。
- 运行了哪些测试。
- 是否已推送远程。
- 当前分支和远端状态。
- 如有未完成或 skip，说明原因。
