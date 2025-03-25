const FormData = require("form-data");
const axios = require("axios");
const { API_URLS } = require("../config");

/**
 * 使用 OpenAI 語音轉文字 API 進行轉錄
 */
async function convertAudioToText(audioBuffer, userId) {
  console.log("Converting audio to text using OpenAI Transcription API");

  try {
    // 使用 FormData 和 axios 直接發送請求，不寫入文件系統
    // 創建 FormData 對象
    const formData = new FormData();

    // 將音頻 buffer 添加到 FormData
    formData.append("file", audioBuffer, {
      filename: `audio_${userId}_${Date.now()}.m4a`,
      contentType: "audio/m4a",
    });

    // 添加其他必要參數
    formData.append("model", "gpt-4o-transcribe");
    formData.append("language", "zh");
    formData.append("response_format", "text");

    console.log("Sending request to OpenAI Transcription API");

    // 發送請求到 OpenAI API
    const response = await axios.post(API_URLS.OPENAI_API, formData, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders(),
      },
    });

    console.log("Transcription API response status:", response.status);

    // 獲取轉錄文本並去除首尾空白和換行符
    const transcribedText =
      typeof response.data === "string" ? response.data.trim() : "";
    console.log("Transcribed text:", transcribedText);

    // 返回轉錄文本
    return transcribedText;
  } catch (error) {
    console.error("Error converting audio to text:", error.message);
    if (error.response) {
      console.error("OpenAI API error details:", {
        status: error.response.status,
        data: error.response.data,
      });
    }
    throw new Error("Failed to convert audio to text");
  }
}

module.exports = {
  convertAudioToText,
};
