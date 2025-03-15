require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

// 存儲用戶對話 ID 的映射
const userConversations = new Map();
// 存儲已處理的 webhook event IDs
const processedEvents = new Set();
// 設置過期時間（毫秒）
const EVENT_EXPIRY = 1000 * 60 * 5; // 5 minutes

// 記帳提醒設置
let reminderEnabled = true; // 提醒開關，默認開啟
const reminderUserIds = new Map(); // 存儲需要接收提醒的用戶 ID

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
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
  console.log('Received webhook request:', {
    headers: req.headers,
    body: req.body
  });

  const signature = crypto
    .createHmac('SHA256', process.env.LINE_CHANNEL_SECRET)
    .update(JSON.stringify(req.body))
    .digest('base64');
  
  console.log('Calculated signature:', signature);
  console.log('Received signature:', req.headers['x-line-signature']);
  
  if (signature !== req.headers['x-line-signature']) {
    console.error('Signature verification failed');
    return res.status(403).json({ error: 'Invalid signature' });
  }
  console.log('Signature verification passed');
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
  console.log('Sending message to Dify:', {
    message: userMessage,
    userId: userId,
    imageUrl: imageUrl
  });

  // 如果用戶輸入 "delete"，清空對話 ID
  if (userMessage?.toLowerCase() === 'delete') {
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
      query: userMessage ? `${userMessage} user_id: ${userId}` : "請分析這張圖片 user_id: ${userId}",
      response_mode: "blocking",
      conversation_id: userConversations.get(userId) || '',
      user: userId
    };

    // 如果有圖片URL，添加到files參數
    if (imageUrl) {
      // 根據Dify API文檔格式化圖片數據
      // 參考: https://docs.dify.ai/v/zh-hans/api-reference/chat-service
      requestBody.files = [
        {
          type: "image",
          transfer_method: "remote_url",
          url: imageUrl
        }
      ];
      
      // 確保query不為空
      if (!userMessage) {
        requestBody.query = `請分析這張圖片 user_id: ${userId}`;
      }
      
      console.log('Adding image to request with correct format:', JSON.stringify(requestBody.files, null, 2));
    }

    console.log('Sending request to Dify:', JSON.stringify(requestBody, null, 2));

    // 發送請求到Dify
    const response = await axios.post(
      `${process.env.DIFY_API_URL}?app_id=${process.env.DIFY_APP_ID}`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${process.env.DIFY_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // 詳細記錄Dify的響應，包括sys.files字段
    console.log('Dify response status:', response.status);
    console.log('Dify response headers:', JSON.stringify(response.headers, null, 2));
    console.log('Dify response data:', JSON.stringify(response.data, null, 2));
    
    if (response.data.metadata) {
      console.log('Dify metadata:', JSON.stringify(response.data.metadata, null, 2));
    }
    
    // 如果是新對話，保存 conversation_id
    if (response.data.conversation_id && !userConversations.has(userId)) {
      userConversations.set(userId, response.data.conversation_id);
      console.log('New conversation created:', {
        userId,
        conversationId: response.data.conversation_id
      });
    }

    return response.data.answer;
  } catch (error) {
    console.error('Dify API Error:', {
      error: error.response?.data || error.message,
      status: error.response?.status,
      config: error.config
    });
    return "抱歉，我現在無法回應，請稍後再試。";
  }
}

// Send reply to LINE
async function replyToLine(replyToken, message, isConyMessage = false) {
  console.log('Sending reply to LINE:', {
    replyToken: replyToken,
    message: typeof message === 'object' ? message.text : message,
    isConyMessage: isConyMessage
  });

  try {
    // Extract userId and text from message if it's an object
    const userId = typeof message === 'object' ? message.userId : null;
    const messageText = typeof message === 'object' ? message.text : message;
    
    // Process the message to check for JSON content that should be a Flex Message
    const processedMessage = processDifyMessage(messageText);
    const messages = [];

    // Add text message if there's text content
    if (processedMessage.text && processedMessage.text.trim() !== '') {
      const textMessageObj = {
        type: 'text',
        text: processedMessage.text
      };

      // 如果是Cony訊息，添加sender信息
      if (isConyMessage) {
        textMessageObj.sender = {
          name: "Cony",
          iconUrl: "https://gcp-obs.line-scdn.net/0hERW2_cUbGn1qSwoc-HdlKlMdFgxZLw97BDMBHEYfTUxHKUEjVHhWB0pMQUpbKw58UzEFGk5OQkRFe1p4VS8"
        };
      }
      
      messages.push(textMessageObj);
      console.log('Added text message to LINE response:', JSON.stringify(textMessageObj, null, 2));
    }

    // Add Flex Messages if available
    if (processedMessage.flexMessages && processedMessage.flexMessages.length > 0) {
      processedMessage.flexMessages.forEach((flexMessage, index) => {
        // Determine the appropriate altText based on the transaction type
        let altText = "已為您記帳！";
        
        if (processedMessage.type === "income") {
          altText = "已為您記錄收入！";
        } else if (processedMessage.type === "expense") {
          altText = "已為您記錄支出！";
        }
        
        // Properly format the Flex Message with the required wrapper structure
        const flexMessageObj = {
          type: 'flex',
          altText: altText,
          contents: flexMessage,
          // 添加Quick Reply按鈕到Flex Message
          quickReply: {
            items: [
              {
                type: "action",
                imageUrl: "https://res.cloudinary.com/dt7pnivs1/image/upload/v1741838524/cost_icon_zn9vqm.png",
                action: {
                  type: "uri",
                  label: "明細",
                  uri: "https://liff.line.me/2007052419-6KyqOAoX"
                }
              },
              {
                type: "action",
                imageUrl: "https://res.cloudinary.com/dt7pnivs1/image/upload/v1742024164/anylize_yopzz1.png",
                action: {
                  type: "uri",
                  label: "分析",
                  uri: "https://liff.line.me/2007052419-Br7KNJxo"
                }
              }
            ]
          }
        };
        messages.push(flexMessageObj);
        console.log(`Added Flex Message ${index + 1} to LINE response:`, JSON.stringify(flexMessageObj, null, 2));
      });
    }

    // If no messages to send, return early
    if (messages.length === 0) {
      console.log('No messages to send');
      return;
    }

    console.log('Sending messages to LINE API:', JSON.stringify(messages, null, 2));

    // LINE API has a limit of 5 messages per reply
    // If we have more than 5 messages, we need to split them into multiple requests
    const MAX_MESSAGES_PER_REQUEST = 5;
    
    if (messages.length <= MAX_MESSAGES_PER_REQUEST) {
      // Send all messages in one request
      try {
        const response = await axios.post(
          'https://api.line.me/v2/bot/message/reply',
          {
            replyToken: replyToken,
            messages: messages
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`
            }
          }
        );
        console.log('Successfully sent reply to LINE. Response:', JSON.stringify(response.data, null, 2));
      } catch (lineError) {
        console.error('LINE API Error Details:', {
          status: lineError.response?.status,
          statusText: lineError.response?.statusText,
          data: lineError.response?.data,
          message: lineError.message,
          requestPayload: {
            replyToken: replyToken,
            messages: messages
          }
        });
        throw lineError;
      }
    } else {
      // Split messages into chunks of MAX_MESSAGES_PER_REQUEST
      console.log(`Splitting ${messages.length} messages into multiple requests`);
      
      // Send the first chunk using reply API
      const firstChunk = messages.slice(0, MAX_MESSAGES_PER_REQUEST);
      try {
        const response = await axios.post(
          'https://api.line.me/v2/bot/message/reply',
          {
            replyToken: replyToken,
            messages: firstChunk
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`
            }
          }
        );
        console.log('Successfully sent first chunk to LINE. Response:', JSON.stringify(response.data, null, 2));
      } catch (lineError) {
        console.error('LINE API Error Details for first chunk:', {
          status: lineError.response?.status,
          statusText: lineError.response?.statusText,
          data: lineError.response?.data,
          message: lineError.message
        });
        throw lineError;
      }
      
      // For remaining messages, use push API
      if (!userId) {
        console.error('Cannot send remaining messages: No user ID available');
        return;
      }
      
      // Send remaining chunks using push API
      for (let i = MAX_MESSAGES_PER_REQUEST; i < messages.length; i += MAX_MESSAGES_PER_REQUEST) {
        const chunk = messages.slice(i, i + MAX_MESSAGES_PER_REQUEST);
        try {
          const response = await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
              to: userId,
              messages: chunk
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`
              }
            }
          );
          console.log(`Successfully sent chunk ${i / MAX_MESSAGES_PER_REQUEST + 1} to LINE. Response:`, JSON.stringify(response.data, null, 2));
        } catch (lineError) {
          console.error(`LINE API Error Details for chunk ${i / MAX_MESSAGES_PER_REQUEST + 1}:`, {
            status: lineError.response?.status,
            statusText: lineError.response?.statusText,
            data: lineError.response?.data,
            message: lineError.message
          });
          // Continue with other chunks even if one fails
        }
      }
    }
  } catch (error) {
    console.error('LINE API Error:', {
      error: error.response?.data || error.message,
      status: error.response?.status,
      config: error.config
    });
  }
}

// Display loading indicator in LINE chat
async function displayLoadingIndicator(userId) {
  console.log('Displaying loading indicator for user:', userId);
  try {
    const requestBody = {
      chatId: userId,
      loadingSeconds: 30 // Display loading for 30 seconds or until a message is sent
    };
    
    console.log('Loading indicator request body:', JSON.stringify(requestBody, null, 2));
    
    const response = await axios.post(
      'https://api.line.me/v2/bot/chat/loading/start',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`
        }
      }
    );
    
    console.log('Loading indicator response:', {
      status: response.status,
      statusText: response.statusText,
      data: response.data
    });
    
    console.log('Loading indicator displayed successfully');
  } catch (error) {
    console.error('Error displaying loading indicator:', {
      error: error.response?.data || error.message,
      status: error.response?.status,
      headers: error.response?.headers,
      config: error.config
    });
  }
}

// Get content from LINE
async function getLineContent(messageId) {
  try {
    console.log(`Getting content for message ID: ${messageId}`);
    const response = await axios({
      method: 'get',
      url: `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`
      }
    });
    console.log(`Successfully retrieved content for message ID: ${messageId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting content from LINE:', error);
    throw error;
  }
}

// Upload image to Cloudinary and get URL
async function uploadImageToCloudinary(imageBuffer) {
  try {
    console.log('Uploading image to Cloudinary...');
    // Convert buffer to base64
    const base64Image = imageBuffer.toString('base64');
    
    // Upload to Cloudinary with public access settings
    const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${base64Image}`, {
      folder: 'line-bot-uploads',
      resource_type: 'auto',
      public_id: `line_image_${Date.now()}`, // 確保唯一的文件名
      access_mode: 'public', // 確保公開訪問
      overwrite: true
    });

    console.log('Image uploaded to Cloudinary:', result.secure_url);
    return result.secure_url;
  } catch (error) {
    console.error('Error uploading to Cloudinary:', error);
    throw error;
  }
}

// Function to process Dify message and prepare LINE response
function processDifyMessage(difyMessage) {
  console.log('Processing Dify message for Flex Message extraction');
  console.log('Original message:', difyMessage);
  
  // Array to store multiple flex messages
  const flexMessages = [];
  let remainingText = difyMessage;
  
  // Extract record IDs from the format [{"id":106}, {"id":107}]
  let recordIds = [];
  const idsRegex = /\[(\{"id":\d+\}(?:,\s*\{"id":\d+\})*)\]/;
  const idsMatch = difyMessage.match(idsRegex);
  
  if (idsMatch) {
    try {
      // Parse the matched IDs into an array
      const idsArray = JSON.parse(`[${idsMatch[1]}]`);
      recordIds = idsArray.map(item => item.id);
      console.log('Extracted record IDs:', recordIds);
      // Remove the IDs part from the remaining text
      remainingText = remainingText.replace(idsMatch[0], '').trim();
    } catch (error) {
      console.error('Error parsing record IDs:', error);
    }
  }
  
  // Extract transaction type from the format [{"type": "expense"}] or [{"type": "income"}]
  let transactionType = "expense"; // Default to expense if not specified
  const typeRegex = /\[\{"type":\s*"([^"]+)"\}\]/;
  const typeMatch = difyMessage.match(typeRegex);
  
  if (typeMatch) {
    transactionType = typeMatch[1];
    console.log('Extracted transaction type:', transactionType);
    // Remove the type part from the remaining text and any trailing commas
    remainingText = remainingText.replace(typeMatch[0], '').replace(/,\s*$/, '').trim();
  }

  // Try to find JSON in code blocks first (for multi-record)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let codeBlockMatch;
  let foundJsonInCodeBlock = false;
  
  while ((codeBlockMatch = codeBlockRegex.exec(remainingText)) !== null) {
    const codeContent = codeBlockMatch[1].trim();
    console.log('Found code block content:', codeContent);
    
    // Check if it's a JSON array
    if (codeContent.startsWith('[') && codeContent.endsWith(']')) {
      try {
        const jsonArray = JSON.parse(codeContent);
        console.log('Found JSON array in code block with', jsonArray.length, 'records');
        foundJsonInCodeBlock = true;
        
        // Process each record in the array
        jsonArray.forEach((record, index) => {
          // Add record ID and transaction type to each record
          const recordWithId = {
            ...record,
            record_id: recordIds[index] || '',
            type: transactionType
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
        remainingText = remainingText.replace(codeBlockMatch[0], '').trim();
      } catch (error) {
        console.error('Error parsing JSON array in code block:', error);
      }
    } 
    // Check if it's a single JSON object
    else if (codeContent.startsWith('{') && codeContent.endsWith('}')) {
      try {
        const jsonObject = JSON.parse(codeContent);
        console.log('Found single JSON object in code block:', jsonObject);
        foundJsonInCodeBlock = true;
        
        // Add record ID and transaction type to the record
        const recordWithId = {
          ...jsonObject,
          record_id: recordIds[0] || '',
          type: transactionType
        };
        
        // If is_fixed is not present, set a default value
        if (recordWithId.is_fixed === undefined) {
          recordWithId.is_fixed = false;
        }

        // Create a Flex Message for this record
        const flexMessage = createFlexMessage(recordWithId);
        flexMessages.push(flexMessage);
        
        // Remove the entire code block from the remaining text
        remainingText = remainingText.replace(codeBlockMatch[0], '').trim();
      } catch (error) {
        console.error('Error parsing JSON object in code block:', error);
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
        console.log('Found JSON array with', jsonArray.length, 'records');

        // Process each record in the array
        jsonArray.forEach((record, index) => {
          // Add record ID and transaction type to each record
          const recordWithId = {
            ...record,
            record_id: recordIds[index] || '',
            type: transactionType
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
        remainingText = remainingText.replace(jsonArrayMatch[0], '').trim();
      } catch (error) {
        console.error('Error parsing JSON array:', error);
      }
    } else {
      // Try to find a single JSON object in curly braces
      const jsonObjectRegex = /\{\s*"(?:user_id|category)"[\s\S]*?\}/;
      const jsonObjectMatch = remainingText.match(jsonObjectRegex);
      
      if (jsonObjectMatch) {
        try {
          const jsonData = JSON.parse(jsonObjectMatch[0]);
          // Add record ID and transaction type
          jsonData.record_id = recordIds[0] || '';
          jsonData.type = transactionType;
          
          // If is_fixed is not present, set a default value
          if (jsonData.is_fixed === undefined) {
            jsonData.is_fixed = false;
          }
          
          console.log('Successfully parsed JSON data:', JSON.stringify(jsonData, null, 2));
          
          // Create a Flex Message
          const flexMessage = createFlexMessage(jsonData);
          flexMessages.push(flexMessage);
          
          // Remove the matched part from the remaining text
          remainingText = remainingText.replace(jsonObjectMatch[0], '').trim();
        } catch (error) {
          console.error('Error parsing JSON object:', error);
        }
      } else {
        // Try the exact format match as a last resort
        const exactFormatRegex = /以下是您本次的紀錄：\s*\n\{\s*\n\s*"category":\s*"([^"]+)",\s*\n\s*"amount":\s*(\d+),\s*\n\s*"memo":\s*"([^"]*)",\s*\n\s*"is_fixed":\s*(true|false),\s*\n\s*"user_id":\s*"([^"]*)",\s*\n\s*"datetime":\s*"([^"]+)"\s*\n\s*\}/;
        const exactMatch = remainingText.match(exactFormatRegex);
        
        if (exactMatch) {
          // Construct a clean JSON object from the matched groups
          const jsonData = {
            category: exactMatch[1],
            amount: parseInt(exactMatch[2], 10),
            memo: exactMatch[3],
            is_fixed: exactMatch[4] === 'true',
            user_id: exactMatch[5],
            datetime: exactMatch[6],
            record_id: recordIds[0] || '', // Add the first record ID to the data
            type: transactionType // Add the transaction type to the data
          };
          
          console.log('Extracted data using exact format match:', jsonData);
          
          // Create a Flex Message from the extracted data
          const flexMessage = createFlexMessage(jsonData);
          flexMessages.push(flexMessage);
          
          // Remove the matched part from the remaining text
          remainingText = remainingText.replace(exactMatch[0], '').trim();
        }
      }
    }
  }

  // If we found any JSON objects, return them
  if (flexMessages.length > 0) {
    console.log(`Found ${flexMessages.length} JSON objects in total`);
    // Clean up remaining text by removing trailing commas, extra whitespace and any remaining ```json``` markers
    remainingText = remainingText
      .replace(/,\s*$/, '')
      .replace(/```json\s*```/g, '')
      .replace(/```\s*```/g, '')
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    return {
      text: remainingText,
      flexMessages: flexMessages,
      type: transactionType
    };
  }
  
  // If no JSON was found, return the original message
  console.log('No JSON found in the message, sending as plain text');
  return {
    text: difyMessage,
    flexMessages: [],
    type: transactionType
  };
}

// Function to create a Flex Message using the template and data
function createFlexMessage(data) {
  console.log('Creating Flex Message with data:', JSON.stringify(data, null, 2));
  
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
    } else { // expense
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
    const fs = require('fs');
    const path = require('path');
    const templatePath = path.join(__dirname, 'record.json');
    const templateString = fs.readFileSync(templatePath, 'utf8');
    
    // Replace placeholders with actual values
    let flexMessageString = templateString
      .replace('${category}', data.category || "未分類")
      .replace(/\${pillColor}/g, pillColor)
      .replace('${pillText}', pillText)
      .replace('${paddingStart}', paddingStart)
      .replace('${paddingEnd}', paddingEnd)
      .replace('"flex": "${isFixed ? 3 : 2}"', `"flex": ${data.is_fixed ? 3 : 2}`)
      .replace('${amount}', data.amount)
      .replace('${memo}', data.memo || "無備註")
      .replace('${datetime}', data.datetime || new Date().toISOString().split('T')[0])
      .replace('${liffId}', process.env.LIFF_ID)
      .replace('${recordId}', data.record_id || '')
      .replace('${type}', data.type || 'expense'); // Add type parameter for the edit button
    
    // Parse the string back to JSON
    const flexMessage = JSON.parse(flexMessageString);
    
    console.log('Created Flex Message structure:', JSON.stringify(flexMessage, null, 2));
    return flexMessage;
  } catch (error) {
    console.error('Error creating Flex Message:', error);
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
            size: "sm"
          },
          {
            type: "text",
            text: `$${data.amount}`,
            size: "xl",
            weight: "bold",
            margin: "md"
          },
          {
            type: "text",
            text: data.memo || "無備註",
            size: "sm",
            color: "#555555",
            margin: "md",
            wrap: true
          },
          {
            type: "text",
            text: data.datetime || new Date().toISOString().split('T')[0],
            size: "xs",
            color: "#aaaaaa",
            margin: "md",
            wrap: true
          }
        ]
      }
    };
    
    return fallbackMessage;
  }
}

// Webhook endpoint
app.post('/webhook', verifyLineSignature, async (req, res) => {
  try {
    console.log('Processing webhook request');
    const events = req.body.events;
    
    for (const event of events) {
      // 檢查是否已處理過此事件
      if (event.webhookEventId && processedEvents.has(event.webhookEventId)) {
        console.log('Skipping duplicate event:', event.webhookEventId);
        continue;
      }

      console.log('Processing event:', JSON.stringify(event, null, 2));
      
      if (event.type === 'message') {
        const userId = event.source.userId;
        const replyToken = event.replyToken;
        let response;
        let isConyMessage = false;

        // Display loading indicator before processing
        await displayLoadingIndicator(userId);
        
        if (event.message.type === 'text') {
          // 處理文字訊息
          const userMessage = event.message.text;
          console.log('Received text message:', userMessage);
          
          // 處理提醒相關命令
          if (userMessage === '開啟記帳提醒') {
            registerUserForReminder(userId);
            response = {
              type: 'text',
              text: '已開啟每日記帳提醒！我會在每天上午 10:30 提醒您記帳 💰'
            };
          } else if (userMessage === '關閉記帳提醒') {
            unregisterUserForReminder(userId);
            response = {
              type: 'text',
              text: '已關閉每日記帳提醒。您可以隨時輸入「開啟記帳提醒」重新開啟。'
            };
          } else if (userMessage === '提醒狀態') {
            const status = reminderUserIds.get(userId);
            response = {
              type: 'text',
              text: `您的記帳提醒目前${status ? '已開啟' : '已關閉'}。${reminderEnabled ? '系統提醒功能正常運作中。' : '注意：系統提醒功能目前已全局關閉。'}`
            };
          } else if (userMessage === '立即提醒') {
            // 立即發送提醒測試
            try {
              await sendReminderMessage(userId);
              response = {
                type: 'text',
                text: '測試提醒已發送！'
              };
            } catch (error) {
              response = {
                type: 'text',
                text: '測試提醒發送失敗，請稍後再試。'
              };
            }
          } else if (userMessage === '管理員開啟提醒系統' && userId === process.env.ADMIN_USER_ID) {
            // 只有管理員可以全局開關提醒系統
            toggleReminderFeature(true);
            response = {
              type: 'text',
              text: '已全局開啟記帳提醒系統。'
            };
          } else if (userMessage === '管理員關閉提醒系統' && userId === process.env.ADMIN_USER_ID) {
            // 只有管理員可以全局開關提醒系統
            toggleReminderFeature(false);
            response = {
              type: 'text',
              text: '已全局關閉記帳提醒系統。'
            };
          } else if (userMessage.startsWith('管理員廣播:') && userId === process.env.ADMIN_USER_ID) {
            // 管理員發送自定義消息給所有用戶
            const broadcastMessage = userMessage.substring('管理員廣播:'.length).trim();
            if (broadcastMessage) {
              try {
                await sendCustomMessageToAllUsers(broadcastMessage);
                response = {
                  type: 'text',
                  text: `已成功發送消息「${broadcastMessage}」給所有註冊用戶。`
                };
              } catch (error) {
                response = {
                  type: 'text',
                  text: '發送廣播消息失敗，請稍後再試。'
                };
              }
            } else {
              response = {
                type: 'text',
                text: '廣播消息不能為空。請使用格式：管理員廣播: 您的消息'
              };
            }
          } else {
            // 檢查訊息是否包含Cony
            isConyMessage = userMessage.includes('Cony');
            
            // 發送到Dify處理
            response = await sendToDify(userMessage, userId);
          }
        } 
        else if (event.message.type === 'image') {
          // 處理圖片訊息
          console.log('Received image message');
          
          try {
            // 1. 從LINE獲取圖片內容
            const imageContent = await getLineContent(event.message.id);
            console.log('Image content received, size:', Buffer.byteLength(imageContent), 'bytes');
            
            // 2. 上傳圖片到Cloudinary
            const imageUrl = await uploadImageToCloudinary(imageContent);
            console.log('Image uploaded, URL:', imageUrl);
            
            // 3. 發送圖片URL到Dify
            response = await sendToDify(null, userId, imageUrl);
            console.log('Dify response received:', response);
          } catch (error) {
            console.error('Error processing image:', error);
            response = '抱歉，處理圖片時發生錯誤';
          }
        }
        
        // 回覆用戶
        if (response) {
          try {
            // Add userId to the response object for use in push messages if needed
            const responseWithUserId = {
              text: response,
              userId: userId
            };
            
            // 創建訊息
            const messages = createMessagesFromResponse(responseWithUserId, isConyMessage);
            
            // 檢查訊息是否為空
            if (messages.length === 0) {
              console.log('No messages to send');
              continue;
            }
            
            // 檢查訊息結構
            console.log('Sending messages to LINE:', JSON.stringify(messages, null, 2));
            
            // Since we already used the replyToken for the loading indicator,
            // we need to send a push message instead
            const pushResponse = await axios.post(
              'https://api.line.me/v2/bot/message/push',
              {
                to: userId,
                messages: messages
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`
                }
              }
            );
            
            console.log('Successfully sent push message to LINE:', {
              status: pushResponse.status,
              statusText: pushResponse.statusText,
              data: pushResponse.data
            });
          } catch (error) {
            console.error('Error sending message to LINE:', {
              error: error.response?.data || error.message,
              status: error.response?.status,
              details: error.response?.data?.details || 'No details available'
            });
            
            // 嘗試發送簡單的文字訊息作為備用
            try {
              await axios.post(
                'https://api.line.me/v2/bot/message/push',
                {
                  to: userId,
                  messages: [{
                    type: 'text',
                    text: '抱歉，在處理您的請求時發生錯誤。我們已記錄您的記帳資訊，但無法顯示詳細資訊。'
                  }]
                },
                {
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`
                  }
                }
              );
              console.log('Successfully sent fallback message');
            } catch (fallbackError) {
              console.error('Error sending fallback message:', fallbackError.message);
            }
          }
        }

        // 標記事件為已處理
        if (event.webhookEventId) {
          processedEvents.add(event.webhookEventId);
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Helper function to create messages array from response
function createMessagesFromResponse(response, isConyMessage = false) {
  // Extract userId and text from message if it's an object
  const userId = typeof response === 'object' ? response.userId : null;
  const messageText = typeof response === 'object' ? response.text : response;
  
  // Process the message to check for JSON content that should be a Flex Message
  const processedMessage = processDifyMessage(messageText);
  const messages = [];

  // Add Flex Messages first if there are any
  if (processedMessage.flexMessages && processedMessage.flexMessages.length > 0) {
    processedMessage.flexMessages.forEach((flexMessage, index) => {
      // Determine the appropriate altText based on the transaction type
      let altText = "已為您記帳！";
      
      if (processedMessage.type === "income") {
        altText = "已為您記錄收入！";
      } else if (processedMessage.type === "expense") {
        altText = "已為您記錄支出！";
      }
      
      // Properly format the Flex Message with the required wrapper structure
      const flexMessageObj = {
        type: 'flex',
        altText: altText,
        contents: flexMessage
      };
      messages.push(flexMessageObj);
    });
  }

  // Then add text message if there's text content
  if (processedMessage.text && processedMessage.text.trim() !== '') {
    const textMessageObj = {
      type: 'text',
      text: processedMessage.text
    };

    // 如果是Cony訊息，添加sender信息
    if (isConyMessage) {
      textMessageObj.sender = {
        name: "Cony",
        iconUrl: "https://gcp-obs.line-scdn.net/0hERW2_cUbGn1qSwoc-HdlKlMdFgxZLw97BDMBHEYfTUxHKUEjVHhWB0pMQUpbKw58UzEFGk5OQkRFe1p4VS8"
      };
    }

    messages.push(textMessageObj);
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
          imageUrl: "https://res.cloudinary.com/dt7pnivs1/image/upload/v1741838524/cost_icon_zn9vqm.png",
          action: {
            type: "uri",
            label: "明細",
            uri: "https://liff.line.me/2007052419-6KyqOAoX"
          }
        },
        {
          type: "action",
          imageUrl: "https://res.cloudinary.com/dt7pnivs1/image/upload/v1742024164/anylize_yopzz1.png",
          action: {
            type: "uri",
            label: "分析",
            uri: "https://liff.line.me/2007052419-Br7KNJxo"
          }
        }
      ]
    };
  }

  // 檢查每個訊息的結構是否符合LINE的規範
  messages.forEach((msg, index) => {
    if (msg.type === 'flex' && (!msg.contents || !msg.contents.type)) {
      console.error(`第${index}個Flex訊息結構不符合規範:`, JSON.stringify(msg, null, 2));
    }
  });

  return messages;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  
  // 設置定時任務，每天台灣時間 10:30 發送提醒
  // 台灣時間 (GMT+8)，cron 表達式為：30 10 * * *
  cron.schedule('30 10 * * *', () => {
    sendReminderToAllUsers();
  }, {
    scheduled: true,
    timezone: "Asia/Taipei" // 設置為台灣時區
  });
});

/**
 * 發送記帳提醒給所有註冊的用戶
 */
async function sendReminderToAllUsers() {
  if (!reminderEnabled) {
    console.log('記帳提醒功能已關閉，跳過發送');
    return;
  }
  
  console.log('開始發送記帳提醒...');
  
  // 指定的用戶 ID
  const specificUserId = 'U82150395bb148926c8584e86daa26b0d';
  
  try {
    await sendReminderMessage(specificUserId);
    console.log(`成功發送提醒給指定用戶 ${specificUserId}`);
  } catch (error) {
    console.error(`發送提醒給指定用戶 ${specificUserId} 失敗:`, error);
  }
  
  console.log('記帳提醒發送完成');
}

/**
 * 發送記帳提醒給指定用戶
 * @param {string} userId - LINE 用戶 ID
 */
async function sendReminderMessage(userId) {
  try {
    const message = {
      type: 'text',
      text: '該記帳囉！別忘了記錄今天的收支 💰'
    };
    
    const response = await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: userId,
        messages: [message]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('發送提醒消息失敗:', error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * 註冊用戶接收記帳提醒
 * @param {string} userId - LINE 用戶 ID
 */
function registerUserForReminder(userId) {
  reminderUserIds.set(userId, true);
  console.log(`用戶 ${userId} 已註冊接收記帳提醒`);
}

/**
 * 取消用戶接收記帳提醒
 * @param {string} userId - LINE 用戶 ID
 */
function unregisterUserForReminder(userId) {
  reminderUserIds.set(userId, false);
  console.log(`用戶 ${userId} 已取消接收記帳提醒`);
}

/**
 * 切換記帳提醒功能的開關
 * @param {boolean} enabled - 是否啟用提醒功能
 */
function toggleReminderFeature(enabled) {
  reminderEnabled = enabled;
  console.log(`記帳提醒功能已${enabled ? '開啟' : '關閉'}`);
  return reminderEnabled;
}

/**
 * 發送自定義消息給所有註冊的用戶
 * @param {string} message - 要發送的消息
 */
async function sendCustomMessageToAllUsers(message) {
  if (!reminderEnabled) {
    console.log('提醒系統已關閉，跳過發送');
    return;
  }
  
  console.log(`開始發送自定義消息: "${message}"`);
  
  // 如果沒有用戶註冊提醒，則跳過
  if (reminderUserIds.size === 0) {
    console.log('沒有用戶註冊提醒，跳過發送');
    return;
  }
  
  // 遍歷所有註冊的用戶 ID 並發送消息
  for (const [userId, enabled] of reminderUserIds.entries()) {
    if (enabled) {
      try {
        await sendCustomMessage(userId, message);
        console.log(`成功發送自定義消息給用戶 ${userId}`);
      } catch (error) {
        console.error(`發送自定義消息給用戶 ${userId} 失敗:`, error);
      }
    }
  }
  
  console.log('自定義消息發送完成');
}

/**
 * 發送自定義消息給指定用戶
 * @param {string} userId - LINE 用戶 ID
 * @param {string} text - 要發送的消息文本
 */
async function sendCustomMessage(userId, text) {
  try {
    const message = {
      type: 'text',
      text: text
    };
    
    const response = await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: userId,
        messages: [message]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('發送自定義消息失敗:', error.response ? error.response.data : error.message);
    throw error;
  }
} 