# Agent 使用分析

Agent 使用分析（Agent Usage Analyzer）是一套本地优先的个人工程复盘工具。它把编码 Agent 的会话、工具与 Skill 使用、Token 结构和任务过程整理成可核对的数据，由 LLM 结合本地证据解释工作方式，并持续追踪改进计划是否真的产生了变化。

当前对 Codex 的支持最完整；同时可导入 Claude Code、Cursor、GitHub Copilot CLI 和 GitHub Copilot 的本地历史记录。

## 它能回答什么

- 最近一天、7 天或 30 天使用了多少会话、主任务、子 Agent、工具、Skill 和 Token？
- 哪些项目、长会话或频繁切换正在消耗最多注意力？
- Skill 与工具是如何被使用的，是否存在重复流程或更合适的组合？
- AGENTS.md 等固定上下文文档是否过长、重复，或没有带来可观察收益？
- 提示词、任务边界、约束和完成定义有哪些稳定优势或反复出现的问题？
- 当前官方资料和社区实践支持哪些做法，分别适用于什么场景？
- 哪些改进计划值得在下一批相似任务中观察，后续证据是否支持原假设？

## 快速开始

要求 Node.js 18+、pnpm 8+。直接通过 npm 运行：

```sh
npx --yes agent-usage-analyze start
```

从源码开发或验证本地修改时：

```sh
pnpm install --frozen-lockfile
pnpm build
npm install --global ./cli
agent-usage-analyze start
```

首次启动会依次完成：

1. 初始化仅当前用户可访问的本地数据目录；
2. 导入支持的 Agent 历史；
3. 安装或更新 Codex 自动采集 Hook；
4. 在后台分析最近的可用会话；
5. 启动只监听 `127.0.0.1` 的 WebUI。

历史较多时，首次导入会继续在后台运行，页面顶部会显示进度和预计剩余时间。如需在终端等待导入完成：

```sh
agent-usage-analyze start --wait-for-import
```

首次安装 Hook 后，Codex 可能要求在 `/hooks` 中确认信任。工具不能代替用户完成这一安全授权。

## WebUI 信息架构

| 页面 | 用途 |
| --- | --- |
| 总览 | 先看最近最值得关注的变化和正在观察的改进，再查看使用统计 |
| 分析 | 查看最近 30 天的跨会话使用总结、优势、限制因素、动态行为维度和证据边界 |
| 改进追踪 | 查看适用任务、观察进度、用户纠正和独立复盘结果 |
| 实践库 | 按来源可信度、时效、讨论广度和本地相关性浏览当前证据支持的做法 |
| 活动记录 | 按项目和时间浏览会话，并核对本地元数据、LLM 分析记录及证据链 |
| 设置 | 控制自动采集、会话分析、跨会话报告和公开实践研究；可选配置自己的模型服务 |

界面支持简体中文和英文，语言与主题选择只保存在本机。

## 数据如何自动更新

自动更新包括五个阶段：

### 1. 会话记录

Codex 的受信任 `UserPromptSubmit` / `Stop` Hook 会登记最新可分析位置并启动后台处理。

WebUI 服务运行期间会同步监听 Codex 会话目录。新会话通常会在文件稳定后的数秒内出现在“活动记录”页面。

### 2. 单会话分析

会话稳定导入后，后台任务生成摘要、经验、决策、Skill 使用评估和提示词质量。关闭“会话级 LLM 分析”后，本地统计和原始会话记录仍会更新。

### 3. 30 天跨会话报告

每次稳定导入后，调度器都会检查是否需要更新报告，但只有同时满足以下条件才自动生成：

- 已开启“每日跨会话报告”；
- 最近 30 天存在足够的结构化证据；
- 上次成功报告之后出现了新会话证据；
- 距离上一次生成尝试已满 24 小时。

出现新证据且距离上次尝试已满 24 小时后，系统会更新报告。页面显示报告生成时间和本次纳入的最新证据时间；用户也可以在分析页面手动重新分析。

### 4. 公开实践研究

公开研究需要在首次引导中授权，也可以随时在设置中关闭。首次授权后会建立通用实践快照；已有本地分析时，LLM 会提炼通过隐私检查的抽象主题标签，用于更新与当前工作方式相关的公开资料。

每条资料分别展示来源可信度、独立佐证、可复现细节、讨论广度、时效和适用范围。社区资料可以在证据充分时获得高可信度；热度作为独立参考项展示。本地效果需要通过改进追踪复盘。

### 5. 改进追踪

跨会话分析和实践库都可以提供候选依据。LLM 负责定义适用任务、观察信号、护栏、与现有计划的重叠关系及复盘条件。系统最多同时追踪 3 个活跃计划，每项最多观察 30 个适用任务或 45 天。达到复盘条件后，由独立 LLM 根据起点、后续观察和用户纠正给出结论。

## 本地统计与 LLM 分析的边界

本地确定性统计不依赖模型，包括会话时间、消息、工具事件、Skill 显式调用、Token 事件、项目路径和可观察的 Git/交付证据。

LLM 用于单会话分析、跨会话归纳、公开主题提炼、实践研究和改进复盘。模型结合当前证据、反例、资料时效和适用范围生成分析维度、候选做法和观察条件，并在证据不足时保留不确定性。

默认优先复用已登录的 Codex 能力。用户也可以在设置页填写自己的模型服务。会话导入和本地统计可以独立运行。

## 隐私与数据

- WebUI 仅监听 `127.0.0.1`。
- 会话、分析结果、队列和日志保存在本机。
- 本地数据目录以设置页面显示的实际路径为准；新安装默认使用 `~/.agent-usage-analyze/`。
- 产品遥测默认关闭。
- 跨会话模型输入使用受限、脱敏的结构化数据；不会把全部原始会话、Thinking 或工具结果正文直接作为报告输入。
- 公开研究只接收经 LLM 提炼并通过本地隐私门的抽象主题标签，不接收原始提示词、代码、日志、仓库名或本地路径。
- Codex 登录模式复用现有订阅能力，并受当前套餐限制。

第三方来源、许可证与本地修改边界见 [UPSTREAM.md](UPSTREAM.md) 和 [LICENSE](LICENSE)。

## 常用命令

```sh
# 启动、同步并打开 WebUI
agent-usage-analyze start

# 查看服务、Hook、数据和分析能力状态
agent-usage-analyze status

# 诊断自动导入与本地环境
agent-usage-analyze doctor --verbose

# 不自动打开浏览器
agent-usage-analyze start --no-open

# 本次启动不安装 Hook
agent-usage-analyze start --no-hook

# 本次启动不回填历史
agent-usage-analyze start --no-import

# 卸载 Hook、停止本地服务并永久删除本产品的本地数据
agent-usage-analyze uninstall
```

高级的队列、模型执行策略和故障恢复说明见 [Codex 自动分析](docs/codex-zero-config-analysis.md)。实践研究与改进追踪的数据边界见 [实践研究与改进追踪](docs/practice-research-and-improvement-tracking.md)。本地数据的导出、归档、恢复与重建见 [本地数据生命周期](docs/local-data-lifecycle.md)。

## 新会话没有出现

按以下顺序检查：

1. 确认服务仍在运行，并在设置页确认“Hook 实时采集”已开启；
2. 打开 Codex `/hooks`，确认 Agent 使用分析的 `UserPromptSubmit` / `Stop` Hook 已安装且受信任；
3. 运行 `agent-usage-analyze doctor --verbose`；
4. 查看本地数据目录中的 `session-ingestion.log`、`settled-analysis.log` 和 `hook-analysis.log`；
5. 处理提示的问题后重新结束一个测试会话，确认它出现在“活动记录”页面。

`session-ingestion.log` 只记录采集阶段、结果、会话标识和诊断信息，不写入对话正文，并在达到大小上限后轮转。

## 从源码开发

要求 Node.js 18+、pnpm 8+。

```sh
pnpm install
pnpm test
pnpm build
```

发布前使用串行测试与本地安全审计：

```sh
pnpm test:release
pnpm release:check-publish
pnpm audit:v1
pnpm package:smoke
git diff --check
```

工作区包含 `cli`、`server` 和 `dashboard` 三个包。CLI 负责导入、Hook、队列、LLM 分析、实践研究和改进观察；Server 提供 loopback API 与事件监听；Dashboard 提供总览、分析、改进追踪、实践库、活动记录和设置界面。

首次人工发布、npm Trusted Publisher 与后续 tag 自动发布的完整步骤见
[npm 发布](docs/npm-publishing.md)。

## 产品原则

- 本地事实与模型解释分层展示；
- 每项结论保留证据来源、适用范围和置信度；
- 改进计划支持暂停、纠正和复盘；
- 公开资料的可信度、热度、时效和本地效果分别展示；
- 分析器自身的 Token、时间和计算消耗单独展示。
