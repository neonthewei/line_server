const { EVENT_EXPIRY } = require("../config");
const { sendToDify } = require("../services/difyService");
const {
  replyToLine,
  displayLoadingIndicator,
  getLineContent,
} = require("../services/lineService");
const { uploadImageToCloudinary } = require("../services/cloudinaryService");
const { convertAudioToText } = require("../services/audioService");
const { handleAdminCommand } = require("./adminController");

// 存儲已處理的 webhook event IDs
const processedEvents = new Set();

// 定期清理過期的 event IDs
setInterval(() => {
  const now = Date.now();
  processedEvents.forEach(([id, timestamp]) => {
    if (now - timestamp > EVENT_EXPIRY) {
      processedEvents.delete(id);
    }
  });
}, EVENT_EXPIRY);

/**
 * 處理webhook請求
 */
async function handleWebhook(req, res) {
  try {
    console.log("Processing webhook request");
    const events = req.body.events;

    for (const event of events) {
      // 檢查是否已處理過此事件
      if (event.webhookEventId && processedEvents.has(event.webhookEventId)) {
        console.log("Skipping duplicate event:", event.webhookEventId);
        continue;
      }

      console.log("Processing event:", JSON.stringify(event, null, 2));

      if (event.type === "message") {
        const userId = event.source.userId;
        const replyToken = event.replyToken;
        let response;
        let isConyMessage = false;

        // Display loading indicator before processing
        await displayLoadingIndicator(userId);

        if (event.message.type === "text") {
          // 處理文字訊息
          const userMessage = event.message.text;
          console.log("Received text message:", userMessage);

          // 處理管理員命令
          const adminResponse = await handleAdminCommand(userMessage, userId);
          if (adminResponse) {
            response = adminResponse;
            // 管理員命令已處理，跳過後續處理
          } else {
            // 檢查訊息是否包含Cony
            isConyMessage = userMessage.includes("Cony");

            // 發送到Dify處理
            response = await sendToDify(userMessage, userId);
          }
        } else if (event.message.type === "image") {
          // 處理圖片訊息
          console.log("Received image message");

          try {
            // 1. 從LINE獲取圖片內容
            const imageContent = await getLineContent(event.message.id);
            console.log(
              "Image content received, size:",
              Buffer.byteLength(imageContent),
              "bytes"
            );

            // 2. 上傳圖片到Cloudinary
            const imageUrl = await uploadImageToCloudinary(imageContent);
            console.log("Image uploaded, URL:", imageUrl);

            // 3. 發送圖片URL到Dify
            response = await sendToDify(null, userId, imageUrl);
            console.log("Dify response received:", response);
          } catch (error) {
            console.error("Error processing image:", error);
            response = "抱歉，處理圖片時發生錯誤";
          }
        } else if (event.message.type === "audio") {
          // 處理語音訊息
          console.log("Received audio message");
          console.log("Audio message details:", {
            id: event.message.id,
            duration: event.message.duration,
            contentProvider: event.message.contentProvider,
          });

          try {
            // 1. 從LINE獲取語音內容
            const audioContent = await getLineContent(event.message.id);
            console.log(
              "Audio content received, size:",
              Buffer.byteLength(audioContent),
              "bytes"
            );
            console.log("Audio content type:", typeof audioContent);

            // 2. 使用 OpenAI 語音轉文字 API 進行轉錄
            const transcribedText = await convertAudioToText(
              audioContent,
              userId
            );
            console.log("Transcribed text:", transcribedText);

            // 3. 如果成功轉換為文字，發送到Dify處理
            if (transcribedText) {
              // 直接發送轉換後的文字到Dify處理，不先回覆用戶
              const difyResponse = await sendToDify(transcribedText, userId);

              // 創建一個包含轉錄文字的響應對象
              response = {
                text: difyResponse,
                userId: userId,
                transcribedText: transcribedText, // 添加轉錄文字
              };
            } else {
              response = "抱歉，無法識別您的語音訊息，請再試一次。";
            }
          } catch (error) {
            console.error("Error processing audio:", error);
            response = "抱歉，處理語音訊息時發生錯誤";
          }
        }

        // 回覆用戶
        if (response) {
          try {
            // 確保 responseWithUserId 是一個對象
            let responseWithUserId;
            if (typeof response === "object") {
              // Keep the response text as is, don't clean it
              responseWithUserId = response;
            } else {
              // Don't clean up string responses
              responseWithUserId = {
                text: response,
                userId: userId,
              };
            }

            // 使用 replyToLine 函數通過 reply API 回覆用戶
            // 注意：displayLoadingIndicator 不會消耗 replyToken
            await replyToLine(replyToken, responseWithUserId, isConyMessage);
            console.log("Successfully replied to LINE using replyToken");
          } catch (error) {
            console.error(
              "Error sending message to LINE:",
              error.response?.data || error.message
            );
          }
        }
      }

      // 將已處理的事件ID添加到集合中
      if (event.webhookEventId) {
        processedEvents.add([event.webhookEventId, Date.now()]);
      }
    }

    res.status(200).end();
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

module.exports = {
  handleWebhook,
  processedEvents,
};
