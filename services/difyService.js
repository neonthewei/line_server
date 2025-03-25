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
  console.log("Sending message to Dify:", {
    message: userMessage,
    userId: userId,
    imageUrl: imageUrl,
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
        console.error(`圖片URL不可訪問: ${imageUrl}`);
        return "抱歉，無法處理您的圖片，請稍後再試。";
      }
      console.log(`圖片URL可訪問: ${imageUrl}`);
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

      console.log(
        "Adding image to request with correct format:",
        JSON.stringify(requestBody.files, null, 2)
      );
    }

    console.log(
      "Sending request to Dify:",
      JSON.stringify(requestBody, null, 2)
    );

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

    // 詳細記錄Dify的響應，包括sys.files字段
    console.log("Dify response status:", response.status);
    console.log(
      "Dify response headers:",
      JSON.stringify(response.headers, null, 2)
    );
    console.log("Dify response data:", JSON.stringify(response.data, null, 2));

    if (response.data.metadata) {
      console.log(
        "Dify metadata:",
        JSON.stringify(response.data.metadata, null, 2)
      );
    }

    // 如果是新對話，保存 conversation_id
    if (response.data.conversation_id && !userConversations.has(userId)) {
      userConversations.set(userId, response.data.conversation_id);
      console.log("New conversation created:", {
        userId,
        conversationId: response.data.conversation_id,
      });
    }

    return response.data.answer;
  } catch (error) {
    console.error("Dify API Error:", {
      error: error.response?.data || error.message,
      status: error.response?.status,
      config: error.config,
    });
    return "抱歉，我現在無法回應，請稍後再試。";
  }
}

/**
 * Convert audio to text using Dify's audio-to-text API with Cloudinary URL
 */
async function convertAudioToTextWithUrl(audioUrl, userId) {
  console.log("Converting audio to text using Dify API with URL");

  try {
    console.log("Sending audio URL to Dify audio-to-text API:", audioUrl);

    // Use child_process to execute curl command directly
    // This ensures the exact format required by the API
    const curlCommand = `curl -X POST '${API_URLS.DIFY_AUDIO_TO_TEXT}' \
      -H 'Authorization: Bearer ${process.env.DIFY_API_KEY}' \
      -H 'Content-Type: application/json' \
      -d '{"audio_url": "${audioUrl}", "user": "${userId}"}'`;

    console.log("Executing curl command:", curlCommand);

    const result = execSync(curlCommand).toString();
    console.log("Curl command result:", result);

    // Parse the result as JSON
    const response = JSON.parse(result);

    // Return the transcribed text
    return response.text || "";
  } catch (error) {
    console.error("Error converting audio to text with URL:", error.message);
    throw new Error("Failed to convert audio to text with URL");
  }
}

/**
 * Convert audio to text using Dify's audio-to-text API
 */
async function convertAudioToText(audioBuffer, userId) {
  console.log("Converting audio to text using Dify API");

  try {
    const fs = require("fs");
    const path = require("path");

    // Create a temporary file path with the correct M4A extension
    const tempFilePath = `./temp_audio_${userId}_${Date.now()}.m4a`;

    // Write the audio buffer to a temporary file
    fs.writeFileSync(tempFilePath, audioBuffer);
    console.log(`Saved audio to temporary file: ${tempFilePath}`);

    // Use axios to send a multipart/form-data request
    // Create form data manually to match the expected format
    const FormData = require("form-data");
    const form = new FormData();

    // Add the file to the form data
    const fileStream = fs.createReadStream(tempFilePath);
    form.append("file", fileStream);

    console.log("Sending audio to Dify audio-to-text API");

    // Use child_process to execute curl command directly
    // This ensures the exact format required by the API
    const curlCommand = `curl -X POST '${API_URLS.DIFY_AUDIO_TO_TEXT}' \
      -H 'Authorization: Bearer ${process.env.DIFY_API_KEY}' \
      -F 'file=@${tempFilePath};type=audio/m4a' \
      -F 'user=${userId}'`;

    console.log("Executing curl command:", curlCommand);

    const result = execSync(curlCommand).toString();
    console.log("Curl command result:", result);

    // Parse the result as JSON
    const response = JSON.parse(result);

    // Clean up the temporary file
    fs.unlinkSync(tempFilePath);
    console.log(`Deleted temporary file: ${tempFilePath}`);

    // Return the transcribed text
    return response.text || "";
  } catch (error) {
    console.error("Error converting audio to text:", error.message);
    throw new Error("Failed to convert audio to text");
  }
}

module.exports = {
  sendToDify,
  convertAudioToTextWithUrl,
  convertAudioToText,
  userConversations,
};
