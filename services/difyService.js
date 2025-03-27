const axios = require("axios");
const { API_URLS } = require("../config");
const { execSync } = require("child_process");

// 存儲用戶對話 ID 的映射
const userConversations = new Map();

/**
 * 檢查URL是否可訪問
 */
async function isUrlAccessible(url) {
  try {
    const response = await axios.head(url, { timeout: 5000 });
    return response.status >= 200 && response.status < 300;
  } catch (error) {
    console.error(`URL不可訪問: ${url}`, error.message);
    return false;
  }
}

/**
 * Send message to Dify
 */
async function sendToDify(userMessage, userId, imageUrl = null) {
  console.log("發送訊息到 Dify:", {
    messageType: userMessage ? "文字" : "圖片分析",
    messageLength: userMessage ? userMessage.length : 0,
    userId: userId ? userId.substring(0, 5) + "..." : null,
    hasImage: !!imageUrl,
  });

  // 如果用戶輸入 "delete"，清空對話 ID
  if (userMessage?.toLowerCase() === "delete") {
    userConversations.delete(userId);
    return "對話已重置，讓我們開始新的對話吧！";
  }

  try {
    // 如果有圖片URL，先檢查是否可訪問
    if (imageUrl) {
      const isAccessible = await isUrlAccessible(imageUrl);
      if (!isAccessible) {
        console.error(`圖片URL不可訪問`);
        return "抱歉，無法處理您的圖片，請稍後再試。";
      }
      console.log(`圖片URL可訪問`);
    }

    // 準備請求體
    const requestBody = {
      inputs: {},
      query: userMessage
        ? `${userMessage} user_id: ${userId}`
        : `請分析這張圖片 user_id: ${userId}`,
      response_mode: "blocking",
      conversation_id: userConversations.get(userId) || "",
      user: userId,
    };

    // 如果有圖片URL，添加到files參數
    if (imageUrl) {
      // 根據Dify API文檔格式化圖片數據
      // 參考: https://docs.dify.ai/v/zh-hans/api-reference/chat-service
      requestBody.files = [
        {
          type: "image",
          transfer_method: "remote_url",
          url: imageUrl,
        },
      ];

      // 確保query不為空
      if (!userMessage) {
        requestBody.query = `請分析這張圖片 user_id: ${userId}`;
      }

      console.log("請求中包含圖片");
    }

    console.log("開始發送請求到 Dify");

    // 發送請求到Dify
    const response = await axios.post(
      `${API_URLS.DIFY_API}?app_id=${process.env.DIFY_APP_ID}`,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // 簡化日誌輸出
    console.log("Dify 回應狀態:", response.status);

    // 如果是新對話，保存 conversation_id
    if (response.data.conversation_id && !userConversations.has(userId)) {
      userConversations.set(userId, response.data.conversation_id);
      console.log("創建新對話:", {
        userId: userId.substring(0, 5) + "...",
        conversationId: response.data.conversation_id.substring(0, 5) + "...",
      });
    }

    console.log("成功獲取 Dify 回應，回應長度:", response.data.answer.length);
    return response.data.answer;
  } catch (error) {
    console.error("Dify API 錯誤:", {
      status: error.response?.status,
      message: error.message,
    });
    return "抱歉，我現在無法回應，請稍後再試。";
  }
}

/**
 * Convert audio to text using Dify's audio-to-text API with Cloudinary URL
 */
async function convertAudioToTextWithUrl(audioUrl, userId) {
  console.log("使用 URL 將音頻轉換為文字");

  try {
    console.log("開始發送音頻 URL 到 Dify API");

    // Use child_process to execute curl command directly
    // This ensures the exact format required by the API
    const curlCommand = `curl -X POST '${API_URLS.DIFY_AUDIO_TO_TEXT}' \
      -H 'Authorization: Bearer ${process.env.DIFY_API_KEY}' \
      -H 'Content-Type: application/json' \
      -d '{"audio_url": "${audioUrl}", "user": "${userId}"}'`;

    const result = execSync(curlCommand).toString();
    console.log("音頻轉換成功");

    // Parse the result as JSON
    const response = JSON.parse(result);

    // Return the transcribed text
    return response.text || "";
  } catch (error) {
    console.error("使用 URL 轉換音頻為文字時出錯:", error.message);
    throw new Error("Failed to convert audio to text with URL");
  }
}

/**
 * Convert audio to text using Dify's audio-to-text API
 */
async function convertAudioToText(audioBuffer, userId) {
  console.log("開始將音頻轉換為文字");

  try {
    const fs = require("fs");
    const path = require("path");

    // Create a temporary file path with the correct M4A extension
    const tempFilePath = `./temp_audio_${userId}_${Date.now()}.m4a`;

    // Write the audio buffer to a temporary file
    fs.writeFileSync(tempFilePath, audioBuffer);
    console.log(`已保存音頻到臨時文件`);

    // Use axios to send a multipart/form-data request
    // Create form data manually to match the expected format
    const FormData = require("form-data");
    const form = new FormData();

    // Add the file to the form data
    const fileStream = fs.createReadStream(tempFilePath);
    form.append("file", fileStream);

    console.log("開始發送音頻到 Dify API");

    // Use child_process to execute curl command directly
    // This ensures the exact format required by the API
    const curlCommand = `curl -X POST '${API_URLS.DIFY_AUDIO_TO_TEXT}' \
      -H 'Authorization: Bearer ${process.env.DIFY_API_KEY}' \
      -F 'file=@${tempFilePath};type=audio/m4a' \
      -F 'user=${userId}'`;

    const result = execSync(curlCommand).toString();
    console.log("音頻轉換成功");

    // Parse the result as JSON
    const response = JSON.parse(result);

    // Clean up the temporary file
    fs.unlinkSync(tempFilePath);
    console.log(`已刪除臨時文件`);

    // Return the transcribed text
    return response.text || "";
  } catch (error) {
    console.error("轉換音頻為文字時出錯:", error.message);
    throw new Error("Failed to convert audio to text");
  }
}

module.exports = {
  sendToDify,
  convertAudioToTextWithUrl,
  convertAudioToText,
  userConversations,
};
