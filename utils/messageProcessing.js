const { QUICK_REPLY_ITEMS } = require("../config");
const {
  processDifyMessage,
  cleanMessageText,
} = require("./difyMessageProcessor");
const { createTutorialMessage } = require("./tutorialMessage");

/**
 * Helper function to create messages array from response
 */
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
      items: QUICK_REPLY_ITEMS,
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

module.exports = {
  createMessagesFromResponse,
  cleanMessageText,
  createTutorialMessage,
};
