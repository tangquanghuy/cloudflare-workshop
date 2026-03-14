# Creative Workshop Cloudflare 项目

这是按 Cloudflare 标准托管方式整理出来的独立项目目录：

- `public/index.html`：静态网页入口
- `src/worker.js`：Worker API 入口
- `wrangler.jsonc`：Cloudflare Worker / Assets / D1 配置
- `package.json`：本地开发与部署脚本

## 目录结构

```text
cloudflare-workshop/
  public/
    index.html
  src/
    worker.js
  package.json
  wrangler.jsonc
```

## 已内置的测试接口

- `GET /api/health`
  - 检查 Worker 是否正常运行
- `GET /api/db-test`
  - 检查 D1 绑定 `DB` 是否可用
  - 未绑定时会返回明确报错

## 本地运行

```bash
cd cloudflare-workshop
npm install
npx wrangler dev
```

## 部署

```bash
cd cloudflare-workshop
npm install
npx wrangler deploy
```

## 接入 D1

先在 Cloudflare 创建 D1 数据库，然后把 `wrangler.jsonc` 里的 `d1_databases` 注释打开，填入：

- `binding`: 建议固定为 `DB`
- `database_name`: 你的 D1 数据库名
- `database_id`: D1 数据库 ID

部署后访问：

- `/api/health`
- `/api/db-test`

如果 `/api/db-test` 返回 `{"ok":true,"row":{"ok":1}}`，就说明 D1 已接通。
