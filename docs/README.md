# 尽意 DramaIP 文档索引

## 品牌与产品

- [品牌与文案规范](./product/BRAND.md)
- [项目定义](./product/PROJECT_BRIEF.md)
- [产品路线图](./product/ROADMAP.md)
- [创意竞争力系统](./product/CREATIVE_INTELLIGENCE.md)

## Desktop 架构

文档权威关系：

```text
DramaIP Target Architecture
        │ defines product target and red lines
        ▼
Desktop Current Architecture
        │ describes implemented facts
        ▼
Architecture Roadmap
        │ tracks gaps and delivery order
        ▼
Level 1 / 2 / 3
        └── generic selection references
```

- [Desktop 架构文档目录](./architecture/desktop/README.md)
- [DramaIP Client / Plugin Runtime 目标架构](./architecture/desktop/DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md)
- [DramaIP Desktop 当前实现](../desktop/docs/engineering/ARCHITECTURE.md)
- [DramaIP Desktop 架构路线图](./architecture/desktop/DESKTOP_ARCHITECTURE_ROADMAP.md)
- [通用桌面架构基线](./architecture/desktop/DESKTOP_ARCHITECTURE_BASELINE.md)
- [Level 1：小型项目](./architecture/desktop/DESKTOP_ARCHITECTURE_LEVEL1_SMALL_FINAL.md)
- [Level 2：大型封闭项目](./architecture/desktop/DESKTOP_ARCHITECTURE_LEVEL2_LARGE_CLOSED_FINAL.md)
- [Level 3：大型开放项目](./architecture/desktop/DESKTOP_ARCHITECTURE_LEVEL3_LARGE_OPEN_FINAL.md)

实现决策以 DramaIP 目标架构为准；判断当前代码能力时以 Desktop 当前实现说明和代码为准。Level 文档用于选择通用复杂度，不表示质量排名。

## Platform

- [平台后端技术架构](./后端技术架构.md)
- [创意竞争力系统说明](./product/CREATIVE_INTELLIGENCE.md)
- [创意语料治理与下架手册](../platform/docs/CREATIVE_CORPUS_OPERATIONS.md)
- [项目包 schema v4](../desktop/docs/engineering/PROJECT_PACKAGE_V4.md)

Platform 发布通过 `platform/deploy/release/` 中的脚本完成；不要引用已删除的旧发布启动器或文档。
