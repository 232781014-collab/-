const OpenAI = require("openai");
const textClient   = new OpenAI({ apiKey: process.env.TEXT_API_KEY,   baseURL: process.env.BASE_URL });
const imageClient  = new OpenAI({ apiKey: process.env.IMAGE_API_KEY,  baseURL: process.env.BASE_URL });
const visionClient = new OpenAI({ apiKey: process.env.VISION_API_KEY, baseURL: process.env.BASE_URL });
module.exports = { textClient, imageClient, visionClient };
