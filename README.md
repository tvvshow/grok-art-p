# Grok Art Proxy

基于 Cloudflare Workers 的 Grok AI 代理服务，提供 OpenAI 兼容的 API 接口，支持文本对话、图片生成和视频生成。

## 功能特性

- **OpenAI 兼容 API** - 支持 `/v1/chat/completions`、`/v1/images/generations`、`/v1/models` 等标准接口
- **多模型支持** - Grok 3/4/4.1 系列文本模型
- **图片生成** - 支持 5 种宽高比，NSFW 模式
- **视频生成** - 一键从提示词生成视频，支持多种宽高比
- **Token 池管理** - 批量导入、自动轮换、失败重试
- **API Key 管理** - 创建多个 API Key，支持速率限制
- **视频海报预览** - 视频返回可点击的海报预览图
- **认证保护** - 后台管理需用户名密码登录

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

## API 使用

### 对话补全

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

### 图片生成

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

### 视频生成

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

## 一键部署

### 前置要求

1. [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
2. GitHub 账号

### 步骤 1: Fork 项目

点击右上角 **Fork** 按钮，将项目 Fork 到你的 GitHub 账号。

### 步骤 2: 获取 Cloudflare 凭证

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 获取 **Account ID** (在 Workers 页面右侧可见)
3. 创建 **API Token**:
   - 进入 [API Tokens](https://dash.cloudflare.com/profile/api-tokens)
   - 点击 **Create Token**
   - 选择 **Edit Cloudflare Workers** 模板
   - 确保包含权限: Workers Scripts Edit, Workers KV Edit, D1 Edit

### 步骤 3: 配置 GitHub Secrets

进入 Fork 的仓库 → **Settings** → **Secrets and variables** → **Actions**

| Secret 名称 | 说明 | 必填 |
|-------------|------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token | ✅ |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID | ✅ |
| `AUTH_USERNAME` | 后台登录用户名 | ✅ |
| `AUTH_PASSWORD` | 后台登录密码 | ✅ |

### 步骤 4: 部署

1. 进入 **Actions** 标签页
2. 点击 **Deploy to Cloudflare Workers**
3. 点击 **Run workflow**，将 `create_resources` 设为 `true`
4. 等待部署完成

### 步骤 5: 使用

1. 访问 `https://grok-art-proxy.<your-account>.workers.dev`
2. 使用配置的用户名密码登录
3. 在 **令牌管理** 中导入 Grok Token
4. 在 **API Key 管理** 中创建 API Key
5. 使用 API Key 调用 API

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `AUTH_USERNAME` | 后台登录用户名 | - |
| `AUTH_PASSWORD` | 后台登录密码 | - |
| `VIDEO_POSTER_PREVIEW` | 视频返回海报预览模式 | `true` |

## 本地开发

```bash
# 安装依赖
npm install

# 创建 .dev.vars 文件
echo "AUTH_USERNAME=admin" > .dev.vars
echo "AUTH_PASSWORD=password" >> .dev.vars

# 创建本地数据库
npx wrangler d1 create grok-imagine --local
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
