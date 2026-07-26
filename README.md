# Agent 使用分析

Agent 使用分析（Agent Usage Analyzer）是一套本地优先的个人工程分析工具。它把编码 Agent 的会话、工具与 Skill 使用、Token 结构和任务过程整理成可核对的数据，并在证据充分时生成能力分析与行动建议。

当前对 Codex 的支持最完整；同时可导入 Claude Code、Cursor、GitHub Copilot CLI 和 GitHub Copilot 的本地历史记录。

## 它能回答什么

- 最近一天、7 天或 30 天使用了多少会话、主任务、子 Agent、工具、Skill 和 Token？
- 哪些项目、长会话或频繁切换正在消耗最多注意力？
- Skill 与工具是如何被使用的，是否存在重复流程或更合适的组合？
- AGENTS.md 等固定上下文文档是否过长、重复，或没有带来可观察收益？
- 提示词、任务边界、约束和完成定义有哪些稳定优势或反复出现的问题？
- 哪些改进建议有足够证据，值得在下一批相似任务中验证？

它不会把单一规则命中直接解释成能力高低，也不会把“未观察到验证事件”当成“没有验证”。Xcode、Android Studio、真机操作和浏览器人工检查等外部行为，在没有结构化证据时会明确标记为未记录。

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
| 总览 | 查看当天、7 天和 30 天的使用规模、Token 组成、会话时长、工具与 Skill 趋势 |
| 能力 | 查看最近 30 天的跨会话工程画像、优势、限制因素、动态行为维度和证据边界 |
| 行动 | 把有充分证据的观察转成可采纳、忽略、关闭或静音的实验性建议 |
| 记录 | 按项目和时间浏览会话，并核对本地元数据、LLM 解读及证据链 |
| 设置 | 控制自动采集、会话分析、30 天报告和专项分析；可选配置自己的模型服务 |

界面支持简体中文和英文，语言与主题选择只保存在本机。

## 数据如何自动更新

自动化分成三个独立阶段：

### 1. 会话记录

Codex 会话结束时，受信任的 `SessionEnd` Hook 会登记并导入该会话，然后异步启动后续处理。Hook 不等待 LLM，也不会阻塞 Codex。

WebUI 服务运行期间还会使用操作系统文件事件监听 Codex 会话目录，作为 Hook 尚未信任或偶发遗漏时的补充。它不是定时扫描，也不会高频轮询。新会话通常会在文件稳定后的数秒内出现在“记录”页面。

### 2. 单会话分析

会话稳定导入后，后台任务生成摘要、经验、决策、Skill 使用评估和提示词质量。关闭“会话级 LLM 分析”后，本地统计和原始会话记录仍会更新。

### 3. 30 天跨会话报告

每次稳定导入后，调度器都会检查是否需要更新报告，但只有同时满足以下条件才自动生成：

- 已开启“每日跨会话报告”；
- 最近 30 天存在足够的结构化证据；
- 上次成功报告之后出现了新会话证据；
- 距离上一次生成尝试已满 24 小时。

因此它是事件触发并带 24 小时冷却，不是固定在每天某个时刻运行。页面显示的“报告生成时间”是本次报告实际生成时间；“最新证据时间”表示这份报告纳入的最新会话边界。用户也可以在能力页面手动重新生成。

## 本地统计与 LLM 分析的边界

本地确定性统计不依赖模型，包括会话时间、消息、工具事件、Skill 显式调用、Token 事件、项目路径和可观察的 Git/交付证据。

LLM 用于跨会话归纳、发现适合当前用户的行为维度和解释反例。维度不是统一写死的能力量表；报告必须同时给出收益假设、适用场景、证据局限和置信度。没有充分证据时应保持“未记录”或不提供建议。

默认优先复用已登录的 Codex 能力。用户也可以在设置页填写自己的模型服务。模型服务不可用不会阻止会话导入和本地统计。

## 隐私与数据

- WebUI 仅监听 loopback，不对局域网或公网开放。
- 会话、分析结果、队列和日志保存在本机。
- 新安装默认使用 `~/.agent-usage-analyze/`；已有旧版本数据时会继续使用 `~/.agent-analytics/`。
- 产品遥测默认关闭。
- 跨会话模型输入使用受限、脱敏的结构化数据；不会把全部原始会话、Thinking 或工具结果正文直接作为报告输入。
- Codex 登录模式复用现有订阅能力，但仍受用户套餐限制；工具不会虚构美元费用。

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
```

高级的队列、模型执行策略和故障恢复说明见 [Codex 自动分析](docs/codex-zero-config-analysis.md)。本地数据的导出、归档、恢复与重建见 [本地数据生命周期](docs/local-data-lifecycle.md)。

## 新会话没有出现

按以下顺序检查：

1. 确认服务仍在运行，并在设置页确认“Hook 实时采集”已开启；
2. 打开 Codex `/hooks`，确认 Agent 使用分析的 `SessionEnd` Hook 已安装且受信任；
3. 运行 `agent-usage-analyze doctor --verbose`；
4. 查看本地数据目录中的 `session-ingestion.log`、`settled-analysis.log` 和 `hook-analysis.log`；
5. 修复提示的问题后重新结束一个测试会话，确认它出现在“记录”页面。

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

工作区包含 `cli`、`server` 和 `dashboard` 三个包。CLI 负责导入、Hook、队列和本地分析；Server 提供 loopback API 与事件监听；Dashboard 提供总览、能力、行动、记录和设置界面。

首次人工发布、npm Trusted Publisher 与后续 tag 自动发布的完整步骤见
[npm 发布](docs/npm-publishing.md)。

## 项目原则

- 本地事实优先于模型解释；
- 可观察证据不等于完整事实；
- 相关性不表述为因果；
- 建议必须可忽略、可静音、可复核；
- 不因缺少外部或人工验证记录而判定任务失败；
- 分析器自身消耗单独计入 Observer Overhead，不混入用户任务质量。
