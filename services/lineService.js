const axios = require("axios");
const { API_URLS, LINE_MESSAGE_LIMITS } = require("../config");

/**
 * Send reply to LINE
 */
async function replyToLine(replyToken, message, isConyMessage = false) {
  console.log("Sending reply to LINE:", {
    replyToken: replyToken,
    message: typeof message === "object" ? message.text : message,
    isConyMessage: isConyMessage,
  });

  try {
    // 使用 createMessagesFromResponse 函數創建訊息
    // 這可以確保所有訊息都會遵循相同的格式，包括添加 Quick Reply
    const messages = createMessagesFromResponse(message, isConyMessage);

    // If no messages to send, return early
    if (messages.length === 0) {
      console.log("No messages to send");
      return;
    }

    console.log(
      "Sending messages to LINE API:",
      JSON.stringify(messages, null, 2)
    );

    // Extract userId from message if it's an object (for push messaging if needed)
    const userId = typeof message === "object" ? message.userId : null;

    // LINE API has a limit of 5 messages per reply
    // If we have more than 5 messages, we need to split them into multiple requests
    const MAX_MESSAGES_PER_REQUEST =
      LINE_MESSAGE_LIMITS.MAX_MESSAGES_PER_REQUEST;

    if (messages.length <= MAX_MESSAGES_PER_REQUEST) {
      // Send all messages in one request
      try {
        const response = await axios.post(
          API_URLS.LINE_REPLY,
          {
            replyToken: replyToken,
            messages: messages,
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
            },
          }
        );
        console.log(
          "Successfully sent reply to LINE. Response:",
          JSON.stringify(response.data, null, 2)
        );
      } catch (lineError) {
        console.error("LINE API Error Details:", {
          status: lineError.response?.status,
          statusText: lineError.response?.statusText,
          data: lineError.response?.data,
          message: lineError.message,
          requestPayload: {
            replyToken: replyToken,
            messages: messages,
          },
        });
        throw lineError;
      }
    } else {
      // Split messages into chunks of MAX_MESSAGES_PER_REQUEST
      console.log(
        `Splitting ${messages.length} messages into multiple requests`
      );

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
        console.log(
          "Successfully sent first chunk to LINE. Response:",
          JSON.stringify(response.data, null, 2)
        );
      } catch (lineError) {
        console.error("LINE API Error Details for first chunk:", {
          status: lineError.response?.status,
          statusText: lineError.response?.statusText,
          data: lineError.response?.data,
          message: lineError.message,
        });
        throw lineError;
      }

      // For remaining messages, use push API
      if (!userId) {
        console.error("Cannot send remaining messages: No user ID available");
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
          console.log(
            `Successfully sent chunk ${
              i / MAX_MESSAGES_PER_REQUEST + 1
            } to LINE. Response:`,
            JSON.stringify(response.data, null, 2)
          );
        } catch (lineError) {
          console.error(
            `LINE API Error Details for chunk ${
              i / MAX_MESSAGES_PER_REQUEST + 1
            }:`,
            {
              status: lineError.response?.status,
              statusText: lineError.response?.statusText,
              data: lineError.response?.data,
              message: lineError.message,
            }
          );
          // Continue with other chunks even if one fails
        }
      }
    }
  } catch (error) {
    console.error("LINE API Error:", {
      error: error.response?.data || error.message,
      status: error.response?.status,
      config: error.config,
    });
  }
}

/**
 * Display loading indicator in LINE chat
 */
async function displayLoadingIndicator(userId) {
  console.log("Displaying loading indicator for user:", userId);
  try {
    const requestBody = {
      chatId: userId,
      loadingSeconds: 30, // Display loading for 30 seconds or until a message is sent
    };

    console.log(
      "Loading indicator request body:",
      JSON.stringify(requestBody, null, 2)
    );

    const response = await axios.post(API_URLS.LINE_LOADING, requestBody, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
      },
    });

    console.log("Loading indicator response:", {
      status: response.status,
      statusText: response.statusText,
      data: response.data,
    });

    console.log("Loading indicator displayed successfully");
  } catch (error) {
    console.error("Error displaying loading indicator:", {
      error: error.response?.data || error.message,
      status: error.response?.status,
      headers: error.response?.headers,
      config: error.config,
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
