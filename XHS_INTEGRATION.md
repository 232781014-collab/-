# XhsSkills Integration

项目已内置 `cv-cat/XhsSkills`，位置：

- `/Users/Hanson/Desktop/content-engine/integrations/XhsSkills`

本地 Python 运行环境：

- `/Users/Hanson/Desktop/content-engine/.venv-xhs`

## 已接入后端接口

- `GET /api/xhs/status`
- `GET /api/xhs/list`
- `POST /api/xhs/call`

## 调用示例

查看是否安装成功：

```bash
curl http://localhost:3001/api/xhs/status
```

查看可用方法：

```bash
curl http://localhost:3001/api/xhs/list
```

调用某个 PC 接口：

```bash
curl -X POST http://localhost:3001/api/xhs/call \
  -H 'Content-Type: application/json' \
  -d '{
    "namespace":"pc",
    "method":"get_note_info",
    "params":{
      "url":"https://www.xiaohongshu.com/explore/xxxx",
      "cookies_str":"a1=...; web_session=..."
    }
  }'
```

## 说明

- 这套能力大多数 `pc` 方法都需要 `cookies_str`。
- `creator` 相关方法通常也需要登录态 cookies。
- 如果没有有效 cookies，接口通常无法返回完整小红书数据。
