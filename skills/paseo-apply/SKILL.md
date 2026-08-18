---
name: paseo-apply
description: 用 Paseo 并行实施 OpenSpec change。适用于用户运行 paseo-apply、要求多 Agent apply，或明确要求 Sol 主导、Grok 编码、Luna 审查的 OpenSpec 实施。
---

# Paseo Apply

把一个 OpenSpec change 实施到可交给 verify 的状态。当前 Agent 是 Lead：负责理解规格、冻结契约、拆分依赖、调度、集成与最终验收；实现默认交给 Paseo workers。

**用户参数：** $ARGUMENTS

## 准备

1. 读取 **paseo** skill，并调用 `list_profiles`。完整读取每个 Profile 的 `notes`，再选择角色；不要猜 provider 或 model ID。
2. 解析 change：优先使用参数；未指定时，仅在恰好一个 active change 时自动选择，否则请用户指定。
3. 读取该 change 的 proposal、design、specs、tasks，以及仓库自己的 Agent 指令。确认未完成任务、验收条件和当前 Git 状态。
4. Worktree 只能从稳定提交派生。若 change、共享契约或相关用户改动尚未提交，先停下并说明哪些内容不会出现在 worker worktree 中；保留所有无关改动。

## 角色路由

按 Profile 的实际配置和 `notes` 匹配角色；名称只作为提示，不作为硬编码依赖：

- **Lead / Sol**：当前 Agent；负责规格、架构、任务 DAG、契约、集成决策和终审，通常不承担实现包。
- **Core Engineer / Grok Build**：后端、数据库、API、领域逻辑、重构、CLI、基础设施与性能。
- **Product Engineer / Cursor Grok**：Web、管理后台、Expo、移动端、组件、交互与浏览器验收。
- **Reviewer / Luna**：第一轮 diff、测试、类型、lint、范围与明显缺陷审查；只审查，不实现。

用户指定 Profile 时优先使用。缺少匹配 Profile 时，按 **paseo** skill 使用 provider discovery 选择已就绪 provider，并明确报告回退；没有合适 worker 时不要让 Lead 静默代写。

## 建立执行波次

把未完成 checkbox 合并成少量内聚工作包，不要一个 checkbox 创建一个 Agent。依次判断：

1. 显式依赖：tasks、design 或 specs 已声明的前置关系。
2. 契约依赖：schema、API、类型、权限和状态机先由 Lead 固定；固定后，后端与产品端可按同一契约并行。
3. 文件所有权：同一文件或强耦合模块归入同一工作包，避免制造合并冲突。
4. 验证依赖：集成测试、端到端测试和迁移验证放在依赖实现之后。

只并行执行当前无前置依赖的工作包。下一波必须等待所依赖的提交完成并集成。

## 派发实现

每个工作包创建独立的 branch-off worktree，再通过 `create_agent` 启动匹配 worker。Prompt 必须自包含，并包含：

- change 名称、工作包范围、规格与契约路径；
- 独占文件或模块，以及必须保留的相邻行为；
- 可检查的验收条件和最小验证命令；
- 要求提交聚焦改动并返回 commit SHA、验证结果和未验证项；
- 要求保持 `tasks.md` 不变，由 Lead 在集成验证后统一勾选；
- 要求 worker 自己完成工作包，不再创建或委派 subagents。

同一波全部异步启动并等待完成通知；不要轮询。Worker 失败、越界或缺少证据时，使用 `send_agent_prompt` 让原 worker 修复，保留其上下文。

## 审查与集成

每个实现提交完成后：

1. 在对应 worktree 启动 Luna Reviewer，给出基线 commit、候选 commit、任务范围和规格路径；要求只读审查并按严重度报告问题。
2. 有阻塞问题时，把审查意见发回原 worker；修复后复审。无阻塞问题才进入集成。
3. Lead 将通过审查的提交按依赖顺序集成到当前分支。冲突由 Lead 按已冻结契约裁决，不把冲突修复并行派给多个 worker。
4. 每完成一波，运行该波需要的最小集成验证；失败时定位到责任工作包并让原 worker 修复。

## 完成门

全部工作包集成后，由 Lead：

1. 对照 proposal、design、specs 和每个未完成 task 做最终差异审查。
2. 运行仓库要求的测试、类型检查、lint 和必要的构建；产品界面按仓库浏览器规则验收。无法执行的外部或浏览器验证标记为 `unverified`。
3. 只为已实现且已有验证证据的任务更新 `tasks.md`；未完成项保持未勾选并写明阻塞。
4. 报告已集成 commits、验证结果、未验证项和剩余 tasks。

到这里停止。`verify`、`sync` 和 `archive` 是独立阶段，除非用户明确要求，否则不要自动执行。
