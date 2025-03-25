require("dotenv").config();

// Global constants and configuration
const PORT = process.env.PORT || 3000;

// Event expiry settings
const EVENT_EXPIRY = 1000 * 60 * 5; // 5 minutes

// Admin settings
const ADMIN_SETTINGS = {
  TARGET_USER_ID: "U82150395bb148926c8584e86daa26b0d",
};

// Cloudinary configuration
const CLOUDINARY_CONFIG = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
};

// API URLs
const API_URLS = {
  LINE_REPLY: "https://api.line.me/v2/bot/message/reply",
  LINE_PUSH: "https://api.line.me/v2/bot/message/push",
  LINE_LOADING: "https://api.line.me/v2/bot/chat/loading/start",
  LINE_CONTENT: "https://api-data.line.me/v2/bot/message/",
  DIFY_API: process.env.DIFY_API_URL,
  OPENAI_API: "https://api.openai.com/v1/audio/transcriptions",
  DIFY_AUDIO_TO_TEXT: "https://api.dify.ai/v1/audio-to-text",
};

// Message limits
const LINE_MESSAGE_LIMITS = {
  MAX_MESSAGES_PER_REQUEST: 5,
  MAX_FLEX_MESSAGES: 5,
};

// Quick reply items
const QUICK_REPLY_ITEMS = [
  {
    type: "action",
    imageUrl:
      "https://res.cloudinary.com/dt7pnivs1/image/upload/v1742467030/11_jhqvhe.png",
    action: {
      type: "uri",
      label: "明細",
      uri: "https://liff.line.me/2007052419-6KyqOAoX",
    },
  },
  {
    type: "action",
    imageUrl:
      "https://res.cloudinary.com/dt7pnivs1/image/upload/v1742467013/22_fnlufx.png",
    action: {
      type: "uri",
      label: "分析",
      uri: "https://liff.line.me/2007052419-Br7KNJxo",
    },
  },
  {
    type: "action",
    imageUrl:
      "https://res.cloudinary.com/dt7pnivs1/image/upload/v1742467019/33_s7tz7c.png",
    action: {
      type: "uri",
      label: "我的",
      uri: "https://liff.line.me/2007052419-mWakO8RW",
    },
  },
];

module.exports = {
  PORT,
  EVENT_EXPIRY,
  ADMIN_SETTINGS,
  CLOUDINARY_CONFIG,
  API_URLS,
  LINE_MESSAGE_LIMITS,
  QUICK_REPLY_ITEMS,
};
