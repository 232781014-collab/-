$base = "D:\桌面\hit-engine-backend"
$routes = "$base\server\routes"

# image.js
$img = @'
const router = require("express").Router();
const { imageClient, visionClient } = require("../clients");
const PROMPTS = {
  model:   (d,e) => "Fashion product photography, Asian female model wearing " + d + ", natural lighting, lifestyle background, high quality magazine style. " + (e||""),
  scene:   (d,e) => "Product photography, " + d + ", multiple lifestyle scenes, clean composition, warm tones, e-commerce style. " + (e||""),
  style:   (d,e) => "Same product " + d + " with different style: " + (e||"minimalist modern") + ", professional photography",
  enhance: (d)   => "Enhanced product photo, sharp details, perfect lighting, " + d + ", ultra high quality",
  bg:      (d,e) => "Product with " + (e||"pure white studio background") + ", " + d + ", professional product photography",
  text:    (d,e) => "Creative poster with artistic text, " + d + ", " + (e||"minimalist typography") + ", commercial quality",
  batch:   (d)   => "Multiple product variants, " + d + ", consistent style, white background",
  merge:   (d,e) => "Composite image merging model clothing and scene: " + d + ", seamless, " + (e||"lifestyle photography"),
  color:   (d,e) => "Same product in " + (e||"multiple colorways") + ": " + d + ", consistent style",
  expand:  (d,e) => "Extended product image " + (e||"9:16 vertical") + " aspect ratio, " + d
};
router.post("/:tool", async (req, res) => {
  const { tool } = req.params;
  const { description, extra, ratio, imageBase64, imageUrl } = req.body;
  if (!PROMPTS[tool]) return res.status(400).json({ ok: false, error: "不支持的工具: " + tool });
  try {
    const sizeMap = { "1:1":"1024x1024","4:3":"1536x1024","3:4":"1024x1536","16:9":"1536x1024","9:16":"1024x1536" };
    const size = sizeMap[ratio] || "1024x1024";
    let desc = description || "fashion clothing product";
    if (imageBase64 || imageUrl) {
      const msgs = [{ role:"user", content:[
        { type:"text", text:"Describe this product image briefly in English: color, style, material, aesthetic. Max 40 words." },
        imageBase64 ? { type:"image_url", image_url:{ url:"data:image/jpeg;base64,"+imageBase64 }} : { type:"image_url", image_url:{ url:imageUrl }}
      ]}];
      const vr = await visionClient.chat.completions.create({ model: process.env.VISION_MODEL, messages: msgs, max_tokens: 80 });
      desc = vr.choices[0].message.content.trim();
    }
    const prompt = PROMPTS[tool](desc, extra||"");
    const result = await imageClient.images.generate({ model: process.env.IMAGE_MODEL, prompt, n:1, size });
    const img = result.data[0];
    res.json({ ok:true, data:{ url: img.url||null, b64_json: img.b64_json||null, prompt, tool, size }});
  } catch(err) { console.error("[image/"+tool+"]", err.message); res.status(500).json({ ok:false, error:err.message }); }
});
module.exports = router;
'@
Set-Content "$routes\image.js" -Encoding UTF8 -Value $img
Write-Host "image.js done" -ForegroundColor Green

# parseLink.js
$pl = @'
const router = require("express").Router();
const { textClient } = require("../clients");
function detectPlatform(url) {
  if (/xiaohongshu|xhslink/i.test(url)) return "小红书";
  if (/douyin|iesdouyin/i.test(url)) return "抖音";
  if (/channels.weixin/i.test(url)) return "视频号";
  if (/weibo/i.test(url)) return "微博";
  return null;
}
router.post("/", async (req, res) => {
  const { url, pastedContent, note } = req.body;
  if (pastedContent && pastedContent.trim().length > 10) {
    try {
      const prompt = "分析以下社交媒体内容，输出结构化信息。
内容：
" + pastedContent.slice(0,1000) + "

严格输出JSON：
{"platform":"推测平台","type":"image或video","title":"标题","description":"摘要100字","tags":["标签"],"hookType":"钩子类型","emotionArc":"情绪弧线","coreFramework":"核心框架","imageCount":0}";
      const c = await textClient.chat.completions.create({ model: process.env.TEXT_MODEL, messages:[{role:"user",content:prompt}], max_tokens:400, temperature:0.2 });
      const raw = c.choices[0].message.content.trim().replace(/^```jsons*/i,"").replace(/```s*$/i,"").trim();
      return res.json({ ok:true, source:"pasted", ...JSON.parse(raw), finalUrl: url||"" });
    } catch(err) { return res.status(500).json({ ok:false, error:err.message }); }
  }
  if (url) {
    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ ok:false, error:"暂不支持该链接，请粘贴内容文本" });
    return res.json({ ok:true, source:"url_only", platform, type:["抖音","视频号"].includes(platform)?"video":"image", title:note||("来自"+platform+"的内容"), description:"已识别"+platform+"链接，请将帖子文案粘贴到手动输入模式获得完整分析。", tags:[], finalUrl:url, needManualInput:true });
  }
  return res.status(400).json({ ok:false, error:"请提供链接或粘贴内容" });
});
module.exports = router;
'@
Set-Content "$routes\parseLink.js" -Encoding UTF8 -Value $pl
Write-Host "parseLink.js done" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  所有文件写入完成！" -ForegroundColor Green
Write-Host "  现在执行：cd D:\桌面\hit-engine-backend" -ForegroundColor Yellow
Write-Host "  然后执行：npm install" -ForegroundColor Yellow
Write-Host "  最后执行：node server/index.js" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan