# Hit Engine 后端

## 快速启动

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key（复制 .env.example 为 .env）
cp .env.example .env
# 编辑 .env 填入你的 Key

# 3. 启动
node server/index.js
```

## API 接口一览

| 接口 | 方法 | 功能 |
|------|------|------|
| GET  /health | GET | 健康检查 |
| POST /api/generate-copy | POST | 多平台文案生产 |
| POST /api/generate-samestyle | POST | 同款创作（框架改写） |
| POST /api/diagnose-prescore | POST | 快速预评分 |
| POST /api/diagnose | POST | 5 Agent 辩论诊断 |
| POST /api/generate-image | POST | 图片工坊（tool 放 body：model/scene/bg/text/enhance 等） |
| POST /api/parse-link | POST | 链接/内容解析 |
| POST /api/generate-video | POST | 创建视频任务（RedFox 豆包 Seedance 2.0，约 14.3 积分/次） |
| POST /api/video/task | POST | 轮询视频任务状态（完成返回 OSS 视频地址） |
| POST /api/radar/hot | POST | 小红书七日爆款榜（25 个赛道，TOP50） |
| POST /api/radar/search | POST | 小红书关键词搜热门作品（0.6 积分/次） |
| POST /api/radar/trending | POST | 全网 7 平台热点聚合榜 |

## 环境变量说明

```
BASE_URL=https://bobdong.cn/v1     # API 地址
TEXT_API_KEY=sk-xxx                 # 文案/诊断 Key
TEXT_MODEL=gpt-5.4
IMAGE_API_KEY=sk-xxx                # 图片生成 Key  
IMAGE_MODEL=gpt-image-2
VISION_API_KEY=sk-xxx               # 看图理解 Key
VISION_MODEL=gpt-5.4
REDFOX_BASE=https://redfox.hk       # RedFoxHub API（视频生成 + 作品链接解析）
REDFOX_API_KEY=ak_xxx               # 鉴权头为 X-API-Key，响应格式 {code:2000, msg, data}
REDFOX_VIDEO_MODEL=doubao-seedance-2-0-260128
```

## RedFox 接口说明

- 视频生成：POST /story/api/parseWork/videoGen/submit（model/content/resolution/ratio/duration）→ taskId；POST .../result 轮询，status: queued/running/succeeded/failed
- 作品解析：POST /story/api/parseWork/parse {url}（0.6 积分/次）→ 真实标题/封面/图片列表/视频地址，支持抖音/小红书等
- 链接解析失败会自动回退到「请手动粘贴」提示模式

## 前端对接方式

前端 HTML 原型里修改这一行即可：
```js
const API_BASE = 'http://localhost:3001';
// 部署到服务器后改为你的服务器地址
// const API_BASE = 'https://your-server.com';
```
