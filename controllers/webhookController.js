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
const { extractSummaryData } = require("../utils/difyMessageProcessor");
const {
  createSummaryMessage,
  createBalanceSummaryMessage,
} = require("../utils/flexMessage");

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
            // 檢查是否是"餘額"關鍵詞
            const trimmedMessage = userMessage.trim();

            if (trimmedMessage === "餘額") {
              console.log(`收到餘額關鍵詞請求`);

              try {
                // 獲取月摘要數據
                const summaryData = await extractSummaryData(
                  "月結餘",
                  "月結餘",
                  userId
                );

                if (summaryData) {
                  console.log("創建餘額摘要數據:", summaryData);

                  // 創建簡化版的餘額摘要 Flex 訊息
                  const balanceSummaryMessage =
                    createBalanceSummaryMessage(summaryData);

                  // 確保創建成功
                  if (!balanceSummaryMessage) {
                    console.error("無法創建餘額摘要 Flex 訊息");
                    response = "抱歉，無法生成餘額摘要報告。";
                    continue;
                  }

                  console.log("成功創建餘額摘要 Flex 訊息");

                  // 創建回應
                  response = {
                    text: "", // 不顯示文本介紹
                    flexMessages: [balanceSummaryMessage],
                    type: "balance_summary",
                    userId: userId,
                  };

                  console.log(`創建了餘額摘要 Flex 訊息，準備發送`);
                } else {
                  response = "抱歉，無法獲取您的餘額摘要數據。";
                }
              } catch (error) {
                console.error("處理餘額關鍵詞時出錯:", error);
                response = "抱歉，處理您的餘額請求時發生錯誤。";
              }
            }
            // 檢查是否是直接的摘要關鍵詞請求
            else if (
              [
                "日支出",
                "日收入",
                "週支出",
                "週收入",
                "月支出",
                "月收入",
              ].includes(trimmedMessage)
            ) {
              console.log(`收到直接摘要關鍵詞: ${trimmedMessage}`);

              // 轉換為完整關鍵詞格式 (添加 "總結")
              const fullKeyword = `${trimmedMessage}總結`;

              try {
                // 使用 extractSummaryData 和 createSummaryMessage 獲取摘要數據
                const summaryData = await extractSummaryData(
                  fullKeyword,
                  fullKeyword,
                  userId
                );

                if (summaryData) {
                  console.log("創建摘要數據:", summaryData);

                  // 創建摘要 Flex 訊息
                  const summaryFlexMessage = createSummaryMessage(summaryData);

                  // 確保創建成功
                  if (!summaryFlexMessage) {
                    console.error("無法創建摘要 Flex 訊息");
                    response = "抱歉，無法生成摘要報告。";
                    continue;
                  }

                  console.log(
                    "成功創建摘要 Flex 訊息，長度:",
                    JSON.stringify(summaryFlexMessage).length
                  );

                  // 根據期間類型生成適合的回應文本
                  const periodMatch = /^(日|週|月)/.exec(trimmedMessage);
                  const periodType = periodMatch ? periodMatch[1] : "";
                  const transactionType = /支出|收入/.exec(trimmedMessage)[0];

                  // 獲取台灣時間的當前日期
                  const options = {
                    timeZone: "Asia/Taipei",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  };
                  const taiwanDate = new Date().toLocaleString(
                    "zh-TW",
                    options
                  );

                  // 不再生成回應文字
                  // const responseText = `這是您的本${periodType}${transactionType}報告 (${taiwanDate})`;

                  // 創建彈性訊息作為回應，文本設為空字符串
                  response = {
                    text: "", // 設置為空字符串，不發送文本介紹
                    flexMessages: [summaryFlexMessage],
                    type: "summary",
                    userId: userId,
                  };

                  // 更明確的日誌
                  console.log(
                    `創建了摘要 Flex 訊息，無文本介紹，僅發送 Flex 消息`
                  );
                } else {
                  response = "抱歉，無法獲取您請求的摘要數據。";
                }
              } catch (error) {
                console.error("處理摘要關鍵詞時出錯:", error);
                response = "抱歉，處理您的摘要請求時發生錯誤。";
              }
            } else {
              // 檢查訊息是否包含Cony
              isConyMessage = userMessage.includes("Cony");

              // 發送到Dify處理，確保傳遞用戶 ID
              response = await sendToDify(userMessage, userId);
            }
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
