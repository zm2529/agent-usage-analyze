# npm 发布

`agent-usage-analyze` 使用两阶段发布：

1. 首次人工发布用于在 npm 创建包；（已完成：`0.1.0`）
2. 后续版本由 GitHub Actions 通过 npm Trusted Publishing（OIDC）发布。

仓库不保存 npm access token，也不在 GitHub Actions 中配置 `NPM_TOKEN`。

## 当前预期身份

| 项目 | 值 |
| --- | --- |
| npm 包 | `agent-usage-analyze` |
| CLI 命令 | `agent-usage-analyze` |
| GitHub 仓库 | `zm2529/agent-usage-analyze` |
| 发布工作流 | `publish.yml` |
| npm registry | `https://registry.npmjs.org/` |
| 访问级别 | public |
| 发布标签 | 与包版本完全一致的 `vX.Y.Z` |

运行本地静态校验：

```sh
pnpm release:check-publish
```

## 一次性准备

### 1. 创建并推送 GitHub 仓库

GitHub 上需要存在公开仓库 `zm2529/agent-usage-analyze`，并包含
`.github/workflows/publish.yml`。`cli/package.json` 中的 `repository.url`
必须与它完全一致。

创建公开仓库、添加远端或推送都属于外部操作，应由维护者明确执行。

### 2. 首次发布（已完成）

npm 的 Trusted Publisher 在包设置中配置，因此包尚不存在时，需要先完成一次人工发布。

```sh
npm login
npm whoami

pnpm install --frozen-lockfile
pnpm test:release
pnpm build
pnpm audit:v1
pnpm package:smoke
pnpm release:check-publish
pnpm release:verify-tag v0.1.0

cd cli
npm publish --access public
```

发布前必须确认：

- 工作区干净；
- 当前提交是准备发布的提交；
- `cli/package.json`、`cli/CHANGELOG.md` 与标签版本一致；
- npm 账号已经启用双因素认证；
- `npm view agent-usage-analyze version` 仍未包含即将发布的版本。

首次发布会立即创建公开包，必须由维护者明确授权后执行。

### 3. 配置 Trusted Publisher

首次发布成功后，打开 npm 包的 **Settings → Trusted Publisher**，选择
**GitHub Actions**，填写：

| 字段 | 值 |
| --- | --- |
| Organization or user | `zm2529` |
| Repository | `agent-usage-analyze` |
| Workflow filename | `publish.yml` |
| Environment name | 留空 |
| Allowed actions | `npm publish` |

工作流文件名只填写 `publish.yml`，不能填写 `.github/workflows/publish.yml`。

也可以在 npm CLI 支持且已登录时配置：

```sh
npm trust github agent-usage-analyze \
  --file publish.yml \
  --repo zm2529/agent-usage-analyze \
  --allow-publish
```

Trusted Publisher 验证成功后，在 npm 包设置的 **Publishing access** 中启用
“Require two-factor authentication and disallow tokens”，然后撤销不再使用的发布 token。

## 后续发布

1. 更新 `cli/package.json` 版本和 `cli/CHANGELOG.md`；
2. 运行完整发布检查；
3. 提交并推送发布提交；
4. 创建与版本一致的 annotated tag；
5. 推送该 tag。

示例：

```sh
pnpm test:release
pnpm build
pnpm audit:v1
pnpm package:smoke
pnpm release:check-publish
pnpm release:verify-tag v0.1.1

git tag -a v0.1.1 -m "v0.1.1"
git push origin v0.1.1
```

tag 推送后，GitHub Actions 会在 GitHub-hosted runner 上：

1. 校验 tag 与包版本；
2. 校验包身份和 OIDC 配置；
3. 运行串行测试、构建和发布审计；
4. 安装真实 tarball 并执行 CLI 冒烟；
5. 使用短期 OIDC 身份发布到 npm。

Trusted Publishing 会为公开仓库中的公开包自动生成 provenance，不需要保存长期 npm token。

## 故障定位

- `ENEEDAUTH`：检查 npm Trusted Publisher 中的用户、仓库和 `publish.yml` 是否完全匹配，并确认 Allowed actions 包含 `npm publish`。
- `E404`：首次包尚未创建，或当前账号无权访问目标包。
- `EPUBLISHCONFLICT`：该版本已经存在；npm 版本不可覆盖，需要升级版本并创建新 tag。
- tag 校验失败：tag 必须严格等于 `v${cli/package.json.version}`。
- provenance 缺失：确认仓库与包都是 public，并使用 GitHub-hosted runner 和 OIDC 发布。

npm 官方要求 Node.js 22.14+、npm CLI 11.5.1+；当前工作流使用 Node 24 和 npm 11.11.0。
