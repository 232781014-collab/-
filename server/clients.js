const OpenAI = require("openai");
// timeout: SDK 默认 10 分钟，bobdong 通道异常时会挂死整个请求链，统一压到 90 秒
const textClient   = new OpenAI({ apiKey: process.env.TEXT_API_KEY,   baseURL: process.env.BASE_URL, timeout: 90000, maxRetries: 1 });
const imageClient  = new OpenAI({ apiKey: process.env.IMAGE_API_KEY,  baseURL: process.env.BASE_URL, timeout: 90000, maxRetries: 1 });
const visionClient = new OpenAI({ apiKey: process.env.VISION_API_KEY, baseURL: process.env.BASE_URL, timeout: 90000, maxRetries: 1 });
module.exports = { textClient, imageClient, visionClient };
