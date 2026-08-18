# 旅行 AI 助手 · Travel AI

任意城市的多日旅行行程规划 Web 应用。输入目的地 + 天数 + 偏好，自动生成兼顾**历史 / 美食 / 自然 / 夜生活 / 购物**的行程，并在腾讯地图上按时间顺序打点连线；同时对比**高铁 / 机票**，并把所有行程保存到「我的行程」。

> 技术栈：React + Vite + TypeScript（前端）· Vercel Serverless Functions（编排，Node/TS）· Supabase（Postgres + Auth + Storage）· 腾讯地图 JSAPI GL。

---

## 目录结构

```
travel-ai/
├─ index.html
├─ vite.config.ts
├─ vercel.json                 # Vercel 构建/路由/函数超时/环境变量
├─ tailwind.config.js
├─ .env.example                # 复制为 .env.local 后填值
├─ supabase/
│  ├─ config.toml              # Supabase 配置（含 GitHub 登录开关）
│  └─ migrations/0001_init.sql # profiles + itineraries + RLS
├─ api/                        # Vercel Serverless Functions
│  ├─ plan.ts                  # POST 生成行程（腾讯 travel_guide A2A）
│  ├─ trains.ts                # POST 12306 余票 + 估算票价
│  ├─ flights.ts               # POST 机票比价（演示数据）
│  ├─ auth/callback.ts         # OAuth 回调（可选，前端已用 PKCE）
│  └─ lib/                     # tencent / railway / flights / plan 编排
└─ src/                        # 前端 React 应用
   ├─ App.tsx
   ├─ lib/{types,supabase,tencent-map}.ts
   └─ index.css
```

---

## 1. 本地开发

```bash
cp .env.example .env.local      # 填入下方环境变量
npm install
npm run dev                     # http://localhost:5173
```

### 环境变量（`.env.local`）

| 变量 | 说明 |
|------|------|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | 前端 Supabase 客户端 |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | 服务端（函数内使用） |
| `TMAP_KEY` | 服务端 WebService（poi_search 等） |
| `VITE_TMAP_KEY` | **前端地图底图必须**，构建期注入 |
| `RAILWAY_FARE_SOURCE` | `base-table`（默认，距离估算票价） |

> 未配置 `VITE_TMAP_KEY` 时，地图区域显示提示，其余功能（行程生成、交通对比、登录、保存）照常可用。

---

## 2. Supabase（数据存储 + 登录）

### 2.1 登录 CLI（需你在浏览器授权）
```bash
supabase login
```

### 2.2 创建项目并在本地关联
1. 打开 https://supabase.com/dashboard → New Project，记下 **Project Ref** 与 API 地址/Key。
2. 关联并推送表结构：
```bash
supabase link --project-ref <YOUR_REF>
supabase db push          # 把 migrations/0001_init.sql 推到云端
```

### 2.3 开启 GitHub 登录
1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
   - Authorization callback URL：`https://<YOUR_REF>.supabase.co/auth/v1/callback`
2. 把 Client ID / Client Secret 填入 Supabase 控制台：`Authentication → Providers → GitHub`
   （或在 `supabase/config.toml` 设置 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 环境变量）

> 表已开启 RLS：**每个人只能读写自己的行程**（`itineraries` 按 `user_id` 过滤）。

---

## 3. Vercel 部署

```bash
npx vercel login             # 浏览器授权
npx vercel link              # 关联/创建项目
# 设置环境变量（与 .env.local 一致；VITE_ 前缀的会在构建期注入）
vercel env add TMAP_KEY
vercel env add VITE_TMAP_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
npx vercel --prod            # 部署
```

或在 Vercel 控制台「Import Git Repository」直接导入 GitHub 仓库，环境变量在控制台 Project → Settings → Environment Variables 填入。

---

## 4. GitHub（代码托管）

```bash
gh auth login                # 浏览器授权（如尚未登录）
git init && git add -A && git commit -m "init travel-ai"
gh repo create travel-ai --private
git push -u origin main
```

---

## 5. API 速览

| 方法 | 路径 | 入参 | 说明 |
|------|------|------|------|
| POST | `/api/plan` | `{city, days, prefs[], budget, fromCity?}` | 生成多日行程（腾讯 A2A，失败回落 mock） |
| POST | `/api/trains` | `{from, to, date?}` | 12306 余票 + 估算票价 |
| POST | `/api/flights` | `{from, to, date?}` | 机票比价（演示数据，替换 `api/lib/flights.ts` 接真实源） |

---

## 6. 已知缺口 / 路线图

- **腾讯 Key**：`travel_guide` 走 A2A 通道（`key=none`），行程生成大概率无需 Key；但**前端地图底图必须**正式 `TMAP_KEY`。
- **12306 票价**：官方接口只给余票/有无，不含价。现为「城市间距 × 单价」估算，后续可换 12306 官方查价接口（`queryTicketPrice`）。
- **机票比价**：当前为演示数据，接入真实比价 API 只需改写 `api/lib/flights.ts`，路由与前端不变。
- **P2**：导出静态 HTML 分享、行程多人协作、天气贴士、预算精算。

---

## 7. 安全

- 地图 Key 经 Vercel 环境变量注入前端（`VITE_`）；发布公网时建议走腾讯官方 Key 代理转发，避免明文被盗用。
- `SUPABASE_SERVICE_ROLE_KEY` 仅服务端使用，切勿暴露给前端。
- 所有数据表开启 RLS，用户只能访问自己的行程。
