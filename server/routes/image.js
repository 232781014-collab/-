const router = require('express').Router();
const { visionClient, textClient } = require('../clients');
const { redfox } = require('../redfox');
const { saveRecord } = require('../gallery');
const https = require('https');

// ── RedFox Seedream 5.0 图生图（有参考图时的主通道）──
// 提交: POST /story/api/parseWork/imageGen/arkSubmit（约 7.1 积分/次）
// 查询: POST /story/api/parseWork/imageGen/arkResult
const SEEDREAM_MODEL = process.env.REDFOX_IMAGE_MODEL || 'doubao-seedream-5-0-260128';
// Seedream 像素总量下限约 3.69MP，按比例映射到合规尺寸
const SEEDREAM_SIZES = {
  '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304',
  '16:9': '3072x1728', '9:16': '1728x3072',
};

function toDataUri(b64) {
  return b64.startsWith('data:') || b64.startsWith('http') ? b64 : 'data:image/jpeg;base64,' + b64;
}

// 把 base64 参考图先上传到 RedFox OSS（免费），换成短 URL 再喂给生成接口。
// 否则几 MB 的 base64 直塞 JSON 会让生成接口卡几分钟甚至超时。
const REDFOX_BASE = (process.env.REDFOX_BASE || 'https://redfox.hk').replace(/\/$/, '');
async function uploadToRedfox(img) {
  if (img.startsWith('http')) return img; // 已是 URL（如上一轮生成结果）
  let mime = 'image/jpeg', data = img;
  const m = img.match(/^data:(image\/[\w+]+);base64,(.*)$/);
  if (m) { mime = m[1]; data = m[2]; }
  const buf = Buffer.from(data, 'base64');
  let fmt = (mime.split('/')[1] || 'jpeg').toLowerCase();
  if (fmt === 'jpg') fmt = 'jpeg';
  if (!['png', 'jpeg', 'webp'].includes(fmt)) fmt = 'jpeg';
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime }), 'image.' + fmt);
  fd.append('format', fmt);
  const r = await fetch(REDFOX_BASE + '/story/api/parseWork/imageGen/uploadImage', {
    method: 'POST',
    headers: { 'X-API-Key': process.env.REDFOX_API_KEY },
    body: fd,
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json();
  if (j.code !== 2000 || !j.data?.imageUrl) throw new Error(j.msg || '参考图上传失败');
  return j.data.imageUrl;
}

// 返回图片 URL 数组。series=true 时用 Seedream 组图功能一次出多张风格连贯的图
async function seedreamGen(prompt, images, ratio, { series = false, count = 1 } = {}) {
  const body = {
    model: SEEDREAM_MODEL,
    prompt,
    size: SEEDREAM_SIZES[ratio] || SEEDREAM_SIZES['1:1'],
    sequentialImageGeneration: series && count > 1 ? 'auto' : 'disabled',
    responseFormat: 'url',
    watermark: false,
  };
  if (series && count > 1) body.maxImages = Math.min(count, 15);
  if (images && images.length) {
    const imgs = images.map(toDataUri);
    body.image = imgs.length === 1 ? imgs[0] : imgs;
  }
  const d = await redfox('/story/api/parseWork/imageGen/arkSubmit', body);
  const taskId = d?.taskId || d?.task_id;
  if (!taskId) throw new Error('未拿到图片任务 ID: ' + JSON.stringify(d).slice(0, 120));
  console.log('[seedream] task:', taskId, series ? '(组图x' + count + ')' : '');
  const maxPolls = series ? 120 : 90; // 多参考图/组图都慢，普通 3 分钟、组图 4 分钟
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const q = await redfox('/story/api/parseWork/imageGen/arkResult', { taskId });
    const status = String(q?.status || '').toLowerCase();
    if (status === 'succeeded') {
      const urls = Array.isArray(q.imageUrls) ? q.imageUrls : [];
      if (!urls.length) throw new Error('任务成功但未返回图片');
      return urls;
    }
    if (status === 'failed') throw new Error(q?.failReason || '图片生成失败');
  }
  throw new Error('图片生成超时，稍后可重试');
}

// 变体模式：同一指令并行 N 个任务，返回 N 张不同种子的图
async function seedreamVariants(prompt, images, ratio, count) {
  const n = Math.max(1, Math.min(count, 8));
  const results = await Promise.allSettled(
    Array.from({ length: n }, () => seedreamGen(prompt, images, ratio))
  );
  const urls = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  if (!urls.length) throw new Error(results[0]?.reason?.message || '全部生成失败');
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed) console.warn('[seedream] variants:', failed, '/', n, '个任务失败');
  return urls;
}

// ── 文生图（3次重试）────────────────────────────────
async function textToImage(prompt, size) {
  for (let i = 0; i < 3; i++) {
    try {
      console.log('[t2i] attempt ' + (i+1) + '/3, size:' + size);
      const body = JSON.stringify({ model: 'gpt-image-2', prompt, n: 1, size });
      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'bobdong.cn',
          path: '/v1/images/generations',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + process.env.IMAGE_API_KEY,
            'Content-Length': Buffer.byteLength(body)
          }
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch(e) { reject(new Error('Parse error: ' + data.slice(0,150))); }
          });
        });
        req.on('error', reject);
        req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout after 120s')); });
        req.write(body);
        req.end();
      });
      if (result.data && result.data[0]) {
        const img = result.data[0];
        return img.url || img.b64_json || null; // 返回裸 b64，前端会自行加 data: 前缀
      }
      throw new Error((result.error && result.error.message) || 'No image data in response');
    } catch(err) {
      console.warn('[t2i] attempt ' + (i+1) + ' failed: ' + err.message);
      if (i === 2) throw err;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// ── 视觉精细识别（专为服装设计）────────────────────
async function describeClothing(base64) {
  try {
    const url = base64.startsWith('data:') || base64.startsWith('http') ? base64 : 'data:image/jpeg;base64,' + base64;
    const vr = await visionClient.chat.completions.create({
      model: process.env.VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You are a fashion product analyst. Describe this clothing item in precise detail for AI image generation. Cover ALL of these aspects:
1. Color: exact shade (e.g. "heather gray", "dusty rose", not just "gray")
2. Fabric: texture and material (e.g. "chunky cable-knit wool", "silk chiffon", "washed denim")
3. Silhouette: fit type (e.g. "oversized boxy", "slim fitted", "A-line flared")
4. Neckline: exact type (e.g. "deep V-neck", "crew neck", "off-shoulder")
5. Sleeves: length and style (e.g. "3/4 length balloon sleeves", "sleeveless", "long bishop sleeves")
6. Length: (e.g. "cropped at waist", "midi length", "ankle-length")
7. Details: any prints, embroidery, buttons, zippers, pockets, or distinctive design elements
8. Overall aesthetic: (e.g. "casual minimalist", "bohemian", "streetwear edgy")
Be specific and factual. Max 120 words.`
          },
          { type: 'image_url', image_url: { url } }
        ]
      }],
      max_tokens: 150
    });
    const desc = vr.choices[0].message.content.trim();
    console.log('[vision] clothing desc:', desc.slice(0, 100));
    return desc;
  } catch(e) {
    console.warn('[vision] failed:', e.message);
    return null;
  }
}

// ── 参数中文→英文映射 ───────────────────────────────
const PARAM_MAPS = {
  modelType: {
    '亚洲清新': 'East Asian, fresh-faced, natural makeup',
    '欧美时尚': 'Caucasian, fashion-forward, editorial look',
    '混血气质': 'mixed ethnicity, exotic features, high cheekbones',
    '日系少女': 'Japanese style, youthful, soft features, light makeup',
    '韩系都市': 'Korean style, urban chic, glass skin, refined features'
  },
  age: {
    '18-24': '20 years old, youthful',
    '25-30': '27 years old, young professional',
    '30-35': '32 years old, confident mature',
    '35-40': '37 years old, sophisticated'
  },
  pose: {
    '正面站立': 'standing facing camera, confident posture, full body shot',
    '侧身回眸': 'three-quarter turn, looking back over shoulder, elegant',
    '行走中': 'walking naturally, candid dynamic pose, mid-stride',
    '靠墙': 'leaning against wall, relaxed casual pose',
    '坐姿': 'seated pose, crossed legs, relaxed',
    '低头看': 'looking down slightly, contemplative, intimate mood'
  },
  scene: {
    '工作室纯色': 'clean studio backdrop, soft gradient background, professional lighting',
    '咖啡馆': 'cozy cafe interior, warm bokeh background, natural window light',
    '城市街拍': 'urban street background, city architecture, natural outdoor light',
    '室内沙发': 'modern living room, sofa setting, warm interior lighting',
    '户外公园': 'lush green park, dappled natural light, fresh outdoor atmosphere',
    '海边度假': 'beach resort setting, ocean in background, golden hour light',
    '高奢背景': 'luxury hotel lobby, marble architecture, dramatic lighting'
  },
  bgType: {
    '纯色背景': 'solid color background',
    '渐变背景': 'soft gradient background',
    '室内场景': 'indoor lifestyle scene',
    '户外自然': 'outdoor natural setting',
    '城市街景': 'urban street scene',
    '品牌氛围': 'brand lifestyle atmosphere',
    '节日氛围': 'festive holiday atmosphere'
  },
  targetStyle: {
    '法式复古': 'French vintage aesthetic, retro editorial',
    '韩系清新': 'Korean fresh minimalist style',
    '欧美街拍': 'Western street style, urban fashion',
    '日系轻熟': 'Japanese soft mature style',
    '高奢大牌感': 'luxury high fashion editorial',
    '赛博朋克': 'cyberpunk neon aesthetic',
    '油画感': 'oil painting artistic style',
    '胶片复古': 'film photography vintage look',
    '莫兰迪淡彩': 'Morandi muted pastel palette'
  }
};

function translateParam(key, value) {
  return (PARAM_MAPS[key] && PARAM_MAPS[key][value]) || value;
}

// ── Prompt 构建器（高质量版）────────────────────────
function buildHighQualityPrompt(tool, clothingDesc, extraDesc, params) {
  const p = params || {};

  // 融合视觉识别 + 用户补充描述
  let productCore = '';
  if (clothingDesc && extraDesc) {
    productCore = clothingDesc + '. Additional details: ' + extraDesc;
  } else if (clothingDesc) {
    productCore = clothingDesc;
  } else if (extraDesc) {
    productCore = extraDesc;
  } else {
    productCore = 'the clothing item from the reference image';
  }

  switch(tool) {
    case 'model': {
      const modelType = translateParam('modelType', p.modelType || '亚洲清新');
      const age = translateParam('age', p.age || '25-30');
      const pose = translateParam('pose', p.pose || '正面站立');
      const scene = translateParam('scene', p.scene || '工作室纯色');
      return `Professional fashion editorial photograph. 
Model: ${modelType}, ${age}. 
The model is wearing: ${productCore}. 
Pose: ${pose}. 
Setting: ${scene}. 
Photography style: sharp focus, perfect exposure, magazine quality, 4K resolution. 
The clothing must be accurately reproduced - maintain exact color, fabric texture, silhouette and all design details. 
Full body or 3/4 body shot. No text or watermarks.`;
    }

    case 'scene': {
      const pkg = p.package || '生活方式（默认）';
      const light = p.light || '自然日光';
      const lightEn = {'自然日光':'soft natural daylight','棚拍柔光':'studio soft box lighting','黄昏暖光':'golden hour warm light','冷调电影感':'cinematic cool tones','戏剧逆光':'dramatic back lighting'}[light] || light;
      return `E-commerce lifestyle product photography. 
Product: ${productCore}. 
Scene package: ${pkg}, ${lightEn}. 
Multiple lifestyle contexts showing the clothing in real-world settings. 
Clean professional composition, commercial quality, high resolution. No text.`;
    }

    case 'style': {
      const style = translateParam('targetStyle', p.targetStyle || '法式复古');
      const intensity = {'轻度（保留原图 70%）':'subtle style shift, preserve 70% original look','中度（推荐）':'balanced style transformation','重度（风格优先）':'strong style override, prioritize aesthetic'}[p.intensity] || 'balanced';
      return `Fashion editorial photograph. 
Clothing: ${productCore}. 
Visual style: ${style}. 
Transformation intensity: ${intensity}. 
Professional photography, color graded, high quality. Preserve clothing item identity.`;
    }

    case 'enhance':
      return `Ultra high quality commercial product photograph. 
Item: ${productCore}. 
Enhancement: ${p.mode || 'professional commercial retouching'}. 
Perfect studio lighting, razor-sharp detail, flawless color accuracy, professional fashion photography standard. High resolution output.`;

    case 'bg': {
      const bgType = translateParam('bgType', p.bgType || '纯色背景');
      const bgColor = p.bgColor || '奶白/米色';
      const light = p.light || '自然光';
      return `Product photography with replaced background. 
Item: ${productCore}. 
New background: ${bgType}, ${bgColor} color tones, ${light} lighting. 
Clean professional e-commerce style, product as main subject, background complementary. High quality.`;
    }

    case 'text': {
      const txt = p.textContent || 'Brand Name';
      const designType = p.designType || 'T恤印花';
      const font = p.fontStyle || '手写体';
      const color = p.colorScheme || '莫兰迪柔色';
      const fontEn = {'手写体':'handwritten script','哥特体':'gothic blackletter','现代无衬线':'modern sans-serif','复古衬线':'vintage serif','涂鸦风':'graffiti street art','极简细线':'ultra-thin minimalist'}[font] || font;
      const colorEn = {'莫兰迪柔色':'muted Morandi pastel palette','高饱和撞色':'vibrant high-contrast color blocking','黑白极简':'black and white minimal','金色奢华':'gold luxury metallic','马卡龙甜色':'macaron pastel sweet tones','深色潮流':'dark moody trendy palette'}[color] || color;
      return `Creative graphic design: ${designType}. 
Text to display: "${txt}". 
Typography style: ${fontEn}. 
Color scheme: ${colorEn}. 
High contrast, commercially polished, suitable for fashion merchandise. Clean background, design-focused composition.`;
    }

    case 'batch':
      return `Consistent professional product photography series. 
Item: ${productCore}. 
Style: ${p.unifyScene || 'clean studio'} background, ${p.unifyModel || 'Asian model'} aesthetic. 
All shots maintain consistent lighting, color grading, and composition. E-commerce standard quality.`;

    case 'merge':
      return `Seamless composite fashion photograph. 
Clothing item: ${productCore}. 
Fusion mode: ${p.mergeMode || 'garment on model'}. 
Natural integration, realistic proportions, professional photography quality. The final image should look like a single cohesive photograph.`;

    case 'color':
      return `Fashion colorway presentation. 
Base garment: ${productCore}. 
Color palette: ${p.palette || 'multiple colorways'}. 
${p.keepTexture || 'Preserve original fabric texture and design details'}, only change the color. Consistent product photography style for all variants.`;

    case 'expand':
      return `Extended fashion product photograph. 
Subject: ${productCore}. 
Expansion: ${p.direction || 'extend canvas on all sides'}, fill style: ${p.fillStyle || 'continue original background seamlessly'}. 
Maintain photographic quality and style consistency throughout the extended areas.`;

    default:
      return `High quality professional fashion product photograph of ${productCore}. Studio lighting, commercial quality, no text.`;
  }
}

// ── 主处理函数 ─────────────────────────────────────
async function handleImageGen(tool, body, res) {
  const { ratio, imageBase64, imageBase64List, params, extraDesc } = body;
  const sizeMap = {
    '1:1':'1024x1024', '4:3':'1536x1024', '3:4':'1024x1536',
    '16:9':'1536x1024', '9:16':'1024x1536'
  };
  const size = sizeMap[ratio] || '1024x1024';
  const refImages = (Array.isArray(imageBase64List) && imageBase64List.length)
    ? imageBase64List
    : (imageBase64 ? [imageBase64] : []);
  const refImage = refImages[0];

  const count = Math.max(1, Math.min(parseInt(body.count, 10) || 1, 8));
  const genMode = body.genMode === 'series' ? 'series' : 'variants';

  // 产品保真硬约束：有参考图时强制锁定服装所有细节
  const FIDELITY = ' STRICT PRODUCT FIDELITY (mandatory): The garment in the output must be IDENTICAL to the one in the reference image(s) — exact fabric texture and material, exact colors and tones, exact neckline shape, exact cuff and sleeve design, exact buttons, seams, prints and patterns, same silhouette and length. Do NOT redesign, restyle, recolor or alter the clothing in any way. Only change the model, pose, scene, background or lighting as instructed.';
  const MULTI_REF = ' All reference images show the SAME product from different angles; combine them to reconstruct every detail accurately.';
  // 成像风格：默认「真实种草感」去 AI 化（印花文字类设计图除外）
  const UGC_STYLE = ' IMAGING STYLE — authentic UGC realism (mandatory): looks like a casual photo taken on an iPhone in one take, NOT a professional studio shoot. Subtle smartphone sensor grain and natural noise in shadows, true-to-life unfiltered colors, slightly imperfect casual framing, natural ambient light with realistic imperfections. The person must look like a REAL ordinary person, not an AI render or magazine model: natural unretouched skin with visible pores and slight unevenness, a few flyaway hairs, relaxed candid expression and posture, asymmetric natural features. Absolutely NO airbrushing, NO beauty filter, NO cinematic color grading, NO perfect studio lighting.';
  const photoStyle = body.photoStyle === 'studio' ? 'studio' : 'ugc';
  const ugcApplies = photoStyle === 'ugc' && tool !== 'text';

  try {
    // 主通道：RedFox Seedream（有参考图=图生图，无参考图=文生图）
    try {
      // 先把所有 base64 参考图并行上传换成 URL（只传一次，变体/组图复用）
      const refUrls = refImages.length
        ? await Promise.all(refImages.map(uploadToRedfox))
        : [];
      if (refImages.length) console.log('[image/' + tool + '] 已上传', refUrls.length, '张参考图换 URL');
      // 自由编辑模式：用户描述就是指令核心；模板工具走 prompt 构建器
      const core = tool === 'free'
        ? ((extraDesc || '').trim() || 'High quality professional fashion product photograph')
        : buildHighQualityPrompt(tool, null, extraDesc || '', params);
      const prompt = core
        + (refUrls.length ? FIDELITY : '')
        + (refUrls.length > 1 ? MULTI_REF : '')
        + (ugcApplies ? UGC_STYLE : '');
      console.log('[image/' + tool + '] seedream prompt:', prompt.slice(0, 120).replace(/\n/g, ' '), '| count:', count, genMode);
      const urls = count > 1 && genMode === 'series'
        ? await seedreamGen(prompt + ' Generate a cohesive series of ' + count + ' images: consistent subject and style, varied angles/poses/compositions.', refUrls, ratio, { series: true, count })
        : await seedreamVariants(prompt, refUrls, ratio, count);
      const engine = refImages.length ? 'seedream-i2i' : 'seedream-t2i';
      // 自动存入本地素材库（失败不影响返回）
      const rec = await saveRecord({ tool, prompt: extraDesc || prompt, ratio, engine, urls });
      return res.json({
        ok: true, imageData: urls[0], imageList: urls, prompt, tool, size, engine,
        local: rec ? rec.files.map(f => '/gallery/' + f) : null,
        galleryId: rec ? rec.id : null,
      });
    } catch (e) {
      // 有参考图时不回退：bobdong 文生图是按描述重画，违反产品保真要求，直接报真实错误
      if (refImages.length) throw e;
      console.warn('[image/' + tool + '] seedream 失败，回退 bobdong:', e.message);
    }

    // 备用通道：视觉识别 + bobdong gpt-image-2 文生图
    let clothingDesc = null;
    if (refImage) {
      clothingDesc = await describeClothing(refImage);
    }
    const prompt = buildHighQualityPrompt(tool, clothingDesc, extraDesc || '', params);
    console.log('[image/' + tool + '] t2i prompt:', prompt.slice(0, 120).replace(/\n/g, ' '));
    const imageData = await textToImage(prompt, size);

    res.json({ ok: true, imageData, imageList: [imageData], prompt, tool, size, engine: 'gpt-image-t2i' });
  } catch(err) {
    console.error('[image/' + tool + '] error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// AI 推荐场景光影：根据产品描述 + 用户风格描述，动态生成 6 个摄影方案
router.post('/suggest-scenes', async (req, res) => {
  const { productDesc, styleDesc } = req.body || {};
  if (!styleDesc && !productDesc) return res.status(400).json({ ok: false, error: '请至少描述一下想要的风格' });
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
  try {
    const completion = await textClient.chat.completions.create({
      model: process.env.TEXT_MODEL,
      messages: [{ role: 'user', content: `你是一位顶级电商服装摄影指导。根据产品和风格要求，设计 6 个差异明显的拍摄场景+光影方案。

产品：${productDesc || '女装单品'}
风格要求：${styleDesc || '自然高级'}

每个方案给中文名称（10字内，含场景和光线特征）和一段英文摄影 prompt（40词内，涵盖 location, lighting, mood, color palette）。

严格按 JSON 输出，不要其他文字：
{"scenes":[{"name":"清晨侧逆光·亚麻窗纱","prompt":"morning side backlight through linen curtains, soft warm glow, ..."}]}` }],
      max_tokens: 900,
      temperature: 0.8,
    });
    const raw = completion.choices[0].message.content.trim();
    const m = raw.match(/\{[\s\S]*\}/); // 上游偶尔在 JSON 外夹杂文字，提取首个对象
    const data = JSON.parse(m ? m[0] : raw);
    if (!Array.isArray(data.scenes) || !data.scenes.length) throw new Error('模型未返回有效方案: ' + raw.slice(0, 80));
    return res.json({ ok: true, data });
  } catch (err) {
    lastErr = err;
    console.warn('[suggest-scenes] attempt ' + (attempt + 1) + ':', err.message);
  }
  }
  res.status(500).json({ ok: false, error: lastErr.message });
});

// 反推提示词：传图（base64 或 URL），AI 反推出可复刻的生成提示词
router.post('/reverse-prompt', async (req, res) => {
  const { imageBase64, imageUrl } = req.body || {};
  try {
    let dataUri = null;
    if (imageBase64) {
      dataUri = imageBase64.startsWith('data:') ? imageBase64 : 'data:image/jpeg;base64,' + imageBase64;
    } else if (imageUrl) {
      const full = imageUrl.startsWith('/')
        ? 'http://localhost:' + (process.env.PORT || 3001) + imageUrl
        : imageUrl;
      const r = await fetch(full, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('图片获取失败 HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      dataUri = 'data:' + (r.headers.get('content-type') || 'image/jpeg') + ';base64,' + buf.toString('base64');
    } else {
      return res.status(400).json({ ok: false, error: '请提供图片' });
    }
    const vr = await visionClient.chat.completions.create({
      model: process.env.VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '分析这张图片，输出能用 AI 复刻它的生成提示词。严格按 JSON 输出，不要其他文字：\n{"prompt":"英文提示词（60-100词，涵盖主体与服装细节、构图、场景、光线、色调、风格质感）","promptZh":"中文一句话概括画面"}' },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      }],
      max_tokens: 400,
    });
    const raw = vr.choices[0].message.content.trim();
    const m = raw.match(/\{[\s\S]*\}/);
    const data = JSON.parse(m ? m[0] : raw);
    if (!data.prompt) throw new Error('未能反推出提示词');
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[reverse-prompt]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:tool', (req, res) => handleImageGen(req.params.tool, req.body, res));
router.post('/', (req, res) => handleImageGen(req.body.tool || 'text', req.body, res));
module.exports = router;
