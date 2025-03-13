require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// 存儲用戶對話 ID 的映射
const userConversations = new Map();
// 存儲已處理的 webhook event IDs
const processedEvents = new Set();
// 設置過期時間（毫秒）
const EVENT_EXPIRY = 1000 * 60 * 5; // 5 minutes

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
        const flexMessageObj = {
          type: 'flex',
          altText: `已為您記帳！`,
          contents: flexMessage
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
  
  // Extract multiple JSON entries
  // First, try to find all instances of the exact format
  const exactFormatRegex = /以下是您本次的紀錄：\s*\n\{\s*\n\s*"category":\s*"([^"]+)",\s*\n\s*"amount":\s*(\d+),\s*\n\s*"item":\s*"([^"]+)",\s*\n\s*"memo":\s*"([^"]*)",\s*\n\s*"user_id":\s*"([^"]+)",\s*\n\s*"datetime":\s*"([^"]+)"\s*\n\s*\}/g;
  
  let exactMatch;
  while ((exactMatch = exactFormatRegex.exec(difyMessage)) !== null) {
    // Construct a clean JSON object from the matched groups
    const jsonData = {
      category: exactMatch[1],
      amount: parseInt(exactMatch[2], 10),
      item: exactMatch[3],
      memo: exactMatch[4],
      user_id: exactMatch[5],
      datetime: exactMatch[6]
    };
    
    console.log('Extracted data using exact format match:', jsonData);
    
    // Create a Flex Message from the extracted data
    const flexMessage = createFlexMessage(jsonData);
    flexMessages.push(flexMessage);
    
    // Remove the matched part from the remaining text
    remainingText = remainingText.replace(exactMatch[0], '').trim();
  }
  
  // If we found exact matches, return them
  if (flexMessages.length > 0) {
    console.log(`Found ${flexMessages.length} exact format matches`);
    return {
      text: remainingText,
      flexMessages: flexMessages
    };
  }
  
  // If no exact matches were found, try other methods to find JSON
  // Look for multiple JSON objects in code blocks
  const codeBlockRegex = /```(?:json)?\n([\s\S]*?)\n```/g;
  let codeBlockMatch;
  
  while ((codeBlockMatch = codeBlockRegex.exec(difyMessage)) !== null) {
    try {
      const jsonString = codeBlockMatch[1];
      console.log('Extracted JSON from code block:', jsonString);
      
      // Clean and parse the JSON
      let normalizedJsonString = jsonString
        .replace(/'/g, '"')
        .replace(/\n\s*"/g, '"')
        .replace(/"\n\s*/g, '"')
        .replace(/,\s*}/g, '}');
      
      const jsonData = JSON.parse(normalizedJsonString);
      console.log('Successfully parsed JSON data from code block:', JSON.stringify(jsonData, null, 2));
      
      // Create a Flex Message
      const flexMessage = createFlexMessage(jsonData);
      flexMessages.push(flexMessage);
      
      // Remove the matched part from the remaining text
      remainingText = remainingText.replace(codeBlockMatch[0], '').trim();
    } catch (error) {
      console.error('Error parsing JSON from code block:', error);
    }
  }
  
  // Look for multiple JSON objects in multiline format
  if (remainingText.includes('{\n') && remainingText.includes('\n}')) {
    // Try to find all instances of multiline JSON
    const multilineRegex = /(\{\n[\s\S]*?\n\})/g;
    let multilineMatch;
    
    while ((multilineMatch = multilineRegex.exec(remainingText)) !== null) {
      try {
        const jsonString = multilineMatch[1];
        console.log('Extracted JSON from multiline format:', jsonString);
        
        // Clean and parse the JSON
        let normalizedJsonString = jsonString
          .replace(/'/g, '"')
          .replace(/\n\s*"/g, '"')
          .replace(/"\n\s*/g, '"')
          .replace(/,\s*}/g, '}');
        
        const jsonData = JSON.parse(normalizedJsonString);
        console.log('Successfully parsed JSON data from multiline format:', JSON.stringify(jsonData, null, 2));
        
        // Create a Flex Message
        const flexMessage = createFlexMessage(jsonData);
        flexMessages.push(flexMessage);
        
        // Remove the matched part from the remaining text
        remainingText = remainingText.replace(multilineMatch[0], '').trim();
      } catch (error) {
        console.error('Error parsing JSON from multiline format:', error);
      }
    }
  }
  
  // Look for multiple JSON objects in curly braces
  const curlyBracesRegex = /(\{[^{}]*\})/g;
  let curlyBracesMatch;
  
  while ((curlyBracesMatch = curlyBracesRegex.exec(remainingText)) !== null) {
    const potentialJson = curlyBracesMatch[1];
    
    // Check if this looks like a valid JSON object for our use case
    if (potentialJson.includes('"category"') || potentialJson.includes('"amount"') || potentialJson.includes('"item"') ||
        potentialJson.includes("'category'") || potentialJson.includes("'amount'") || potentialJson.includes("'item'")) {
      try {
        console.log('Extracted JSON from curly braces:', potentialJson);
        
        // Clean and parse the JSON
        let normalizedJsonString = potentialJson
          .replace(/'/g, '"')
          .replace(/\n\s*"/g, '"')
          .replace(/"\n\s*/g, '"')
          .replace(/,\s*}/g, '}');
        
        const jsonData = JSON.parse(normalizedJsonString);
        console.log('Successfully parsed JSON data from curly braces:', JSON.stringify(jsonData, null, 2));
        
        // Create a Flex Message
        const flexMessage = createFlexMessage(jsonData);
        flexMessages.push(flexMessage);
        
        // Remove the matched part from the remaining text
        remainingText = remainingText.replace(potentialJson, '').trim();
      } catch (error) {
        console.error('Error parsing JSON from curly braces:', error);
      }
    }
  }
  
  // If we found any JSON objects, return them
  if (flexMessages.length > 0) {
    console.log(`Found ${flexMessages.length} JSON objects in total`);
    return {
      text: remainingText,
      flexMessages: flexMessages
    };
  }
  
  // If no JSON was found, return the original message
  console.log('No JSON found in the message, sending as plain text');
  return {
    text: difyMessage,
    flexMessages: []
  };
}

// Function to create a Flex Message using the template and data
function createFlexMessage(data) {
  console.log('Creating Flex Message with data:', JSON.stringify(data, null, 2));
  
  try {
    // Load the flex.json template
    const flexTemplate = require('./flex.json');
    
    // Create a deep copy to avoid modifying the original template
    const flexMessage = JSON.parse(JSON.stringify(flexTemplate));
    
    // Update the Flex Message with the data from JSON
    if (flexMessage && flexMessage.body && flexMessage.body.contents) {
      // Update category
      if (flexMessage.body.contents[0]) {
        flexMessage.body.contents[0].text = data.category || "未分類";
      }
      
      // Update item name
      if (flexMessage.body.contents[1]) {
        flexMessage.body.contents[1].text = data.item || "未命名項目";
      }
      
      // Update amount, memo, and date if the structure exists
      if (flexMessage.body.contents[3] && flexMessage.body.contents[3].contents) {
        // Update amount
        const amountBox = flexMessage.body.contents[3].contents[0];
        if (amountBox && amountBox.contents && amountBox.contents[1]) {
          amountBox.contents[1].text = `$${data.amount}`;
        }
        
        // Update memo (if exists)
        const memoBox = flexMessage.body.contents[3].contents[1];
        if (memoBox && memoBox.contents && memoBox.contents[1]) {
          memoBox.contents[1].text = data.memo || "無備註";
        }
        
        // Update date
        const dateBox = flexMessage.body.contents[3].contents[2];
        if (dateBox && dateBox.contents && dateBox.contents[1]) {
          dateBox.contents[1].text = data.datetime || new Date().toISOString().split('T')[0];
        }
      }
    }
    
    console.log('Created Flex Message structure:', JSON.stringify(flexMessage, null, 2));
    return flexMessage;
  } catch (error) {
    console.error('Error creating Flex Message:', error);
    // Return a simple fallback Flex Message
    return {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: data.category || "未分類",
            weight: "bold",
            color: "#1DB446",
            size: "sm"
          },
          {
            type: "text",
            text: data.item || "未命名項目",
            weight: "bold",
            size: "xxl",
            margin: "md",
            wrap: true
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
            text: data.datetime || new Date().toISOString().split('T')[0],
            size: "xs",
            color: "#aaaaaa",
            margin: "md",
            wrap: true
          }
        ]
      }
    };
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
          
          // 檢查訊息是否包含Cony
          isConyMessage = userMessage.includes('Cony');
          
          // 發送到Dify處理
          response = await sendToDify(userMessage, userId);
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
          // Add userId to the response object for use in push messages if needed
          const responseWithUserId = {
            text: response,
            userId: userId
          };
          
          // Since we already used the replyToken for the loading indicator,
          // we need to send a push message instead
          await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
              to: userId,
              messages: createMessagesFromResponse(responseWithUserId, isConyMessage)
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`
              }
            }
          );
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
  }

  // Add Flex Messages if there are any
  if (processedMessage.flexMessages && processedMessage.flexMessages.length > 0) {
    processedMessage.flexMessages.forEach((flexMessage, index) => {
      // Properly format the Flex Message with the required wrapper structure
      const flexMessageObj = {
        type: 'flex',
        altText: `已為您記帳！`,
        contents: flexMessage
      };
      messages.push(flexMessageObj);
    });
  }

  return messages;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 