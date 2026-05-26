const fs=require('fs'),path=require('path'),http=require('http'),https=require('https'),url=require('url');
const {execFile}=require('child_process');
const PORT=3001;
loadEnvFile(path.join(__dirname,'.env'));
loadEnvFile(path.join(__dirname,'.env.local'));
const BOB_HOST=process.env.BOB_HOST||'bobdong.cn';
const BOB_PATH=process.env.BOB_PATH||'/v1';
const BOB_API_KEY=process.env.BOB_API_KEY||'';
const TEXT_KEY=process.env.BOB_TEXT_KEY||BOB_API_KEY;
const IMAGE_KEY=process.env.BOB_IMAGE_KEY||BOB_API_KEY;
const VIDEO_KEY=process.env.BOB_VIDEO_KEY||BOB_API_KEY;
const TEXT_HOST=BOB_HOST,TEXT_PATH=BOB_PATH;
const IMAGE_HOST=BOB_HOST,IMAGE_PATH=`${BOB_PATH}/images/generations`,IMAGE_EDIT_PATH=`${BOB_PATH}/images/edits`;
const TEXT_MODEL='gpt-5.4',IMAGE_MODEL='gpt-image-2',VIDEO_MODEL=process.env.BOB_VIDEO_MODEL||'seedance-2.0-720p';
const NOTERX_HOST='noterx.muran.tech',NOTERX_API_PATH='/api';
const XHS_ROOT=`${__dirname}/integrations/XhsSkills`;
const XHS_SCRIPT_DIR=`${XHS_ROOT}/skills/xhs-apis/scripts`;
const XHS_TOOL=`${XHS_SCRIPT_DIR}/xhs_api_tool.py`;
const XHS_PYTHON=`${__dirname}/.venv-xhs/bin/python`;
const DEFAULT_HEADERS={
  'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Accept-Language':'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};
function loadEnvFile(filePath){
  if(!fs.existsSync(filePath))return;
  const lines=fs.readFileSync(filePath,'utf8').split(/\r?\n/);
  for(const line of lines){
    const trimmed=line.trim();
    if(!trimmed||trimmed.startsWith('#'))continue;
    const match=trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if(!match)continue;
    const [,name,rawValue]=match;
    if(process.env[name])continue;
    const value=rawValue.replace(/^['"]|['"]$/g,'');
    process.env[name]=value;
  }
}
function ensureApiKey(key,label){
  if(key)return;
  throw new Error(`${label} 未配置，请在环境变量或 .env.local 中设置`);
}
function parseJsonSafe(raw){
  try{return JSON.parse(raw);}catch{return null;}
}
function execFileAsync(file,args=[],opts={}){
  return new Promise((resolve,reject)=>{
    execFile(file,args,{maxBuffer:8*1024*1024,...opts},(error,stdout,stderr)=>{
      if(error){
        const message=(stderr||stdout||error.message||'执行失败').toString().trim();
        reject(new Error(message));
        return;
      }
      resolve({stdout:String(stdout||''),stderr:String(stderr||'')});
    });
  });
}
function xhsInstalled(){
  return fs.existsSync(XHS_TOOL)&&fs.existsSync(XHS_PYTHON);
}
async function runXhsTool(args=[]){
  if(!xhsInstalled())throw new Error('XhsSkills 尚未安装完成');
  const {stdout}=await execFileAsync(XHS_PYTHON,[XHS_TOOL,...args],{cwd:XHS_SCRIPT_DIR,env:{...process.env,NODE_PATH:`${XHS_SCRIPT_DIR}/node_modules${process.env.NODE_PATH?':'+process.env.NODE_PATH:''}`}});
  return JSON.parse(stdout);
}
function extractFirstHttpUrl(input=''){
  const text=String(input||'').trim();
  const match=text.match(/https?:\/\/[^\s<>"']+/i);
  return match?match[0].replace(/[),.;!?]+$/,''):'';
}
function detectPlatformByUrl(rawUrl=''){
  const value=String(rawUrl||'');
  if(/xiaohongshu\.com|xhslink/i.test(value))return '小红书';
  if(/douyin\.com|iesdouyin/i.test(value))return '抖音';
  if(/channels\.weixin|weixin\.qq/i.test(value))return '视频号';
  if(/weibo\.com/i.test(value))return '微博';
  return '其他';
}
function normalizeAbsoluteUrl(base,maybeUrl){
  try{return new URL(maybeUrl,base).toString();}catch{return '';}
}
function decodeHtml(value=''){
  return String(value||'')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#39;|&apos;/g,"'")
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/&#x2F;/gi,'/')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)||0))
    .trim();
}
function stripTags(value=''){
  return decodeHtml(String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
}
function pickFirstMeta(html,patterns=[]){
  for(const pattern of patterns){
    const match=html.match(pattern);
    const value=match?.[1]||match?.[2]||'';
    if(value)return stripTags(value);
  }
  return '';
}
function collectMetaValues(html,patterns=[]){
  const found=[];
  for(const pattern of patterns){
    const matches=html.matchAll(pattern);
    for(const match of matches){
      const value=stripTags(match?.[1]||match?.[2]||'');
      if(value&&!found.includes(value))found.push(value);
    }
  }
  return found;
}
function fetchBuffer(targetUrl,opts={}){
  return new Promise((resolve,reject)=>{
    const maxRedirects=opts.maxRedirects??5;
    const visited=new Set();
    const run=(currentUrl,redirectCount)=>{
      let parsed;
      try{parsed=new URL(currentUrl);}catch{return reject(new Error('链接格式无效'));}
      const lib=parsed.protocol==='http:'?http:https;
      const headers={...DEFAULT_HEADERS,...(opts.headers||{})};
      if(opts.referer)headers.Referer=opts.referer;
      const req=lib.request({
        protocol:parsed.protocol,
        hostname:parsed.hostname,
        port:parsed.port||undefined,
        path:`${parsed.pathname||'/'}${parsed.search||''}`,
        method:'GET',
        headers,
      },res=>{
        const status=res.statusCode||0;
        if([301,302,303,307,308].includes(status)&&res.headers.location){
          if(redirectCount>=maxRedirects)return reject(new Error('重定向过多'));
          const nextUrl=normalizeAbsoluteUrl(currentUrl,res.headers.location);
          if(!nextUrl||visited.has(nextUrl))return reject(new Error('重定向异常'));
          visited.add(nextUrl);
          res.resume();
          return run(nextUrl,redirectCount+1);
        }
        const chunks=[];
        let total=0;
        const limit=opts.maxBytes||4*1024*1024;
        res.on('data',chunk=>{
          total+=chunk.length;
          if(total>limit){
            req.destroy(new Error('内容过大'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end',()=>resolve({
          statusCode:status,
          headers:res.headers,
          finalUrl:currentUrl,
          buffer:Buffer.concat(chunks),
        }));
      });
      req.on('error',reject);
      req.setTimeout(opts.timeoutMs||20000,()=>req.destroy(new Error('请求超时')));
      req.end();
    };
    visited.add(String(targetUrl||''));
    run(String(targetUrl||''),0);
  });
}
async function fetchTextPage(targetUrl,opts={}){
  const result=await fetchBuffer(targetUrl,opts);
  const contentType=String(result.headers['content-type']||'');
  const html=result.buffer.toString('utf8');
  return {...result,contentType,html};
}
function extractImagesFromHtml(html,baseUrl){
  const candidates=[
    ...collectMetaValues(html,[
      /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["'][^>]*>/gi,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/gi,
      /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    ]),
  ];
  if(candidates.length===0){
    const imgMatches=html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
    for(const match of imgMatches){
      const value=stripTags(match[1]||'');
      if(value)candidates.push(value);
      if(candidates.length>=8)break;
    }
  }
  return candidates
    .map(src=>normalizeAbsoluteUrl(baseUrl,src))
    .filter(Boolean)
    .filter(src=>!/^data:/i.test(src))
    .filter(src=>!/sprite|icon|logo|avatar|emoji/i.test(src))
    .filter((src,idx,arr)=>arr.indexOf(src)===idx)
    .slice(0,4);
}
async function fetchImagePreviewDataUrl(imageUrl,referer=''){
  if(!imageUrl)return '';
  const result=await fetchBuffer(imageUrl,{timeoutMs:20000,maxBytes:2*1024*1024,headers:{Accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'},referer});
  const contentType=String(result.headers['content-type']||'');
  if(!/^image\//i.test(contentType))return '';
  return `data:${contentType};base64,${result.buffer.toString('base64')}`;
}
async function parseRealLink(targetUrl){
  const page=await fetchTextPage(targetUrl,{timeoutMs:20000,maxBytes:3*1024*1024});
  if((page.statusCode||0)>=400)throw new Error(`链接访问失败：HTTP ${page.statusCode}`);
  const finalUrl=page.finalUrl||targetUrl;
  const html=page.html||'';
  const title=pickFirstMeta(html,[
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["'][^>]*>/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);
  const description=pickFirstMeta(html,[
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i,
  ]);
  const images=extractImagesFromHtml(html,finalUrl);
  let previewImage='';
  try{previewImage=await fetchImagePreviewDataUrl(images[0],finalUrl);}catch(e){}
  return {
    ok:true,
    platform:detectPlatformByUrl(finalUrl),
    url:targetUrl,
    finalUrl,
    title:title||'未提取到标题',
    description,
    images,
    previewImage,
    imageCount:images.length,
  };
}
function buildResponsesInput(messages=[]){
  return messages.map(m=>`${m.role||'user'}: ${typeof m.content==='string'?m.content:JSON.stringify(m.content)}`).join('\n\n');
}
function parseApiPayload(raw){
  const text=raw.trim();
  if(!text.startsWith('data:'))return JSON.parse(text);
  const events=text.split(/\n\s*\n/).map(block=>block.split('\n').map(line=>line.trim()).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('')).filter(Boolean);
  const chunks=events.filter(item=>item!=='[DONE]').map(item=>JSON.parse(item));
  const content=chunks.map(chunk=>chunk?.choices?.[0]?.delta?.content||chunk?.choices?.[0]?.message?.content||'').join('');
  const last=chunks[chunks.length-1]||{};
  if(content){
    last.choices=[{message:{content}}];
  }
  return last;
}
function buildVideoPrompt(payload={}){
  const parts=[
    `为中文电商短视频生成一条可直接投放的短视频。`,
    payload.platform?`目标平台:${payload.platform}`:'',
    payload.productName?`产品:${payload.productName}`:'',
    payload.productFeature?`核心卖点:${payload.productFeature}`:'',
    payload.tone?`语气:${payload.tone}`:'',
    payload.angle?`创作角度:${payload.angle}`:'',
    payload.script?`参考脚本:\n${payload.script}`:'',
    payload.prompt?`补充要求:${payload.prompt}`:'',
    '要求:竖屏、真人口播/展示感、节奏清晰、适合带货转化。',
  ].filter(Boolean);
  return parts.join('\n');
}
function normalizeVideoResponse(data){
  const url=data?.url||data?.video_url||data?.download_url||data?.content_url||data?.data?.url||data?.data?.video_url||'';
  const taskId=data?.id||data?.task_id||data?.data?.id||data?.data?.task_id||'';
  const status=data?.status||data?.data?.status||data?.state||'submitted';
  return {taskId,status,url,raw:data};
}
function httpsPost(host,path,body,key,opts={}){return new Promise((resolve,reject)=>{const headers={'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)};if(key)headers.Authorization=`Bearer ${key}`;const opt={hostname:host,port:443,path,method:'POST',headers};const req=https.request(opt,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{const p=parseApiPayload(d);if(res.statusCode>=400)reject(new Error(`API ${res.statusCode}: ${p?.error?.message||d.slice(0,200)}`));else resolve(p);}catch(e){reject(new Error('解析失败:'+d.slice(0,200)));}});});req.on('error',reject);req.setTimeout(opts.timeoutMs||90000,()=>{req.destroy();reject(new Error('超时'));});req.write(body);req.end();});}
function httpsMultipartPost(host,path,parts,key,opts={}){return new Promise((resolve,reject)=>{const boundary=`----contentengine${Date.now().toString(16)}`;const chunks=[];for(const part of parts){chunks.push(Buffer.from(`--${boundary}\r\n`));if(part.filename){chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType||'application/octet-stream'}\r\n\r\n`));chunks.push(Buffer.isBuffer(part.value)?part.value:Buffer.from(part.value));chunks.push(Buffer.from('\r\n'));}else{chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));}}chunks.push(Buffer.from(`--${boundary}--\r\n`));const body=Buffer.concat(chunks);const headers={'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':body.length};if(key)headers.Authorization=`Bearer ${key}`;const opt={hostname:host,port:443,path,method:'POST',headers};const req=https.request(opt,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{const p=parseApiPayload(d);if(res.statusCode>=400)reject(new Error(`API ${res.statusCode}: ${p?.error?.message||d.slice(0,200)}`));else resolve(p);}catch(e){reject(new Error('解析失败:'+d.slice(0,200)));}});});req.on('error',reject);req.setTimeout(opts.timeoutMs||90000,()=>{req.destroy();reject(new Error('超时'));});req.write(body);req.end();});}
function httpsGetJson(host,path,key,opts={}){return new Promise((resolve,reject)=>{const headers={Accept:'application/json'};if(key)headers.Authorization=`Bearer ${key}`;const req=https.request({hostname:host,port:443,path,method:'GET',headers},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{const parsed=parseJsonSafe(d);if((res.statusCode||0)>=400){reject(new Error(`API ${res.statusCode}: ${parsed?.error?.message||parsed?.message||d.slice(0,200)}`));return;}if(!parsed){reject(new Error('解析失败:'+d.slice(0,200)));return;}resolve(parsed);});});req.on('error',reject);req.setTimeout(opts.timeoutMs||90000,()=>{req.destroy(new Error('超时'));});req.end();});}
function textCompletion(messages,opts={}){ensureApiKey(TEXT_KEY,'BOB_TEXT_KEY / BOB_API_KEY');return httpsPost(TEXT_HOST,`${TEXT_PATH}/responses`,JSON.stringify({model:opts.model||TEXT_MODEL,input:buildResponsesInput(messages),max_output_tokens:opts.maxTokens||2000,temperature:0.7,text:{format:{type:'text'},verbosity:'low'}}),TEXT_KEY,{timeoutMs:opts.timeoutMs});}
async function textCompletionWithRetry(messages,opts={}){
  let lastErr;
  const attempts=opts.retries||1;
  for(let i=0;i<attempts;i++){
    try{
      if(attempts>1)console.log(`文字生成尝试 ${i+1}/${attempts}...`);
      return await textCompletion(messages,opts);
    }catch(err){
      lastErr=err;
      if(attempts>1)console.log(`文字第${i+1}次失败: ${err.message}${i<attempts-1?'，重试中...':'，放弃'}`);
      if(i<attempts-1)await new Promise(r=>setTimeout(r,1500));
    }
  }
  throw lastErr;
}
async function generateImage(prompt,opts={}){
  ensureApiKey(IMAGE_KEY,'BOB_IMAGE_KEY / BOB_API_KEY');
  const sizeMap={'1:1':'1024x1024','3:4':'1024x1792','9:16':'1024x1792','4:3':'1792x1024','16:9':'1792x1024'};
  const body=JSON.stringify({model:IMAGE_MODEL,prompt,n:1,size:sizeMap[opts.ratio]||'1024x1024',response_format:'b64_json'});
  let lastErr;
  for(let i=0;i<2;i++){
    try{
      console.log(`图片生成尝试 ${i+1}/2...`);
      const res=await httpsPost(IMAGE_HOST,IMAGE_PATH,body,IMAGE_KEY,{timeoutMs:120000});
      return res;
    }catch(err){
      lastErr=err;
      console.log(`第${i+1}次失败: ${err.message}${i<1?'，重试中...':'，放弃'}`);
      if(i<1)await new Promise(r=>setTimeout(r,1200));
    }
  }
  throw lastErr;
}
function parseDataUrl(dataUrl){
  const m=String(dataUrl||'').match(/^data:(.+?);base64,(.+)$/);
  if(!m)return null;
  return {mimeType:m[1],buffer:Buffer.from(m[2],'base64')};
}
function buildImageParts(imageBase64List=[]){
  return imageBase64List.map((item,idx)=>{
    const parsed=parseDataUrl(item);
    if(!parsed)return null;
    const ext=parsed.mimeType.includes('png')?'png':parsed.mimeType.includes('webp')?'webp':'jpg';
    return {name:'image[]',value:parsed.buffer,filename:`reference-${idx+1}.${ext}`,contentType:parsed.mimeType};
  }).filter(Boolean);
}
async function editImage(prompt,opts={}){
  ensureApiKey(IMAGE_KEY,'BOB_IMAGE_KEY / BOB_API_KEY');
  const sizeMap={'1:1':'1024x1024','3:4':'1024x1792','9:16':'1024x1792','4:3':'1792x1024','16:9':'1792x1024'};
  const images=buildImageParts(opts.imageBase64List?.length?opts.imageBase64List:[opts.imageBase64]);
  if(!images.length)throw new Error('参考图解析失败');
  const parts=[
    {name:'model',value:IMAGE_MODEL},
    {name:'prompt',value:prompt},
    {name:'size',value:sizeMap[opts.ratio]||'1024x1024'},
    ...images,
  ];
  let lastErr;
  for(let i=0;i<2;i++){
    try{
      console.log(`图片编辑尝试 ${i+1}/2...`);
      return await httpsMultipartPost(IMAGE_HOST,IMAGE_EDIT_PATH,parts,IMAGE_KEY,{timeoutMs:120000});
    }catch(err){
      lastErr=err;
      console.log(`编辑第${i+1}次失败: ${err.message}${i<1?'，重试中...':'，放弃'}`);
      if(i<1)await new Promise(r=>setTimeout(r,1200));
    }
  }
  throw lastErr;
}
async function generateVideo(payload={}){
  ensureApiKey(VIDEO_KEY,'BOB_VIDEO_KEY / BOB_API_KEY');
  const ratioMap={'1:1':'1024x1024','3:4':'1024x1365','9:16':'720x1280','4:3':'1280x960','16:9':'1280x720'};
  const body={
    model:payload.model||VIDEO_MODEL,
    prompt:buildVideoPrompt(payload),
    size:ratioMap[payload.ratio]||'720x1280',
  };
  if(payload.duration)body.duration=payload.duration;
  if(payload.image)body.image=payload.image;
  return normalizeVideoResponse(await httpsPost(TEXT_HOST,`${TEXT_PATH}/videos`,JSON.stringify(body),VIDEO_KEY,{timeoutMs:120000}));
}
async function getVideoTask(taskId){
  ensureApiKey(VIDEO_KEY,'BOB_VIDEO_KEY / BOB_API_KEY');
  if(!taskId)throw new Error('缺少 taskId');
  return normalizeVideoResponse(await httpsGetJson(TEXT_HOST,`${TEXT_PATH}/videos/${encodeURIComponent(taskId)}`,VIDEO_KEY,{timeoutMs:60000}));
}
function extractText(r){
  if(r?.output_text)return r.output_text;
  if(Array.isArray(r?.output)){
    return r.output.flatMap(item=>item?.content||[]).filter(part=>part?.type==='output_text').map(part=>part.text||'').join('');
  }
  return r?.choices?.[0]?.message?.content||'';
}
function extractImage(r){return r?.data?.[0]?.b64_json||r?.data?.[0]?.url||null;}
function normalizeTagString(tags){
  if(Array.isArray(tags))return tags.map(t=>String(t||'').trim()).filter(Boolean).join(',');
  return String(tags||'').replace(/#/g,'').split(/[,\n，\s]+/).map(t=>t.trim()).filter(Boolean).join(',');
}
function mapCategoryToNoteRx(category){
  const key=String(category||'').trim();
  return {dress:'fashion',top:'fashion',bottom:'fashion',outer:'fashion',inner:'fashion',set:'fashion'}[key]||'fashion';
}
function noteRxFormParts(payload){
  return Object.entries(payload).filter(([,value])=>value!==undefined&&value!==null&&String(value)!=='').map(([name,value])=>({name,value:String(value)}));
}
async function noteRxPost(path,payload,opts={}){
  return httpsMultipartPost(NOTERX_HOST,`${NOTERX_API_PATH}${path}`,noteRxFormParts(payload),null,{timeoutMs:opts.timeoutMs||180000});
}
function pickOpinionText(opinion){
  if(!opinion)return '暂无诊断结论';
  return [opinion.reasoning,...(opinion.issues||[]),...(opinion.suggestions||[])].find(Boolean)||'暂无诊断结论';
}
function pickDebateText(opinion){
  if(!opinion)return '暂无补充意见';
  return (opinion.debate_comments||[]).find(Boolean)||(opinion.suggestions||[])[0]||(opinion.issues||[])[0]||opinion.reasoning||'暂无补充意见';
}
function buildInspirationText(inputData={}){
  if(inputData?.mode==='link'){
    return `链接:${inputData?.finalUrl||inputData?.url||''}\n来源平台:${inputData?.platform||''}\n原始标题:${inputData?.title||''}\n原始描述:${inputData?.description||''}\n识别到的页面图片:${Array.isArray(inputData?.images)?inputData.images.length:0} 张`;
  }
  if(inputData?.mode==='image'){
    const insights=inputData?.insights||{};
    return `截图数量:${Array.isArray(inputData?.screenshots)?inputData.screenshots.length:0} 张\n来源平台:${inputData?.platform||''}\n标题钩子草稿:${insights?.hookType||''}\n卖点顺序草稿:${insights?.sellingPoints||''}\n情绪调性草稿:${insights?.emotionTone||''}\n评论高频词草稿:${insights?.commentKeywords||''}\n推荐创作方向:${insights?.recommendedDirection||''}\n视觉重点:${insights?.visualMotif||''}\n补充备注:${insights?.notes||''}`;
  }
  return inputData?.content||inputData?.url||'素材';
}
function adaptNoteRxDiagnoseResult(raw){
  const opinions=Array.isArray(raw?.agent_opinions)?raw.agent_opinions:[];
  const agentMap={content:'内容分析师',visual:'视觉诊断师',growth:'增长策略师',user:'用户模拟器'};
  const matched=key=>opinions.find(item=>String(item?.agent_name||'').includes(agentMap[key]))||opinions.find(item=>String(item?.dimension||'').toLowerCase().includes(key));
  const priorities=(raw?.issues||[]).slice(0,3).map((item,idx)=>({title:item?.description||`问题 ${idx+1}`,desc:(raw?.suggestions||[])[idx]?.description||item?.description||'建议继续优化'}));
  return {
    source:'noterx',
    preScore:raw?.pre_score||null,
    agents:{
      content:((opinion)=>({score:Math.round(Number(opinion?.score||0)),r1:pickOpinionText(opinion),r2:pickDebateText(opinion)}))(matched('content')),
      visual:((opinion)=>({score:Math.round(Number(opinion?.score||0)),r1:pickOpinionText(opinion),r2:pickDebateText(opinion)}))(matched('visual')),
      growth:((opinion)=>({score:Math.round(Number(opinion?.score||0)),r1:pickOpinionText(opinion),r2:pickDebateText(opinion)}))(matched('growth')),
      user:((opinion)=>({score:Math.round(Number(opinion?.score||0)),r1:pickOpinionText(opinion),r2:pickDebateText(opinion)}))(matched('user')),
    },
    judge:{
      finalScore:Math.round(Number(raw?.overall_score||0)),
      verdict:raw?.grade||'已完成诊断',
      summary:raw?.debate_summary||'',
      priorities,
    },
    improved:{
      title:raw?.optimized_title||'',
      content:raw?.optimized_content||'',
      tags:'',
    },
    raw,
  };
}
const routes={
'POST /api/generate-content':async({inputData,srcPlat,dstPlat,prodName,prodFeature,prodTone,angle,tone,industryName})=>{const platLogic={xiaohongshu:'搜索词前置、收藏率优先、闺蜜感',douyin:'前三秒强钩子、节奏快、完播优先',shipinhao:'熟人信任、分享价值',gongzhonghao:'深度转化、SEO词',weibo:'话题借势、短促传播'}[dstPlat]||'平台适配';const inspiration=buildInspirationText(inputData);const prompt=`你是中文社媒文案助手。基于给定灵感和产品信息，生成适配${dstPlat}的平台原创内容。\n灵感:${inspiration}\n产品:${prodName}\n卖点:${prodFeature||'无'}\n语气:${prodTone||tone||'自然种草'}\n行业:${industryName||'服装'}\n平台逻辑:${platLogic}\n要求:如果灵感来自真实链接，请优先学习原链接的标题结构、卖点顺序、情绪调性和画面感，但不要照抄原文。\n要求:如果灵感来自截图识别草稿，请吸收草稿中的钩子、卖点顺序、评论高频词和视觉重点，但要自然改写，不要把“草稿”“截图”等字样写进最终文案。\n要求:输出纯JSON，不要markdown，不要解释。title简短，content 120-220字，tags为1个字符串，包含6个以内话题。\nJSON结构:{\"framework\":{\"hookType\":\"\",\"emotionArc\":\"\",\"platformLogic\":\"\",\"ctaStrategy\":\"\"},\"versions\":[{\"angle\":\"情感共鸣型\",\"title\":\"\",\"content\":\"\",\"tags\":\"\",\"score\":0,\"tip\":\"\"},{\"angle\":\"干货攻略型\",\"title\":\"\",\"content\":\"\",\"tags\":\"\",\"score\":0,\"tip\":\"\"},{\"angle\":\"故事叙事型\",\"title\":\"\",\"content\":\"\",\"tags\":\"\",\"score\":0,\"tip\":\"\"}]}`;const res=await textCompletionWithRetry([{role:'user',content:prompt}],{maxTokens:1200,timeoutMs:180000,retries:2});const t=extractText(res);try{return{ok:true,data:JSON.parse(t.replace(/```json|```/g,'').trim())};}catch{return{ok:false,error:'JSON解析失败',raw:t.slice(0,500)};}},
'POST /api/diagnose-prescore':async({title,content,tags,category})=>{try{const mappedCategory=mapCategoryToNoteRx(category);const res=await noteRxPost('/pre-score',{title:title||'',content:content||'',category:mappedCategory,tags:normalizeTagString(tags),image_count:0},{timeoutMs:30000});return{ok:true,data:{source:'noterx',category:mappedCategory,...res}};}catch(err){return{ok:false,error:err.message};}},
'POST /api/diagnose':async({title,content,tags,category})=>{try{const mappedCategory=mapCategoryToNoteRx(category);const [preScore,diag]=await Promise.all([noteRxPost('/pre-score',{title:title||'',content:content||'',category:mappedCategory,tags:normalizeTagString(tags),image_count:0},{timeoutMs:30000}).catch(()=>null),noteRxPost('/diagnose',{title:title||'',content:content||'',category:mappedCategory,tags:normalizeTagString(tags)},{timeoutMs:240000})]);diag.pre_score=preScore;return{ok:true,data:adaptNoteRxDiagnoseResult(diag)};}catch(err){return{ok:false,error:err.message};}},
'POST /api/parse-link':async({url:targetUrl})=>{
  const normalizedUrl=extractFirstHttpUrl(targetUrl);
  if(!normalizedUrl)return{ok:false,error:'请粘贴完整链接'};
  try{return await parseRealLink(normalizedUrl);}
  catch(err){return{ok:false,error:err.message};}
},
'GET /api/xhs/status':async()=>({ok:true,installed:xhsInstalled(),root:XHS_ROOT,python:XHS_PYTHON,tool:XHS_TOOL}),
'GET /api/xhs/list':async()=>{const data=await runXhsTool(['list']);return{ok:true,...data};},
'GET /api/video/status':async()=>({ok:true,configured:Boolean(VIDEO_KEY),provider:'bobdong-openai-compatible',model:VIDEO_MODEL,message:VIDEO_KEY?`视频已接通，可用模型：${VIDEO_MODEL}`:'未配置视频 Key'}),
'POST /api/generate-video':async(payload)=>{
  try{return{ok:true,data:await generateVideo(payload)};}
  catch(err){return{ok:false,error:err.message};}
},
'POST /api/video/task':async({taskId})=>{
  try{return{ok:true,data:await getVideoTask(taskId)};}
  catch(err){return{ok:false,error:err.message};}
},
'POST /api/xhs/call':async({namespace,method,params})=>{
  if(!namespace||!method)return{ok:false,error:'缺少 namespace 或 method'};
  const payload=JSON.stringify(params&&typeof params==='object'?params:{});
  const data=await runXhsTool(['call',String(namespace),String(method),'--params',payload]);
  if(data?.error)return{ok:false,...data};
  return{ok:true,...data};
},
'POST /api/generate-image':async({tool,params={},imageBase64,imageBase64List,ratio})=>{const pm={model:`Use the uploaded garment image as the strict reference. Keep the clothing design, fabric texture, print, logo, cut, color, and silhouette exactly consistent with the reference image. Only place the garment naturally on a ${params.modelType||'clean Asian'} fashion model in a ${params.scene||'studio'} scene with ${params.pose||'front standing'} pose. Do not redesign the clothing.`,scene:`Use the uploaded product image as the strict reference. Keep the product, color, pattern, logo, and shape exactly the same. Only place it into a ${params.package||'lifestyle'} scene with ${params.light||'natural daylight'} lighting. Do not alter the product itself.`,bg:`Use the uploaded image as the strict reference. Preserve the subject, clothing, body shape, pose, colors, logos, and all visible details exactly. Only replace the background with ${params.bgType||'solid'} style in ${params.bgColor||'warm off-white'} tones. No other changes.`,style:`Use the uploaded image as the strict reference. Preserve the same person, garment, pose, composition, shape, print, logo, and colors. Only change the visual style toward ${params.targetStyle||'French vintage'}. Keep the content itself the same.`,enhance:`Use the uploaded image as the strict reference. Keep all content exactly the same. Only apply ${params.mode||'commercial retouch'} enhancement for clarity, lighting, and texture cleanup. No redesign, no composition changes.`,text:`Minimal ${params.designType||'T-shirt print'} design with the text "${params.textContent||'SPRING BLOOM'}", ${params.fontStyle||'handwritten'} style, ${params.colorScheme||'morandi colors'}, clean background, centered composition`,color:`Use the uploaded image as the strict reference. Keep garment shape, folds, fabric texture, composition, and logos exactly the same. Only create color variations of the product.`,expand:`Use the uploaded image as the strict reference. Keep the original image unchanged in the center. Only outpaint around it to fit ${ratio||'9:16'} with natural matching surroundings.`,batch:`Use all uploaded product images as strict references. Keep each product unchanged and generate consistent variants in one unified visual direction.`,merge:`Use all uploaded images as strict references. Merge them while preserving the clothing details, product identity, colors, logos, and structure from the references. Mode: ${params.mergeMode||'garment on model'}.`};const prompt=pm[tool]||`Use the uploaded image as the strict reference and keep the subject unchanged while creating a polished commercial result at ratio ${ratio||'1:1'}.`;try{const refs=(imageBase64List&&imageBase64List.length?imageBase64List:(imageBase64?[imageBase64]:[]));const useReference=refs.length>0&&tool!=='text';const res=useReference?await editImage(prompt,{ratio,imageBase64List:refs}):await generateImage(prompt,{ratio});const img=extractImage(res);if(img)return{ok:true,imageData:img};return{ok:false,error:'未能提取图片',debug:JSON.stringify(res).slice(0,300)};}catch(err){return{ok:false,error:err.message};}},
'POST /api/chat':async({messages,model,maxTokens})=>{const res=await textCompletion(messages,{model,maxTokens});const text=extractText(res);if(!text)return{ok:false,error:'中转站已连通，但模型未返回可用文本内容',debug:JSON.stringify(res).slice(0,300)};return{ok:true,text};}
};
function setCorsHeaders(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}
function sendJson(res,statusCode,payload){
  res.writeHead(statusCode,{'Content-Type':'application/json'});
  res.end(JSON.stringify(payload));
}
async function readJsonBody(req){
  if(req.body&&typeof req.body==='object')return req.body;
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data',chunk=>body+=chunk);
    req.on('end',()=>{
      try{resolve(body?JSON.parse(body):{});}
      catch(err){reject(err);}
    });
    req.on('error',reject);
  });
}
async function requestHandler(req,res){
  setCorsHeaders(res);
  if(req.method==='OPTIONS'){
    res.writeHead(204);
    res.end();
    return;
  }
  const parsedUrl=req.url instanceof URL?req.url:url.parse(req.url||'',true);
  const pathname=parsedUrl.pathname||'/';
  const rk=`${req.method} ${pathname}`;
  if(rk==='GET /health'){
    sendJson(res,200,{ok:true,imageModel:IMAGE_MODEL,textModel:TEXT_MODEL,xhsInstalled:xhsInstalled(),videoConfigured:Boolean(VIDEO_KEY)});
    return;
  }
  const handler=routes[rk];
  if(!handler){
    sendJson(res,404,{error:`路由不存在:${rk}`});
    return;
  }
  try{
    const payload=req.method==='GET'?{}:await readJsonBody(req);
    const t=Date.now();
    console.log(`→ ${rk}`);
    const result=await handler(payload);
    console.log(`← ${rk} ${Date.now()-t}ms ${result.ok?'✓':'✗ '+result.error}`);
    sendJson(res,200,result);
  }catch(err){
    console.error(`✗ ${rk}:`,err.message);
    sendJson(res,500,{ok:false,error:err.message});
  }
}
function startServer(){
  const server=http.createServer(requestHandler);
  server.listen(PORT,()=>{console.log(`\n🚀 内容引擎后端\n   地址：http://localhost:${PORT}\n   文字：${TEXT_MODEL} (${TEXT_HOST})\n   图片：${IMAGE_MODEL} (${IMAGE_HOST}) 3次重试\n   视频：${VIDEO_KEY?`已接通 (${VIDEO_MODEL})`:'未配置'}\n`);});
  return server;
}
module.exports={requestHandler,startServer};
if(require.main===module)startServer();
