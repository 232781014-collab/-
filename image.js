const router = require('express').Router();
const { visionClient } = require('../clients');
const https = require('https');

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
        return img.url || (img.b64_json ? 'data:image/png;base64,' + img.b64_json : null);
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
    const url = base64.startsWith('data:') ? base64 : 'data:image/jpeg;base64,' + base64;
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
  const refImage = imageBase64 || (imageBase64List && imageBase64List[0]);

  try {
    // Step 1: 视觉识别产品图
    let clothingDesc = null;
    if (refImage) {
      clothingDesc = await describeClothing(refImage);
    }

    // Step 2: 构建高质量 prompt
    const prompt = buildHighQualityPrompt(tool, clothingDesc, extraDesc || '', params);
    console.log('[image/' + tool + '] prompt preview:', prompt.slice(0, 120).replace(/\n/g, ' '));

    // Step 3: 生成图片
    const imageData = await textToImage(prompt, size);

    res.json({ ok: true, imageData, prompt, tool, size });
  } catch(err) {
    console.error('[image/' + tool + '] error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

router.post('/:tool', (req, res) => handleImageGen(req.params.tool, req.body, res));
router.post('/', (req, res) => handleImageGen(req.body.tool || 'text', req.body, res));
module.exports = router;
