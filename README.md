# Grok Art Proxy

基于 Cloudflare Workers 的 Grok AI 代理服务，提供 Web 管理界面和 OpenAI 兼容 API，支持文本对话、图片生成和视频生成。

## 功能特性

### Web 管理界面
- **图片生成** - 可视化界面，支持多种宽高比、批量生成、NSFW 模式
- **视频生成** - 从图片一键生成视频，支持时长和分辨率选择
- **Token 管理** - 批量导入/导出 Grok Token，状态监控
- **API Key 管理** - 创建多个 API Key，设置速率限制

### OpenAI 兼容 API
- **标准接口** - 支持 `/v1/chat/completions`、`/v1/images/generations`、`/v1/models`
- **多模型支持** - Grok 3/4/4.1 系列文本模型
- **图片/视频生成** - 通过 Chat API 生成图片和视频
- **Token 自动轮换** - 遇到速率限制自动切换账号重试（最多 5 次）

### Anthropic 兼容 API
- **标准接口** - 支持 `/v1/messages`，兼容 Claude Code CLI 及所有 Anthropic SDK 客户端
- **双认证方式** - 支持 `Authorization: Bearer` 和 `x-api-key` 请求头
- **模型自动映射** - Claude 模型名自动转换为对应 Grok 模型
- **流式输出** - 完整实现 Anthropic SSE 事件格式

### 其他特性
- **视频海报预览** - 视频返回可点击的海报预览图
- **认证保护** - 后台管理需用户名密码登录
- **一键部署** - Fork 后通过 GitHub Actions 自动部署

## 支持的模型

### 文本模型

| 模型 ID | 说明 |
|---------|------|
| `grok-3` | Grok 3 标准模式 |
| `grok-3-fast` | Grok 3 快速模式 |
| `grok-4` | Grok 4 标准模式 |
| `grok-4-mini` | Grok 4 Mini (思维链) |
| `grok-4-fast` | Grok 4 快速模式 |
| `grok-4-heavy` | Grok 4 深度模式 |
| `grok-4.1` | Grok 4.1 标准模式 |
| `grok-4.1-fast` | Grok 4.1 快速模式 |
| `grok-4.1-expert` | Grok 4.1 专家模式 |
| `grok-4.1-thinking` | Grok 4.1 思维链模式 |

### Claude 模型映射（Anthropic API 专用）

通过 `/v1/messages` 接口时，Claude 模型名会自动映射为对应的 Grok 模型：

| 客户端传入模型名 | 实际调用 Grok 模型 |
|-----------------|------------------|
| `claude-opus-*` | `grok-4-heavy` |
| `claude-sonnet-*` | `grok-4` |
| `claude-haiku-*` | `grok-4-fast` |
| 其他 `claude-*` | `grok-4` |
| `grok-4`、`grok-3` 等 | 直接透传 |

### 图片模型

| 模型 ID | 宽高比 |
|---------|--------|
| `grok-image` | 1:1 (默认) |
| `grok-image-1_1` | 1:1 |
| `grok-image-2_3` | 2:3 (竖向) |
| `grok-image-3_2` | 3:2 (横向) |
| `grok-image-16_9` | 16:9 (宽屏) |
| `grok-image-9_16` | 9:16 (竖屏) |

### 视频模型

| 模型 ID | 宽高比 |
|---------|--------|
| `grok-video` | 16:9 (默认) |
| `grok-video-1_1` | 1:1 |
| `grok-video-2_3` | 2:3 |
| `grok-video-3_2` | 3:2 |
| `grok-video-16_9` | 16:9 |
| `grok-video-9_16` | 9:16 |

## 一键部署

### 前置要求

1. [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
2. GitHub 账号

### 步骤 1: Fork 项目

点击右上角 **Fork** 按钮，将项目 Fork 到你的 GitHub 账号。

### 步骤 2: 获取 Cloudflare 凭证

**获取 Account ID：**
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击左侧 **Workers & Pages**
3. 右侧页面可看到 **Account ID**，复制保存

**创建 API Token：**
1. 进入 [API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. 点击 **Create Token**
3. 选择 **Edit Cloudflare Workers** 模板
4. 确保包含以下权限：
   - Workers Scripts: Edit
   - Workers KV Storage: Edit
   - D1: Edit
5. 点击 **Continue to summary** → **Create Token**，复制保存

### 步骤 3: 配置 GitHub Secrets

进入 Fork 的仓库 → **Settings** → **Secrets and variables** → **Actions** → **Secrets** 标签页

> ⚠️ 注意：必须添加到 **Secrets**（不是 Variables），否则部署会失败。

**首次部署必填：**

| Secret 名称 | 说明 | 获取方式 |
|-------------|------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token | 步骤 2 创建 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID | 步骤 2 获取 |
| `AUTH_USERNAME` | 后台登录用户名（自定义） | 自定义 |
| `AUTH_PASSWORD` | 后台登录密码（自定义） | 自定义 |

**首次部署后需补充（防止后续重复部署失败）：**

首次部署成功后，KV Namespace 已自动创建，需将其 ID 保存为 Secret，否则后续更新部署时会报错。

| Secret 名称 | 说明 | 获取方式 |
|-------------|------|---------|
| `KV_NAMESPACE_ID` | KV Namespace ID | Cloudflare → Workers & Pages → KV → 复制对应 ID |

### 步骤 4: 首次部署

1. 进入仓库 **Actions** 标签页
2. 点击左侧 **Deploy to Cloudflare Workers**
3. 点击 **Run workflow** → **Run workflow**
4. 等待部署完成（约 2-3 分钟）

### 步骤 5: 补充 KV Secret（重要）

首次部署成功后，立即执行此步骤，避免后续部署失败：

**获取 KV Namespace ID：**
1. Cloudflare Dashboard → **Workers & Pages** → **KV**
2. 找到名为 `KV_CACHE` 的 namespace，复制其 **Namespace ID**
3. 添加到 GitHub Secrets：名称 `KV_NAMESPACE_ID`

### 步骤 6: 开始使用

部署完成后访问：`https://grok-art-proxy.<your-subdomain>.workers.dev`

## Web 端使用

### 登录

访问部署地址，使用配置的用户名密码登录。

### 导入 Token

1. 进入 **令牌管理** 页面
2. 在文本框中粘贴 Token，支持多种格式：
   - 纯 SSO Token（每行一个）
   - JSON 数组格式
   - CSV 格式: `sso,sso_rw,user_id,cf_clearance,name`
3. 点击 **导入数据**

### 生成图片

1. 进入 **图片生成** 页面
2. 输入提示词
3. 选择数量、宽高比
4. 可选开启 NSFW 模式
5. 点击 **开始生成**

### 生成视频

1. 先生成图片
2. 点击图片下方的 **生成视频** 按钮
3. 输入动作描述（可选）
4. 选择时长和分辨率
5. 点击 **生成视频**

### 创建 API Key

1. 进入 **API 密钥** 页面
2. 填写密钥名称（可选）
3. 点击 **创建密钥**
4. **立即复制**生成的 API Key（关闭后无法再次查看）

## API 使用

### OpenAI 兼容接口

#### 对话补全

```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

#### 图片生成

```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-image-16_9",
    "messages": [{"role": "user", "content": "一只可爱的猫咪"}],
    "stream": true
  }'
```

#### 视频生成

```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-video",
    "messages": [{"role": "user", "content": "一只猫咪在草地上奔跑"}],
    "stream": true
  }'
```

#### 获取模型列表

```bash
curl https://your-worker.workers.dev/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Anthropic 兼容接口

支持 Claude Code CLI 和所有 Anthropic SDK 客户端直接接入。

#### Claude Code CLI 配置

```bash
# 设置环境变量（加入 ~/.bashrc 或 ~/.zshrc）
export ANTHROPIC_BASE_URL=https://your-worker.workers.dev
export ANTHROPIC_API_KEY=YOUR_API_KEY
```

#### curl 调用示例

```bash
curl https://your-worker.workers.dev/v1/messages \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

#### Python SDK

```python
import anthropic

client = anthropic.Anthropic(
    base_url="https://your-worker.workers.dev",
    api_key="YOUR_API_KEY",
)

message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `AUTH_USERNAME` | 后台登录用户名 | - |
| `AUTH_PASSWORD` | 后台登录密码 | - |
| `VIDEO_POSTER_PREVIEW` | 视频返回海报预览模式 | `true` |

## 更新部署

如果你之前已经部署过，更新到最新版本：

1. 确认已在 GitHub Secrets 中设置 `KV_NAMESPACE_ID` 和 `D1_DATABASE_ID`（见步骤 5）
2. 在 GitHub 上点击 **Sync fork** 同步最新代码
3. 进入 **Actions** → **Deploy to Cloudflare Workers** → **Run workflow**
4. 等待部署完成

数据库迁移会自动执行，原有数据不会丢失。

## 本地开发

```bash
# 安装依赖
npm install

# 创建 .dev.vars 文件
echo "AUTH_USERNAME=admin" > .dev.vars
echo "AUTH_PASSWORD=password" >> .dev.vars

# 创建本地数据库
npx wrangler d1 create grok-art-proxy --local
npx wrangler d1 migrations apply DB --local

# 启动开发服务器
npm run dev
```

## 技术栈

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Cache**: Cloudflare KV
- **Frontend**: Vanilla JS

## License

MIT
