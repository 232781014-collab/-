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

## 爆款流水线（核心使用流程）

打开 `/manual.html` 查看完整使用手册。前端「灵感创作」页是一条 6 步流水线，每步可独立使用：

① 选爆款（链接/截图/文字，可勾选深度解析抓正文+评论）→ ② 产品信息 → ③ 爆款同款图（反推爆款封面构图光线 + 你的产品图保真生成）→ ④ AI 编写爆款文案（3 版）→ ⑤ 爆款诊断（5 Agent 打分）→ ⑥ 分发（发布包导出）

「图片工坊」是独立的图生图工作台（双栏：左侧提示引擎，右侧输出画廊+本地作品库）。「爆款雷达」聚合小红书七日榜/关键词搜索/全网热点/抖音实时热榜。

## API 接口一览

| 接口 | 方法 | 功能 |
|------|------|------|
| GET  /health | GET | 健康检查 |
| POST /api/generate-copy | POST | 多平台文案生产 |
| POST /api/generate-samestyle | POST | 同款创作（框架改写，支持传入评论区洞察） |
| POST /api/diagnose-prescore | POST | 快速预评分 |
| POST /api/diagnose | POST | 5 Agent 辩论诊断 |
| POST /api/generate-image | POST | 图片工坊主接口：单引擎 RedFox Seedream 5.0（约 7.1 积分/张），支持 tool=free 自由编辑 / 模板工具 / 1-8 张数量 / 产品保真+UGC真实感条款；有参考图失败不回退，直接报错 |
| POST /api/image/suggest-scenes | POST | AI 推荐 6 套场景+光影方案 |
| POST /api/image/reverse-prompt | POST | 看图反推生成 Prompt（英文 prompt + 中文摘要） |
| POST /api/parse-link | POST | 链接/内容解析，支持 `deep` 深度解析抓正文与互动数据 |
| POST /api/generate-video, /api/video | POST | 创建视频任务（RedFox 豆包 Seedance 2.0，约 14.3 积分/次） |
| POST /api/video/task | POST | 轮询视频任务状态（完成返回 OSS 视频地址） |
| GET  /api/radar/categories | GET | 小红书榜单可选分类（25 个赛道） |
| POST /api/radar/hot | POST | 小红书七日爆款榜 |
| POST /api/radar/search | POST | 小红书关键词搜热门作品（0.6 积分/次） |
| POST /api/radar/trending | POST | 全网热点聚合榜 |
| POST /api/radar/douyin-hot | POST | 抖音实时热榜（TikHub，免费额度） |
| POST /api/radar/xhs-comments | POST | 抓取小红书笔记评论区（TikHub，需账户余额） |
| GET  /api/gallery/list, POST /api/gallery/delete | - | 本地作品库（生成的图/视频自动归档） |
| 静态 /gallery/... | GET | 本地作品库文件直链 |

## 环境变量说明

```
BASE_URL=https://bobdong.cn/v1     # bobdong.cn 中转地址（文案/诊断/视觉理解）
TEXT_API_KEY=sk-xxx                 # 文案/诊断 Key
TEXT_MODEL=gpt-5.4
IMAGE_API_KEY=sk-xxx                # 备用图片 Key（当前图片生成主链路已切到 RedFox Seedream）
IMAGE_MODEL=gpt-image-2
VISION_API_KEY=sk-xxx               # 看图理解 Key（反推提示词/场景推荐）
VISION_MODEL=gpt-5.4
REDFOX_BASE=https://redfox.hk       # RedFoxHub API（图生图 + 视频生成 + 作品链接解析 + 爆款雷达）
REDFOX_API_KEY=ak_xxx               # 鉴权头为 X-API-Key，响应格式 {code:2000, msg, data}
REDFOX_VIDEO_MODEL=doubao-seedance-2-0-260128
REDFOX_IMAGE_MODEL=doubao-seedream-5-0-260128
GALLERY_DIR=./gallery               # 本地作品库目录（生成图片/视频自动归档）
TIKHUB_BASE=https://api.tikhub.io   # TikHub.io（抖音热榜/小红书评论等数据接口）
TIKHUB_API_KEY=xxx                  # Bearer 鉴权
```

## RedFox 接口说明

- 图生图：POST /story/api/arkSubmit + /arkResult（Seedream 5.0，约 7.1 积分/次，异步轮询，最多 14 张参考图）
- 视频生成：POST /story/api/parseWork/videoGen/submit（model/content/resolution/ratio/duration）→ taskId；POST .../result 轮询，status: queued/running/succeeded/failed
- 作品解析：POST /story/api/parseWork/parse {url}（0.6 积分/次）→ 真实标题/封面/图片列表/视频地址，支持抖音/小红书等；deep 模式额外用 queryWorkDetail/dyData 抓正文全文+互动数据
- 链接解析失败会自动回退到「请手动粘贴」提示模式

## 前端对接方式

前端 HTML 原型里修改这一行即可：
```js
const API_BASE = 'http://localhost:3001';
// 部署到服务器后改为你的服务器地址
// const API_BASE = 'https://your-server.com';
```
