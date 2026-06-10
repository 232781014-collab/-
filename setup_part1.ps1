$ErrorActionPreference = "Stop"
$base = "D:\桌面\hit-engine-backend"
$routes = "$base\server\routes"
New-Item -ItemType Directory -Force -Path $routes | Out-Null
Write-Host "目录创建完成" -ForegroundColor Green

Set-Content "$base\package.json" -Encoding UTF8 -Value '{
  "name": "hit-engine",
  "version": "1.0.0",
  "main": "server/index.js",
  "scripts": { "start": "node server/index.js" },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.18.0",
    "openai": "^4.0.0"
  }
}'

Set-Content "$base\.env" -Encoding UTF8 -Value 'PORT=3001
BASE_URL=https://bobdong.cn/v1
TEXT_API_KEY=sk-k78LsBhpyU4ktpQwpTAFvieOrjaRtgbAKk83Po7KtPnbyQp2
TEXT_MODEL=gpt-5.4
IMAGE_API_KEY=sk-3MiqeOX2jndEeVNG8PO6KmHEOagoEMt5OXNNVlKssuKQwdtQ
IMAGE_MODEL=gpt-image-2
VISION_API_KEY=sk-JnWTH704CIYohOthGk5RrExyuKKFhKnFt2b0c5V71N2qhlEG
VISION_MODEL=gpt-5.4'

Write-Host ".env 写入完成" -ForegroundColor Green

$indexContent = @'
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.get("/health", (req, res) => res.json({ ok: true, mode: "real", ts: Date.now() }));
app.use("/api/generate-copy",      require("./routes/generateCopy"));
app.use("/api/generate-samestyle", require("./routes/generateSameStyle"));
app.use("/api/diagnose-prescore",  require("./routes/diagnosePrescore"));
app.use("/api/diagnose",           require("./routes/diagnose"));
app.use("/api/image",              require("./routes/image"));
app.use("/api/parse-link",         require("./routes/parseLink"));
app.use((err, req, res, next) => res.status(500).json({ ok: false, error: err.message }));
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log("Hit Engine running at http://localhost:" + PORT);
  console.log("Text model: " + process.env.TEXT_MODEL);
  console.log("Image model: " + process.env.IMAGE_MODEL);
});
'@
Set-Content "$base\server\index.js" -Encoding UTF8 -Value $indexContent

$clientsContent = @'
const OpenAI = require("openai");
const textClient   = new OpenAI({ apiKey: process.env.TEXT_API_KEY,   baseURL: process.env.BASE_URL });
const imageClient  = new OpenAI({ apiKey: process.env.IMAGE_API_KEY,  baseURL: process.env.BASE_URL });
const visionClient = new OpenAI({ apiKey: process.env.VISION_API_KEY, baseURL: process.env.BASE_URL });
module.exports = { textClient, imageClient, visionClient };
'@
Set-Content "$base\server\clients.js" -Encoding UTF8 -Value $clientsContent

Write-Host "index.js + clients.js 写入完成" -ForegroundColor Green
Write-Host "--- Part 1 DONE ---" -ForegroundColor Cyan