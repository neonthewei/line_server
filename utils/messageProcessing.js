const { QUICK_REPLY_ITEMS } = require("../config");
const {
  processDifyMessage,
  cleanMessageText,
} = require("./difyMessageProcessor");
const { createTutorialMessage } = require("./tutorialMessage");

/**
 * Helper function to create messages array from response
 */
async function createMessagesFromResponse(response, isConyMessage = false) {
  // Extract userId and text from message if it's an object
  const userId = typeof response === "object" ? response.userId : null;
  const messageText = typeof response === "object" ? response.text : response;
  const transcribedText =
    typeof response === "object" ? response.transcribedText : null;
  const responseType = typeof response === "object" ? response.type : null;

  // 直接檢查是否有 flexMessages 數組，如果有，則使用它們而不是處理文本
  if (
    typeof response === "object" &&
    response.flexMessages &&
    response.flexMessages.length > 0
  ) {
    console.log(
      `檢測到 ${response.flexMessages.length} 個 Flex 消息，將直接使用它們`
    );
    const messages = [];

    // 1. 如果有轉錄文字，先添加
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

    // 2. 添加所有的 Flex 消息
    response.flexMessages.forEach((flexMessage, index) => {
      // 根據響應類型確定適當的 altText
      let altText = "已為您記帳！";

      if (responseType === "tutorial") {
        altText = index === 0 ? "🍍旺來新手教學 (上)" : "🍍旺來新手教學 (下)";
      } else if (responseType === "summary") {
        altText = "📊 收支總結";
      } else if (responseType === "balance_summary") {
        altText = "💰 餘額";
      } else {
        // 嘗試從 flexMessage 結構中提取類型
        try {
          const pillText =
            flexMessage.body.contents[0].contents[1].contents[0].text;
          if (pillText.includes("收入")) {
            altText = "已為您記錄收入！";
          } else if (pillText.includes("支出")) {
            altText = "已為您記錄支出！";
          }
        } catch (error) {
          // 使用全局類型作為後備
          if (responseType === "income") {
            altText = "已為您記錄收入！";
          } else if (responseType === "expense") {
            altText = "已為您記錄支出！";
          }
        }
      }

      // 正確格式化 Flex 消息
      const flexMessageObj = {
        type: "flex",
        altText: altText,
        contents: flexMessage,
      };

      messages.push(flexMessageObj);
    });

    // 3. 如果有非空的文本，添加文本消息
    if (messageText && messageText.trim() !== "") {
      const textMessageObj = {
        type: "text",
        text: messageText,
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
    } else {
      console.log("文本為空或僅包含空白字符，不發送文本消息");
    }

    // 確保訊息數量不超過 LINE 的限制
    if (messages.length > 5) {
      console.log(`訊息數量超過 LINE 限制，截斷至 5 個訊息`);
      messages.splice(5);
    }

    // 添加快速回覆到最後一條消息
    if (messages.length > 0) {
      messages[messages.length - 1].quickReply = {
        items: QUICK_REPLY_ITEMS,
      };
    }

    // 檢查消息結構
    messages.forEach((msg, index) => {
      if (msg.type === "flex" && (!msg.contents || !msg.contents.type)) {
        console.error(`第 ${index + 1} 個 Flex 訊息結構不符合規範`);
      }
    });

    return messages;
  }

  // 如果沒有直接的 flexMessages，使用原來的處理方式
  const processedMessage =
    responseType === "tutorial"
      ? response
      : await processDifyMessage(messageText, userId);
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
      } else if (processedMessage.type === "summary") {
        // For summary messages, use a different alt text
        altText = "📊 收支總結";
      } else if (processedMessage.type === "balance_summary") {
        // For balance summary messages
        altText = "💰 餘額";
      } else {
        // For transaction records, check the pill text to determine if it's income or expense
        // The pill text is in the first box's second item's contents first item
        try {
          const pillText =
            flexMessage.body.contents[0].contents[1].contents[0].text;
          if (pillText.includes("收入")) {
            altText = "已為您記錄收入！";
          } else if (pillText.includes("支出")) {
            altText = "已為您記錄支出！";
          }
        } catch (error) {
          // Fallback to the global type if we can't extract from flexMessage structure
          if (processedMessage.type === "income") {
            altText = "已為您記錄收入！";
          } else if (processedMessage.type === "expense") {
            altText = "已為您記錄支出！";
          }
        }
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

  // 3. 添加文字訊息（如果有，且不為空），確保文字訊息在 Flex 消息之後
  if (processedMessage.text && processedMessage.text.trim() !== "") {
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

  // 確保我們至少有一條消息可以發送
  // 如果沒有文本也沒有 Flex 消息，添加一個默認文本消息
  if (messages.length === 0) {
    console.log("沒有找到有效的消息內容，將創建一個默認消息");
    messages.push({
      type: "text",
      text: "處理完成",
    });
  }

  // 確保訊息數量不超過LINE的限制（5個）
  if (messages.length > 5) {
    console.log(`訊息數量超過LINE限制，截斷至5個訊息`);
    messages.splice(5);
  }

  // Add Quick Reply to the last message
  if (messages.length > 0) {
    messages[messages.length - 1].quickReply = {
      items: QUICK_REPLY_ITEMS,
    };
  }

  // 檢查訊息結構合法性
  messages.forEach((msg, index) => {
    if (msg.type === "flex" && (!msg.contents || !msg.contents.type)) {
      console.error(`第${index + 1}個Flex訊息結構不符合規範`);
    }
  });

  return messages;
}

module.exports = {
  createMessagesFromResponse,
  cleanMessageText,
  createTutorialMessage,
};
