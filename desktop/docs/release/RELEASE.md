# 发布检查清单

发布前除技术与签名检查外，还应核对商店文案、更新说明和截图是否遵循 [产品定位](../../../docs/product/POSITIONING.md)：小说是可独立完成稿件/投稿的一等能力，改编与剧本是转化核心；作者意图、叙事质量、连续性、版本与来源贯穿两路，媒体是可替换的生产出口。不承诺“一键爆款”“全自动成片”“必然能拍”或离线模型推理。

产品验收分别覆盖小说“连续写作 → 采用 → 记忆 → 稿件导出”和改编“剧本 → 分镜 → 试制交付”，不以媒体完成衡量小说成功。计划中的独立诊断、整季方案、新入口与指标必须有对应代码和真实证据才可进入发布文案；规则、模拟、真实模型和真人评估分开标注。旧 v2 RC/版本说明保留历史语境，当前版本以 `desktop/package.json` 和当次发布审批为准。

1. 运行 `bun run lint`、`bun run format:check`、`bun run typecheck`、`bun run test`、`bun run test:e2e`、`bun run check:generated`、`bun run check:architecture`、`bun run check:engine-locks`、`bun run check:provider-catalog` 和 `bun run build`。
2. 设置真实 `DRAMAIP_UPDATE_URL`，分别在 macOS、Windows、Linux 运行 `bun run package`。
3. 启动每个平台的安装包，验证 `/api/v2/runtime` 与 `/api/v2/system/diagnostics` 中的 Profile、Bundle、插件顺序、迁移、Host 和 Pi、Codex、LangGraph.js 三个引擎健康状态；确认 `dramaip.db` 可写，退出后没有残留进程。
4. 校验 Pi 0.84.2、Codex 0.147.0 与 LangGraph.js 1.4.9 的打包资源、锁定摘要、协议快照及第三方许可证；校验 DSH 框架源码快照完整性及九个框架包的打包资源和许可证，DSH Agent 业务实现不得进入安装包。
5. 验证 Renderer 不含业务 `fetch` 或 IPC 方法、preload 只含 Runtime bootstrap、Renderer 只使用生成的 `@dramaip/client`；确认 Core Runtime 未在 Electron Main 内启动，HTTP API 为 `/api/v2`，并验证 Node 24.18.0 Server Mode（Bun 只负责启动调度，不是 Core Runtime）。
6. 发布前完成三平台代码签名；macOS 还必须完成公证。
7. GitLab 的 `desktop_macos_release` 与 `desktop_windows_release` 只在标签流水线上运行；发布前必须确认项目已配置带 `macos`、`windows` 和 `private` 标签的对应 Runner。
8. 对每个平台产出的安装应用再运行 Electron 端到端测试；可通过 `DRAMAIP_E2E_EXECUTABLE` 指定已打包应用的可执行文件。使用本次源码生成的新候选和独立 `DRAMAIP_E2E_USER_DATA`；测试启动器自动设置 `DRAMAIP_DEBUG_BACKGROUND=1`，安装应用也必须保持后台。先运行 `tests/electron/background-debug.spec.ts` 核对隐藏／不聚焦及原生窗口保护，再执行相关业务测试。不要对维护者普通实例或不含后台修复的历史包执行本测试。
9. 每次修改应用版本号时，都必须按目录中记录的官方来源核对常用服务商、模型标识和下线公告，并同步更新 `MODEL_PROVIDER_CATALOG_RELEASE` 与 `MODEL_PROVIDER_CATALOG_UPDATED_AT`；否则发布检查会失败。
10. 对会触发 3.0 首次启动的候选包执行数据库 cutover smoke test，并按 [v3 回滚说明](./ROLLBACK_V3.md) 验证备份 manifest 和手动回退流程。

证据记录使用 [未执行模板](./evidence-template.json)。默认 `status=not-run`，候选 commit、实际执行时间、脱敏环境／步骤／结果、原受管证据摘要、敏感信息核对与发布批准均为 `null`。复制模板不表示执行、通过或已经批准；只有对应验收实际完成并核对范围后才能填入结论，缺项保持未知／未完成。日志／摘要并不自行证明模型身份、文学质量、账单、权利或签名／安装成功。不同源码、构建、设备或分开的测试轮次分别记录，不拼成一次成功。

原始证据保留在受管环境，仓库只保留经审查的最小脱敏记录；不加入正文、Prompt、账号、凭据、路径、媒体 URL 或原账单。历史 v2 RC 文档与当前代码验收分开，不拿模板或旧 release 记录作为 v3 alpha 的 GA 证据。完整模型、用户、授权、设备／签名与发行批准仍按根 PLAN 第 16.2 节后置，本地工程验证可以先做。

## 当前本地准备证据（2026-10-07，非发布通过）

PLAN22.208另补当前Host的组合实测：两路偏移视频／5帧间隙／三类共享音源／两段字幕、原键不换输入及在途取消无迟到发布，原7项加2项共9项通过；33工作区类型、lint与格式通过。只使用本机现有工具和隔离测试签名／字体，未启动应用、重打包或变更发行信任key，不能当目标设备或字体发行许可证明。字幕能力仍须操作方提供实际可信签名字体包及许可；没有配置则保持不可用，不搜索／分发OS字体、不影响独立小说与明确无字幕输出，也不据此签发Media Gate。

PLAN22.206修复已打包应用忽略后台调试标志的问题，并让原后台窗口测试支持 `DRAMAIP_E2E_EXECUTABLE`。本次122项Main测试、33工作区类型检查、构建、正常lint和renderer-chunks通过；新开发构建的隔离后台测试1/1通过，无跳过／重试／快照更新。该测试实际核对窗口隐藏、不聚焦、不可聚焦，以及文件选择／保存／外部应用／文件揭示四项保护；没有运行打包应用。真实更新源未配置，未用占位地址绕过package；新安装包、签名／公证和目标设备验收仍未完成。

维护者可先在`desktop/`使用锁定Node24.18.0运行`bun run release:inspect`。它只读当前版本update清单与安装文件全字节，分开历史清单，另比较旁置mac解包应用的Runtime及app.asar自有编译文件、只读检查codesign身份。检查不会安装、启动、更新或签名，也不验证安装文件与旁置app相同、源码构建来源或依赖库存；exit0只表示检查完成，`releaseReady`始终false。公证和macOS／Windows／Linux安装、升级、恢复保持未查／未运行，仍需上面实际验收及批准。

PLAN22.200实际检查当前同版号旧alpha清单的ZIP／DMG，完整字节摘要与清单一致，但旁置解包Runtime有477/832自有文件不同、Main／Renderer有33/44不同，签名只是ad-hoc。原JSON在本地`desktop/build/m5-release-candidate-inspection.json`，不是已发行证据；修复清单生成器不会使这些旧文件变成当前版本。

PLAN22.201已修复`release:metadata`递归混入历史产物与依赖门前输出的问题。现行命令只收顶层当前product／version安装文件、当前update清单与存在的对应blockmap；未被updater引用的本版Windows ZIP／Linux DEB也收录，旧包／解包app／debug／旧metadata不递归纳入或改动。所有输入／最低20唯一依赖组件门通过、暂存文档与原字节复核后，只向新目录无覆盖写出SHA256SUMS、sbom.cdx.json、THIRD_PARTY_LICENSES.json及最后release-inventory.json；已有目录拒绝，请明确选择新候选与新metadata目录（DRAMAIP_RELEASE_ARTIFACT_DIR／DRAMAIP_RELEASE_METADATA_DIR），不要自动删除旧产物。依赖库存只定位本Desktop已安装依赖，不证明完整打包依赖或法律许可；库存回执releaseReady=false，命令成功不是发行批准。10项新增测试及原候选／研究回归只在临时惰性fixture验证，没有对现有候选运行真实生成／package／安装／更新。后续获准发布仍按上面第2–10项先完成独立的新package、设备与签名／公证验收，再生成metadata审查范围。

PLAN22.183已收A09.2验收版最终完整normal2原33476真实exit0：Runtime1051/57、App663、Main66、33类型／真实Worker／全部conformance、961列举输入首末一致及独立末门通过；普通NLE原媒体包末版后台3/3、20协调／回执与构建／静态门另留证。独立root17、离线Platform Java verify64、客户端四工作区检查／各测试／Web和Admin构建、10镜像清单与14项Web静态路由也通过，不混作Desktop验收或真实平台运行证明；后续改源不能借用该版完整结果。

PLAN22.182另记录当前构建的隔离Node HMR终态：五Profile／迁移超时与原生图恢复命令、六来源入口×三在途生命周期的18项原矩阵及新进程回执重放，两个独立命令实际exit0。只在临时副本操作、没有重建共享产物或打开Electron窗口；不替代当前完整normal2、完整Electron目录、安装包测试或发布批准，受控模型协议不认证真实模型身份。

这些检查没有执行签名、公证、三平台package、安装／升级、真实更新下载、生产模型／审片／支付或部署。未编造DRAMAIP_UPDATE_URL、安装包commit、批准或已运行的证据JSON；原模板仍not-run。当前普通脏工作区、缺真实设备／更新源／签名材料与批准的条件继续保留。对未来候选安装包须按上面第2–10项逐项真实执行，尤其使用自己的隔离用户目录验证cutover备份／回退和退出清理，不能接触维护者普通应用实例；不能用开发构建的后台重启或旧RC证据替代。
