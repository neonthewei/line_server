require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const cloudinary = require("cloudinary").v2;
const { v4: uuidv4 } = require("uuid");
const cron = require("node-cron");

const app = express();
const port = process.env.PORT || 3000;

// 存儲用戶對話 ID 的映射
const userConversations = new Map();
// 存儲已處理的 webhook event IDs
const processedEvents = new Set();
// 設置過期時間（毫秒）
const EVENT_EXPIRY = 1000 * 60 * 5; // 5 minutes

// 管理員 Push 模式設置
let adminPushModeEnabled = false; // 管理員 Push 模式開關
const TARGET_USER_ID = "U82150395bb148926c8584e86daa26b0d"; // 指定接收消息的用戶 ID

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 定期清理過期的 event IDs
setInterval(() => {
  const now = Date.now();
  processedEvents.forEach(([id, timestamp]) => {
    if (now - timestamp > EVENT_EXPIRY) {
      processedEvents.delete(id);
    }
  });
}, EVENT_EXPIRY);

// Middleware
app.use(express.json());
app.use(cors());

// LINE Message Signature Verification
const verifyLineSignature = (req, res, next) => {
  console.log("Received webhook request:", {
    headers: req.headers,
    body: req.body,
  });

  const signature = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(JSON.stringify(req.body))
    .digest("base64");

  console.log("Calculated signature:", signature);
  console.log("Received signature:", req.headers["x-line-signature"]);

  if (signature !== req.headers["x-line-signature"]) {
    console.error("Signature verification failed");
    return res.status(403).json({ error: "Invalid signature" });
  }
  console.log("Signature verification passed");
  next();
};

// 檢查URL是否可訪問
async function isUrlAccessible(url) {
  try {
    const response = await axios.head(url, { timeout: 5000 });
    return response.status >= 200 && response.status < 300;
  } catch (error) {
    console.error(`URL不可訪問: ${url}`, error.message);
    return false;
  }
}

// Send message to Dify
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
        : "請分析這張圖片 user_id: ${userId}",
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
      `${process.env.DIFY_API_URL}?app_id=${process.env.DIFY_APP_ID}`,
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

// Send reply to LINE
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
    const MAX_MESSAGES_PER_REQUEST = 5;

    if (messages.length <= MAX_MESSAGES_PER_REQUEST) {
      // Send all messages in one request
      try {
        const response = await axios.post(
          "https://api.line.me/v2/bot/message/reply",
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
          "https://api.line.me/v2/bot/message/reply",
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
            "https://api.line.me/v2/bot/message/push",
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

// Display loading indicator in LINE chat
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

    const response = await axios.post(
      "https://api.line.me/v2/bot/chat/loading/start",
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
        },
      }
    );

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

// Get content from LINE
async function getLineContent(messageId) {
  try {
    console.log(`Getting content for message ID: ${messageId}`);
    const response = await axios({
      method: "get",
      url: `https://api-data.line.me/v2/bot/message/${messageId}/content`,
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

// Upload image to Cloudinary and get URL
async function uploadImageToCloudinary(imageBuffer) {
  try {
    console.log("Uploading image to Cloudinary...");
    // Convert buffer to base64
    const base64Image = imageBuffer.toString("base64");

    // Upload to Cloudinary with public access settings
    const result = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${base64Image}`,
      {
        folder: "line-bot-uploads",
        resource_type: "auto",
        public_id: `line_image_${Date.now()}`, // 確保唯一的文件名
        access_mode: "public", // 確保公開訪問
        overwrite: true,
      }
    );

    console.log("Image uploaded to Cloudinary:", result.secure_url);
    return result.secure_url;
  } catch (error) {
    console.error("Error uploading to Cloudinary:", error);
    throw error;
  }
}

// Upload audio to Cloudinary and get URL
async function uploadAudioToCloudinary(audioBuffer) {
  try {
    console.log("Uploading audio to Cloudinary...");
    // Convert buffer to base64
    const base64Audio = audioBuffer.toString("base64");

    // Upload to Cloudinary with public access settings
    // Use the correct audio/m4a MIME type
    const result = await cloudinary.uploader.upload(
      `data:audio/m4a;base64,${base64Audio}`,
      {
        folder: "line-bot-audio",
        resource_type: "auto",
        public_id: `line_audio_${Date.now()}`, // 確保唯一的文件名
        access_mode: "public", // 確保公開訪問
        overwrite: true,
      }
    );

    console.log("Audio uploaded to Cloudinary:", result.secure_url);
    return result.secure_url;
  } catch (error) {
    console.error("Error uploading audio to Cloudinary:", error);
    throw error;
  }
}

// Convert audio to text using Dify's audio-to-text API with Cloudinary URL
async function convertAudioToTextWithUrl(audioUrl, userId) {
  console.log("Converting audio to text using Dify API with URL");

  try {
    console.log("Sending audio URL to Dify audio-to-text API:", audioUrl);

    // Use child_process to execute curl command directly
    // This ensures the exact format required by the API
    const { execSync } = require("child_process");
    const curlCommand = `curl -X POST 'https://api.dify.ai/v1/audio-to-text' \
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

// Function to process Dify message and prepare LINE response
function processDifyMessage(difyMessage) {
  console.log("Processing Dify message for Flex Message extraction");
  console.log("Original message:", difyMessage);

  // Check if message is exactly "教學文檔" (Tutorial Document)
  if (
    (difyMessage && difyMessage.trim() === "教學文檔") ||
    (difyMessage && difyMessage.trim() === "旺來怎麼用") ||
    (difyMessage && difyMessage.trim() === "說明")
  ) {
    console.log("Tutorial document request detected");
    return createTutorialMessage();
  }

  // Always keep the original message intact to preserve IDs and types
  const originalMessage = difyMessage;

  // Array to store multiple flex messages
  const flexMessages = [];
  let remainingText = difyMessage;

  // Extract record IDs from the format [{"id":106}, {"id":107}]
  let recordIds = [];
  // Updated regex to handle the format [{"id":493}, {"id":494}],[{"type": "expense"}]
  // Now matches IDs that might be followed by a comma and the type information
  const idsRegex = /\[(\{"id":\d+\}(?:,\s*\{"id":\d+\})*)\](?:,\s*)?/;
  const idsMatch = difyMessage.match(idsRegex);

  if (idsMatch) {
    try {
      // Parse the matched IDs into an array
      const idsArray = JSON.parse(`[${idsMatch[1]}]`);
      recordIds = idsArray.map((item) => item.id);
      console.log("Extracted record IDs:", recordIds);
      // Don't remove IDs from the text anymore
    } catch (error) {
      console.error("Error parsing record IDs:", error);
    }
  }

  // Extract transaction type from the format [{"type": "expense"}] or [{"type": "income"}]
  let transactionType = "expense"; // Default to expense if not specified
  const typeRegex = /\[\{"type":\s*"([^"]+)"\}\]/;
  const typeMatch = difyMessage.match(typeRegex);

  if (typeMatch) {
    transactionType = typeMatch[1];
    console.log("Extracted transaction type:", transactionType);
    // Don't remove type from the text anymore
  }

  // Just clean up trailing commas and extra whitespace
  remainingText = difyMessage.trim();

  // Try to find JSON in code blocks first (for multi-record)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let codeBlockMatch;
  let foundJsonInCodeBlock = false;

  while ((codeBlockMatch = codeBlockRegex.exec(remainingText)) !== null) {
    const codeContent = codeBlockMatch[1].trim();
    console.log("Found code block content:", codeContent);

    // Check if it's a JSON array
    if (codeContent.startsWith("[") && codeContent.endsWith("]")) {
      try {
        const jsonArray = JSON.parse(codeContent);
        console.log(
          "Found JSON array in code block with",
          jsonArray.length,
          "records"
        );
        foundJsonInCodeBlock = true;

        // Process each record in the array
        jsonArray.forEach((record, index) => {
          // For multiple records, create a proper record_id format that matches [{"id":x}]
          // This preserves compatibility with both single and multiple record formats
          let record_id;
          if (recordIds.length > 0) {
            if (recordIds.length > 1) {
              // For multiple record IDs, use the actual ID at the correct index
              record_id = recordIds[index] || "";
            } else {
              // If we only have one record ID but multiple records, use the same ID for all
              record_id = recordIds[0] || "";
            }
          } else {
            record_id = "";
          }

          // Add record ID and transaction type to each record
          const recordWithId = {
            ...record,
            record_id: record_id,
            type: transactionType,
          };

          // If is_fixed is not present, set a default value
          if (recordWithId.is_fixed === undefined) {
            recordWithId.is_fixed = false;
          }

          // Create a Flex Message for this record
          const flexMessage = createFlexMessage(recordWithId);
          flexMessages.push(flexMessage);
        });

        // Remove the entire code block from the remaining text
        remainingText = remainingText.replace(codeBlockMatch[0], "").trim();
      } catch (error) {
        console.error("Error parsing JSON array in code block:", error);
      }
    }
    // Check if it's a single JSON object
    else if (codeContent.startsWith("{") && codeContent.endsWith("}")) {
      try {
        const jsonObject = JSON.parse(codeContent);
        console.log("Found single JSON object in code block:", jsonObject);
        foundJsonInCodeBlock = true;

        // Get the appropriate record ID
        let record_id = "";
        if (recordIds.length > 0) {
          record_id = recordIds[0] || "";
        }

        // Add record ID and transaction type to the record
        const recordWithId = {
          ...jsonObject,
          record_id: record_id,
          type: transactionType,
        };

        // If is_fixed is not present, set a default value
        if (recordWithId.is_fixed === undefined) {
          recordWithId.is_fixed = false;
        }

        // Create a Flex Message for this record
        const flexMessage = createFlexMessage(recordWithId);
        flexMessages.push(flexMessage);

        // Remove the entire code block from the remaining text
        remainingText = remainingText.replace(codeBlockMatch[0], "").trim();
      } catch (error) {
        console.error("Error parsing JSON object in code block:", error);
      }
    }
  }

  // If we didn't find JSON in code blocks, try other methods
  if (!foundJsonInCodeBlock) {
    // Try to find a JSON array directly in the text
    const jsonArrayRegex = /\[\s*\{\s*"category"[\s\S]*?\}\s*\]/;
    const jsonArrayMatch = remainingText.match(jsonArrayRegex);

    if (jsonArrayMatch) {
      try {
        // Parse the JSON array
        const jsonArray = JSON.parse(jsonArrayMatch[0]);
        console.log("Found JSON array with", jsonArray.length, "records");

        // Process each record in the array
        jsonArray.forEach((record, index) => {
          // For multiple records, handle record IDs properly
          let record_id;
          if (recordIds.length > 0) {
            if (recordIds.length > 1) {
              // For multiple record IDs, use the actual ID at the correct index
              record_id = recordIds[index] || "";
            } else {
              // If we only have one record ID but multiple records, use the same ID for all
              record_id = recordIds[0] || "";
            }
          } else {
            record_id = "";
          }

          // Add record ID and transaction type to each record
          const recordWithId = {
            ...record,
            record_id: record_id,
            type: transactionType,
          };

          // If is_fixed is not present, set a default value
          if (recordWithId.is_fixed === undefined) {
            recordWithId.is_fixed = false;
          }

          // Create a Flex Message for this record
          const flexMessage = createFlexMessage(recordWithId);
          flexMessages.push(flexMessage);
        });

        // Remove the JSON array from the remaining text
        remainingText = remainingText.replace(jsonArrayMatch[0], "").trim();
      } catch (error) {
        console.error("Error parsing JSON array:", error);
      }
    } else {
      // Try to find a single JSON object in curly braces
      const jsonObjectRegex = /\{\s*"(?:user_id|category)"[\s\S]*?\}/;
      const jsonObjectMatch = remainingText.match(jsonObjectRegex);

      if (jsonObjectMatch) {
        try {
          const jsonData = JSON.parse(jsonObjectMatch[0]);

          // Get the appropriate record ID
          let record_id = "";
          if (recordIds.length > 0) {
            record_id = recordIds[0] || "";
          }

          // Add record ID and transaction type
          jsonData.record_id = record_id;
          jsonData.type = transactionType;

          // If is_fixed is not present, set a default value
          if (jsonData.is_fixed === undefined) {
            jsonData.is_fixed = false;
          }

          console.log(
            "Successfully parsed JSON data:",
            JSON.stringify(jsonData, null, 2)
          );

          // Create a Flex Message
          const flexMessage = createFlexMessage(jsonData);
          flexMessages.push(flexMessage);

          // Remove the matched part from the remaining text
          remainingText = remainingText.replace(jsonObjectMatch[0], "").trim();
        } catch (error) {
          console.error("Error parsing JSON object:", error);
        }
      } else {
        // Try the exact format match as a last resort
        const exactFormatRegex =
          /以下是您本次的紀錄：\s*\n\{\s*\n\s*"category":\s*"([^"]+)",\s*\n\s*"amount":\s*(\d+),\s*\n\s*"memo":\s*"([^"]*)",\s*\n\s*"is_fixed":\s*(true|false),\s*\n\s*"user_id":\s*"([^"]*)",\s*\n\s*"datetime":\s*"([^"]+)"\s*\n\s*\}/;
        const exactMatch = remainingText.match(exactFormatRegex);

        if (exactMatch) {
          // Get the appropriate record ID
          let record_id = "";
          if (recordIds.length > 0) {
            record_id = recordIds[0] || "";
          }

          // Construct a clean JSON object from the matched groups
          const jsonData = {
            category: exactMatch[1],
            amount: parseInt(exactMatch[2], 10),
            memo: exactMatch[3],
            is_fixed: exactMatch[4] === "true",
            user_id: exactMatch[5],
            datetime: exactMatch[6],
            record_id: record_id, // Add the record ID to the data
            type: transactionType, // Add the transaction type to the data
          };

          console.log("Extracted data using exact format match:", jsonData);

          // Create a Flex Message from the extracted data
          const flexMessage = createFlexMessage(jsonData);
          flexMessages.push(flexMessage);

          // Remove the matched part from the remaining text
          remainingText = remainingText.replace(exactMatch[0], "").trim();
        }
      }
    }
  }

  // Clean up the message text by removing JSON objects, IDs, and type information
  const cleanedText = cleanMessageText(originalMessage);
  console.log("Cleaned message text:", cleanedText);

  // If we found any JSON objects, return them
  if (flexMessages.length > 0) {
    console.log(`Found ${flexMessages.length} JSON objects in total`);
    // We still clean up code blocks and JSON formatting, but keep IDs and types
    remainingText = remainingText
      .replace(/```json\s*```/g, "")
      .replace(/```\s*```/g, "")
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return {
      // Use the cleaned message text instead of the original
      text: cleanedText,
      flexMessages: flexMessages,
      type: transactionType,
    };
  }

  // If no JSON was found, return the cleaned message
  console.log("No JSON found in the message, sending as plain text");

  return {
    text: cleanedText,
    flexMessages: [],
    type: transactionType,
  };
}

// Function to clean message text by removing JSON objects, IDs, and type information
function cleanMessageText(message) {
  if (!message) return "";

  let cleanedText = message;

  // Remove JSON objects in code blocks
  cleanedText = cleanedText.replace(
    /```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/g,
    ""
  );

  // Remove JSON objects without code blocks
  cleanedText = cleanedText.replace(/\{[\s\S]*?\}/g, "");

  // Remove record ID arrays completely - e.g., [{"id":106}, {"id":107}]
  cleanedText = cleanedText.replace(
    /\[\s*\{\s*"id"\s*:\s*\d+\s*\}(?:\s*,\s*\{\s*"id"\s*:\s*\d+\s*\})*\s*\](?:\s*,\s*)?/g,
    ""
  );

  // Remove type information completely - e.g., [{"type": "expense"}]
  cleanedText = cleanedText.replace(
    /\[\s*\{\s*"type"\s*:\s*"[^"]+"\s*\}\s*\](?:\s*,\s*)?/g,
    ""
  );

  // Remove any ID-type combined pattern - e.g., [{"id":803}],[{"type": "expense"}]
  cleanedText = cleanedText.replace(
    /\[\s*\{\s*"id"\s*:\s*\d+\s*\}\s*\]\s*,\s*\[\s*\{\s*"type"\s*:\s*"[^"]+"\s*\}\s*\]/g,
    ""
  );

  // Remove any remaining empty brackets and comma combinations
  cleanedText = cleanedText.replace(/\[\s*\]\s*(?:,\s*\[\s*\])?/g, "");

  // Remove any bracket patterns with commas inside - e.g., [, ]
  cleanedText = cleanedText.replace(/\[\s*,\s*\]/g, "");

  // Remove any remaining square bracket patterns
  cleanedText = cleanedText.replace(/\[\s*[^\]]*\]/g, "");

  // Remove trailing commas
  cleanedText = cleanedText.replace(/,\s*$/g, "");

  // Remove any remaining empty code blocks
  cleanedText = cleanedText.replace(/```\s*```/g, "");
  cleanedText = cleanedText.replace(/```json\s*```/g, "");
  cleanedText = cleanedText.replace(/```/g, "");

  // Clean up multiple spaces, newlines and trim
  cleanedText = cleanedText.replace(/\s+/g, " ").trim();

  // If we have text like "以下是您本次的紀錄：" followed by nothing, remove it
  cleanedText = cleanedText.replace(/以下是您本次的紀錄：\s*$/, "");

  return cleanedText;
}

// Function to create a Flex Message using the template and data
function createFlexMessage(data) {
  console.log(
    "Creating Flex Message with data:",
    JSON.stringify(data, null, 2)
  );

  try {
    // Determine the pill/capsule text and color based on type and is_fixed
    let pillText = "支出";
    let pillColor = "#1DB446"; // Green for expense
    // Default padding values for non-fixed types
    let paddingStart = "0px";
    let paddingEnd = "0px";

    if (data.type === "income") {
      if (data.is_fixed) {
        pillText = "固定收入";
        pillColor = "#4A90E2"; // Blue for fixed income
        // Wider padding for fixed income
        paddingStart = "8px";
        paddingEnd = "8px";
      } else {
        pillText = "收入";
        pillColor = "#2D9CDB"; // Light blue for income
      }
    } else {
      // expense
      if (data.is_fixed) {
        pillText = "固定支出";
        pillColor = "#EB5757"; // Red for fixed expense
        // Wider padding for fixed expense
        paddingStart = "8px";
        paddingEnd = "8px";
      } else {
        pillText = "支出";
        pillColor = "#1DB446"; // Green for expense
      }
    }

    // Load the template from record.json
    const fs = require("fs");
    const path = require("path");
    const templatePath = path.join(__dirname, "record.json");
    const templateString = fs.readFileSync(templatePath, "utf8");

    // Format the record ID correctly for the edit button URL
    // For single record, just use the ID as is
    // For compound record ID, ensure it's properly JSON formatted
    let recordIdParam = "";
    if (data.record_id) {
      // Check if the record_id is already a string representation of an array or object
      if (
        typeof data.record_id === "string" &&
        (data.record_id.startsWith("[") || data.record_id.startsWith("{"))
      ) {
        // It's already a JSON string, use as is
        recordIdParam = encodeURIComponent(data.record_id);
      } else {
        // It's a simple ID, encode it directly
        recordIdParam = encodeURIComponent(data.record_id);
      }
    }

    // Replace placeholders with actual values
    let flexMessageString = templateString
      .replace("${category}", data.category || "未分類")
      .replace(/\${pillColor}/g, pillColor)
      .replace("${pillText}", pillText)
      .replace("${paddingStart}", paddingStart)
      .replace("${paddingEnd}", paddingEnd)
      .replace(
        '"flex": "${isFixed ? 3 : 2}"',
        `"flex": ${data.is_fixed ? 3 : 2}`
      )
      .replace("${amount}", data.amount)
      .replace("${memo}", data.memo || "無備註")
      .replace(
        "${datetime}",
        data.datetime || new Date().toISOString().split("T")[0]
      )
      .replace("${liffId}", process.env.LIFF_ID)
      .replace("${recordId}", recordIdParam)
      .replace("${type}", data.type || "expense"); // Add type parameter for the edit button

    // Parse the string back to JSON
    const flexMessage = JSON.parse(flexMessageString);

    console.log(
      "Created Flex Message structure:",
      JSON.stringify(flexMessage, null, 2)
    );
    return flexMessage;
  } catch (error) {
    console.error("Error creating Flex Message:", error);
    // Return a simple fallback Flex Message
    const fallbackMessage = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: data.category || "未分類",
            weight: "bold",
            color: pillColor || "#1DB446",
            size: "sm",
          },
          {
            type: "text",
            text: `$${data.amount}`,
            size: "xl",
            weight: "bold",
            margin: "md",
          },
          {
            type: "text",
            text: data.memo || "無備註",
            size: "sm",
            color: "#555555",
            margin: "md",
            wrap: true,
          },
          {
            type: "text",
            text: data.datetime || new Date().toISOString().split("T")[0],
            size: "xs",
            color: "#aaaaaa",
            margin: "md",
            wrap: true,
          },
        ],
      },
    };

    return fallbackMessage;
  }
}

// Convert audio to text using Dify's audio-to-text API
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
    const { execSync } = require("child_process");
    const curlCommand = `curl -X POST 'https://api.dify.ai/v1/audio-to-text' \
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

// 使用 OpenAI Whisper API 進行語音轉文字
async function convertAudioToTextWithWhisper(audioBuffer, userId) {
  console.log("Converting audio to text using OpenAI Whisper API");

  try {
    // 使用 FormData 和 axios 直接發送請求，不寫入文件系統
    const FormData = require("form-data");
    const axios = require("axios");

    // 創建 FormData 對象
    const formData = new FormData();

    // 將音頻 buffer 添加到 FormData
    formData.append("file", audioBuffer, {
      filename: `audio_${userId}_${Date.now()}.m4a`,
      contentType: "audio/m4a",
    });

    // 添加其他必要參數
    formData.append("model", "whisper-1");
    formData.append("language", "zh");
    formData.append("response_format", "text");

    console.log("Sending request to OpenAI Whisper API");

    // 發送請求到 OpenAI API
    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders(),
        },
      }
    );

    console.log("Whisper API response status:", response.status);

    // 獲取轉錄文本並去除首尾空白和換行符
    const transcribedText =
      typeof response.data === "string" ? response.data.trim() : "";
    console.log("Transcribed text:", transcribedText);

    // 返回轉錄文本
    return transcribedText;
  } catch (error) {
    console.error(
      "Error converting audio to text with Whisper:",
      error.message
    );
    if (error.response) {
      console.error("OpenAI API error details:", {
        status: error.response.status,
        data: error.response.data,
      });
    }
    throw new Error("Failed to convert audio to text with Whisper");
  }
}

// Webhook endpoint
app.post("/webhook", verifyLineSignature, async (req, res) => {
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
          if (userId === process.env.ADMIN_USER_ID) {
            // 管理員命令處理
            if (userMessage === "開啟Push模式") {
              toggleAdminPushMode(true);
              response = {
                type: "text",
                text: "已開啟 Push 模式。您發送的所有消息將被轉發給目標用戶。",
              };
              continue; // 跳過後續處理
            } else if (userMessage === "關閉Push模式") {
              toggleAdminPushMode(false);
              response = {
                type: "text",
                text: "已關閉 Push 模式。",
              };
              continue; // 跳過後續處理
            } else if (userMessage === "Push狀態") {
              response = {
                type: "text",
                text: `Push 模式目前${
                  adminPushModeEnabled ? "已開啟" : "已關閉"
                }`,
              };
              continue; // 跳過後續處理
            } else if (adminPushModeEnabled) {
              // 如果 Push 模式開啟，轉發消息給目標用戶
              try {
                await forwardMessageToTarget(userMessage);
                response = {
                  type: "text",
                  text: `已成功轉發消息給目標用戶。`,
                };
                continue; // 跳過後續處理
              } catch (error) {
                response = {
                  type: "text",
                  text: "消息轉發失敗，請稍後再試。",
                };
                continue; // 跳過後續處理
              }
            }
          }

          // 檢查訊息是否包含Cony
          isConyMessage = userMessage.includes("Cony");

          // 發送到Dify處理
          response = await sendToDify(userMessage, userId);
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

            // 2. 使用 OpenAI Whisper API 進行語音轉文字
            const transcribedText = await convertAudioToTextWithWhisper(
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

            // 創建訊息
            const messages = createMessagesFromResponse(
              responseWithUserId,
              isConyMessage
            );

            // 檢查訊息是否為空
            if (messages.length === 0) {
              console.log("No messages to send");
              continue;
            }

            // 檢查訊息結構
            console.log(
              "Sending messages to LINE:",
              JSON.stringify(messages, null, 2)
            );

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
});

// Helper function to create messages array from response
function createMessagesFromResponse(response, isConyMessage = false) {
  // Extract userId and text from message if it's an object
  const userId = typeof response === "object" ? response.userId : null;
  const messageText = typeof response === "object" ? response.text : response;
  const transcribedText =
    typeof response === "object" ? response.transcribedText : null;
  const responseType = typeof response === "object" ? response.type : null;

  // Process the message to check for JSON content that should be a Flex Message
  const processedMessage =
    responseType === "tutorial" ? response : processDifyMessage(messageText);
  const messages = [];

  // 1. 如果有轉錄文字，添加一個綠色背景的 Flex Message 到消息數組的最前面
  if (transcribedText && transcribedText.trim()) {
    const cleanTranscribedText = transcribedText.trim();
    const transcriptionFlexMessage = {
      type: "flex",
      altText: "語音訊息內容",
      contents: {
        type: "bubble",
        size: "kilo",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `：${cleanTranscribedText}`,
              wrap: true,
              color: "#FFFFFF",
              size: "md",
            },
          ],
          backgroundColor: "#1DB446",
          paddingAll: "12px",
          cornerRadius: "8px",
        },
      },
    };
    messages.push(transcriptionFlexMessage);
  }

  // 2. 添加 Flex Messages（記帳訊息或教學文檔，如果有）
  if (
    processedMessage.flexMessages &&
    processedMessage.flexMessages.length > 0
  ) {
    processedMessage.flexMessages.forEach((flexMessage, index) => {
      // Determine the appropriate altText based on the message type
      let altText = "已為您記帳！";

      if (processedMessage.type === "tutorial") {
        // For tutorial messages, use different alt text for each part
        altText = index === 0 ? "🍍旺來新手教學 (上)" : "🍍旺來新手教學 (下)";
      } else if (processedMessage.type === "income") {
        altText = "已為您記錄收入！";
      } else if (processedMessage.type === "expense") {
        altText = "已為您記錄支出！";
      }

      // Properly format the Flex Message with the required wrapper structure
      const flexMessageObj = {
        type: "flex",
        altText: altText,
        contents: flexMessage,
      };
      messages.push(flexMessageObj);
    });
  }

  // 3. 添加文字訊息（如果有）
  if (processedMessage.text && processedMessage.text.trim() !== "") {
    if (processedMessage.text.trim() !== "") {
      const textMessageObj = {
        type: "text",
        text: processedMessage.text,
      };

      // 如果是Cony訊息，添加sender信息
      if (isConyMessage) {
        textMessageObj.sender = {
          name: "Cony",
          iconUrl:
            "https://gcp-obs.line-scdn.net/0hERW2_cUbGn1qSwoc-HdlKlMdFgxZLw97BDMBHEYfTUxHKUEjVHhWB0pMQUpbKw58UzEFGk5OQkRFe1p4VS8",
        };
      }

      messages.push(textMessageObj);
    }
  }

  // 確保訊息數量不超過LINE的限制（5個）
  if (messages.length > 5) {
    console.log(`訊息數量超過LINE限制，截斷至5個訊息`);
    messages.splice(5);
  }

  // Add Quick Reply to the last message
  if (messages.length > 0) {
    messages[messages.length - 1].quickReply = {
      items: [
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
      ],
    };
  }

  // 檢查每個訊息的結構是否符合LINE的規範
  messages.forEach((msg, index) => {
    if (msg.type === "flex" && (!msg.contents || !msg.contents.type)) {
      console.error(
        `第${index}個Flex訊息結構不符合規範:`,
        JSON.stringify(msg, null, 2)
      );
    }
  });

  return messages;
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

/**
 * 切換管理員 Push 模式
 * @param {boolean} enabled - 是否啟用 Push 模式
 * @returns {boolean} - 當前 Push 模式狀態
 */
function toggleAdminPushMode(enabled) {
  adminPushModeEnabled = enabled;
  console.log(`管理員 Push 模式已${enabled ? "開啟" : "關閉"}`);
  return adminPushModeEnabled;
}

/**
 * 轉發管理員消息給目標用戶
 * @param {string} message - 要轉發的消息
 * @returns {Promise<Object>} - LINE API 響應
 */
async function forwardMessageToTarget(message) {
  try {
    console.log(`轉發消息給目標用戶 ${TARGET_USER_ID}: ${message}`);

    const response = await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: TARGET_USER_ID,
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

// Function to create a tutorial message using the split tutorial files
function createTutorialMessage() {
  console.log("Creating tutorial messages from split files");
  try {
    // Load both tutorial templates from the split files
    const fs = require("fs");
    const path = require("path");
    const tutorial1Path = path.join(__dirname, "pineapple_tutorial_part1.json");
    const tutorial2Path = path.join(__dirname, "pineapple_tutorial_part2.json");

    const tutorial1Content = fs.readFileSync(tutorial1Path, "utf8");
    const tutorial2Content = fs.readFileSync(tutorial2Path, "utf8");

    // Parse the JSON content
    const tutorial1Json = JSON.parse(tutorial1Content);
    const tutorial2Json = JSON.parse(tutorial2Content);

    console.log("Tutorial JSON files loaded successfully");

    // Prepare the tutorial flex messages
    const tutorialFlexMessages = [tutorial1Json, tutorial2Json];

    // Line API can only handle 5 messages per request
    // We're only sending tutorial flex messages here, so we're within the limit
    // But add this check as a safety measure for future modifications
    const MAX_FLEX_MESSAGES = 5;
    if (tutorialFlexMessages.length > MAX_FLEX_MESSAGES) {
      console.log(
        `Tutorial has too many parts (${tutorialFlexMessages.length}), truncating to ${MAX_FLEX_MESSAGES}`
      );
      tutorialFlexMessages.length = MAX_FLEX_MESSAGES;
    }

    return {
      text: "", // No text content needed
      flexMessages: tutorialFlexMessages, // Send both tutorial flex messages in order
      type: "tutorial", // Mark as a tutorial type message
    };
  } catch (error) {
    console.error("Error creating tutorial messages:", error);
    // Return a simple fallback text message
    return {
      text: "無法顯示教學文檔。請重新嘗試或聯繫客服。",
      flexMessages: [],
      type: "tutorial",
    };
  }
}
