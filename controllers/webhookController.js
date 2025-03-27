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
    console.log("處理 webhook 請求");
    const events = req.body.events;

    for (const event of events) {
      // 檢查是否已處理過此事件
      if (event.webhookEventId && processedEvents.has(event.webhookEventId)) {
        console.log("跳過重複事件:", event.webhookEventId);
        continue;
      }

      console.log(
        `處理事件 ID: ${event.webhookEventId || "無ID"}, 類型: ${event.type}`
      );

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
          console.log(`收到文字訊息 (${userMessage.length} 字元)`);

          // 處理管理員命令
          const adminResponse = await handleAdminCommand(userMessage, userId);
          if (adminResponse) {
            response = adminResponse;
            // 管理員命令已處理，跳過後續處理
          } else {
            // 檢查訊息是否包含Cony
            isConyMessage = userMessage.includes("Cony");

            // 發送到Dify處理，確保傳遞用戶 ID
            response = await sendToDify(userMessage, userId);
          }
        } else if (event.message.type === "image") {
          // 處理圖片訊息
          console.log("收到圖片訊息");

          try {
            // 1. 從LINE獲取圖片內容
            const imageContent = await getLineContent(event.message.id);
            console.log(
              "已獲取圖片內容，大小:",
              Buffer.byteLength(imageContent),
              "字節"
            );

            // 2. 上傳圖片到Cloudinary
            const imageUrl = await uploadImageToCloudinary(imageContent);
            console.log("圖片已上傳");

            // 3. 發送圖片URL到Dify
            response = await sendToDify(null, userId, imageUrl);
            console.log("已收到 Dify 回應");
          } catch (error) {
            console.error("處理圖片時發生錯誤:", error);
            response = "抱歉，處理圖片時發生錯誤";
          }
        } else if (event.message.type === "audio") {
          // 處理語音訊息
          console.log("收到語音訊息");
          console.log("語音訊息長度:", event.message.duration, "毫秒");

          try {
            // 1. 從LINE獲取語音內容
            const audioContent = await getLineContent(event.message.id);
            console.log(
              "已獲取語音內容，大小:",
              Buffer.byteLength(audioContent),
              "字節"
            );

            // 2. 使用 OpenAI 語音轉文字 API 進行轉錄
            const transcribedText = await convertAudioToText(
              audioContent,
              userId
            );
            console.log(
              "語音轉文字結果長度:",
              transcribedText ? transcribedText.length : 0,
              "字元"
            );

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
            console.error("處理語音訊息時發生錯誤:", error);
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
            console.log("成功使用 replyToken 回覆 LINE 用戶");
          } catch (error) {
            console.error(
              "發送訊息到 LINE 時出錯:",
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
    console.error("處理 webhook 時發生錯誤:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

module.exports = {
  handleWebhook,
  processedEvents,
};
