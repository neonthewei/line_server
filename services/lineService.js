const axios = require("axios");
const { API_URLS, LINE_MESSAGE_LIMITS } = require("../config");

/**
 * Send reply to LINE
 */
async function replyToLine(replyToken, message, isConyMessage = false) {
  console.log("準備回覆給 LINE 用戶", {
    replyToken: replyToken.substring(0, 5) + "...",
    messageType: typeof message === "object" ? "object" : "string",
    isConyMessage: isConyMessage,
  });

  try {
    // 檢查消息中是否包含 flexMessages
    if (typeof message === "object" && message.flexMessages) {
      console.log(`消息包含 ${message.flexMessages.length} 個 Flex 消息`);
      if (message.flexMessages.length > 0) {
        console.log(
          `第一個 Flex 消息類型: ${message.flexMessages[0].type || "未知"}`
        );
      }
    }

    // 使用 createMessagesFromResponse 函數創建訊息
    // 這可以確保所有訊息都會遵循相同的格式，包括添加 Quick Reply
    // 因為 createMessagesFromResponse 現在是非同步的，我們需要使用 await
    const messages = await createMessagesFromResponse(message, isConyMessage);

    // If no messages to send, return early
    if (messages.length === 0) {
      console.log("沒有訊息需要發送");
      return;
    }

    console.log(`準備發送 ${messages.length} 條訊息給用戶`);
    // 輸出更多訊息類型信息，幫助診斷
    messages.forEach((msg, index) => {
      console.log(`訊息 #${index + 1} 類型: ${msg.type}`);
      if (msg.type === "flex") {
        console.log(`Flex 訊息 #${index + 1} altText: ${msg.altText}`);
      }
    });

    // Extract userId from message if it's an object (for push messaging if needed)
    const userId = typeof message === "object" ? message.userId : null;

    // LINE API has a limit of 5 messages per reply
    // If we have more than 5 messages, we need to split them into multiple requests
    const MAX_MESSAGES_PER_REQUEST =
      LINE_MESSAGE_LIMITS.MAX_MESSAGES_PER_REQUEST;

    if (messages.length <= MAX_MESSAGES_PER_REQUEST) {
      // Send all messages in one request
      try {
        console.log(`使用回覆令牌 ${replyToken.substring(0, 5)}... 發送訊息`);

        const requestData = {
          replyToken: replyToken,
          messages: messages,
        };

        const response = await axios.post(API_URLS.LINE_REPLY, requestData, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
          },
        });
        console.log("成功回覆 LINE 用戶");
      } catch (lineError) {
        console.error("LINE API 錯誤:", {
          status: lineError.response?.status,
          statusText: lineError.response?.statusText,
          data: lineError.response?.data,
          message: lineError.message,
        });
        throw lineError;
      }
    } else {
      // Split messages into chunks of MAX_MESSAGES_PER_REQUEST
      console.log(`訊息數量超過限制，將分為多個請求發送`);

      // Send the first chunk using reply API
      const firstChunk = messages.slice(0, MAX_MESSAGES_PER_REQUEST);
      try {
        const response = await axios.post(
          API_URLS.LINE_REPLY,
          {
            replyToken: replyToken,
            messages: firstChunk,
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
            },
          }
        );
        console.log("成功發送第一批訊息");
      } catch (lineError) {
        console.error("發送第一批訊息時出錯:", {
          status: lineError.response?.status,
          statusText: lineError.response?.statusText,
          message: lineError.message,
        });
        throw lineError;
      }

      // For remaining messages, use push API
      if (!userId) {
        console.error("無法發送剩餘訊息: 沒有用戶 ID");
        return;
      }

      // Send remaining chunks using push API
      for (
        let i = MAX_MESSAGES_PER_REQUEST;
        i < messages.length;
        i += MAX_MESSAGES_PER_REQUEST
      ) {
        const chunk = messages.slice(i, i + MAX_MESSAGES_PER_REQUEST);
        try {
          const response = await axios.post(
            API_URLS.LINE_PUSH,
            {
              to: userId,
              messages: chunk,
            },
            {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
              },
            }
          );
          console.log(`成功發送第 ${i / MAX_MESSAGES_PER_REQUEST + 1} 批訊息`);
        } catch (lineError) {
          console.error(
            `發送第 ${i / MAX_MESSAGES_PER_REQUEST + 1} 批訊息時出錯:`,
            {
              status: lineError.response?.status,
              message: lineError.message,
            }
          );
          // Continue with other chunks even if one fails
        }
      }
    }
  } catch (error) {
    console.error("LINE API 錯誤:", {
      error: error.response?.data || error.message,
      status: error.response?.status,
    });
  }
}

/**
 * Display loading indicator in LINE chat
 */
async function displayLoadingIndicator(userId) {
  console.log("顯示加載指示器，用戶 ID:", userId.substring(0, 5) + "...");
  try {
    const requestBody = {
      chatId: userId,
      loadingSeconds: 30, // Display loading for 30 seconds or until a message is sent
    };

    const response = await axios.post(API_URLS.LINE_LOADING, requestBody, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
      },
    });

    if (response.status === 200) {
      console.log("成功顯示加載指示器");
    }
  } catch (error) {
    console.error("顯示加載指示器時出錯:", {
      status: error.response?.status,
      message: error.message,
    });
  }
}

/**
 * Get content from LINE
 */
async function getLineContent(messageId) {
  try {
    console.log(`Getting content for message ID: ${messageId}`);
    const response = await axios({
      method: "get",
      url: `${API_URLS.LINE_CONTENT}${messageId}/content`,
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
      },
    });
    console.log(`Successfully retrieved content for message ID: ${messageId}`);
    return response.data;
  } catch (error) {
    console.error("Error getting content from LINE:", error);
    throw error;
  }
}

/**
 * Forward message to target user
 * @param {string} message - Message to forward
 * @param {string} targetUserId - User ID to forward to
 * @returns {Promise<Object>} - LINE API response
 */
async function forwardMessageToTarget(message, targetUserId) {
  try {
    console.log(`轉發消息給目標用戶 ${targetUserId}: ${message}`);

    const response = await axios.post(
      API_URLS.LINE_PUSH,
      {
        to: targetUserId,
        messages: [
          {
            type: "text",
            text: `管理員消息: ${message}`,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
        },
      }
    );

    console.log("消息轉發成功:", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "消息轉發失敗:",
      error.response ? error.response.data : error.message
    );
    throw error;
  }
}

// Helper function imported from utils
const { createMessagesFromResponse } = require("../utils/messageProcessing");

module.exports = {
  replyToLine,
  displayLoadingIndicator,
  getLineContent,
  forwardMessageToTarget,
};
