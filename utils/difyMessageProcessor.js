const {
  createFlexMessage,
  createSummaryMessage,
  createBalanceSummaryMessage,
} = require("./flexMessage");
const { createTutorialMessage } = require("./tutorialMessage");
const { getTransactionData } = require("./supabaseUtils");

/**
 * Function to process Dify message and prepare LINE response
 */
async function processDifyMessage(difyMessage, lineUserId = "default_user") {
  console.log("Processing Dify message for Flex Message extraction");
  console.log("Original message length:", difyMessage ? difyMessage.length : 0);
  console.log("LINE user ID:", lineUserId);

  // 如果 difyMessage 是 null 或 undefined，設置為空字串
  difyMessage = difyMessage || "";

  // Check if message is exactly "教學文檔" (Tutorial Document)
  if (
    (difyMessage && difyMessage.trim() === "教學文檔") ||
    (difyMessage && difyMessage.trim() === "旺來怎麼用") ||
    (difyMessage && difyMessage.trim() === "說明")
  ) {
    console.log("Tutorial document request detected");
    return createTutorialMessage();
  }

  // 檢查消息是否是"餘額"，如果是則返回簡化版摘要
  if (difyMessage.trim() === "餘額") {
    console.log("餘額關鍵詞檢測到，創建簡化版月結餘摘要");
    try {
      // 獲取月摘要數據
      const summaryData = await extractSummaryData(
        "月結餘",
        "月結餘",
        lineUserId
      );

      if (summaryData) {
        // 創建簡化版摘要
        const balanceSummaryMessage = createBalanceSummaryMessage(summaryData);

        if (balanceSummaryMessage) {
          console.log("成功創建餘額摘要 Flex 訊息");
          return {
            text: "", // 不顯示文本介紹
            flexMessages: [balanceSummaryMessage],
            type: "balance_summary",
          };
        } else {
          console.error("無法創建餘額摘要 Flex 訊息");
        }
      }
    } catch (error) {
      console.error("創建餘額摘要時出錯:", error);
    }
  }

  // 如果 difyMessage 只是空白或空字串，返回一個空的結果結構，但確保它有 flexMessages 陣列
  if (!difyMessage || difyMessage.trim() === "") {
    console.log("Empty message received, returning empty result structure");
    return {
      text: "",
      flexMessages: [],
      type: "text",
    };
  }

  // 檢查訊息中是否包含"餘額"關鍵詞（不是完全匹配，而是包含）
  if (difyMessage.includes("餘額") && !difyMessage.includes("總結")) {
    console.log("檢測到訊息中包含「餘額」關鍵詞，創建簡化版月結餘摘要");
    try {
      // 獲取月摘要數據
      const summaryData = await extractSummaryData(
        "月結餘",
        "月結餘",
        lineUserId
      );

      if (summaryData) {
        // 創建簡化版摘要
        const balanceSummaryMessage = createBalanceSummaryMessage(summaryData);

        if (balanceSummaryMessage) {
          console.log("成功創建餘額摘要 Flex 訊息");
          return {
            text: cleanMessageText(difyMessage), // 保留原始訊息的文本部分
            flexMessages: [balanceSummaryMessage],
            type: "balance_summary",
          };
        }
      }
    } catch (error) {
      console.error("創建餘額摘要時出錯:", error);
    }
  }

  // Check for summary-related keywords (日、週、月支出/收入總結)
  const summaryKeywords = [
    "日支出總結",
    "日收入總結",
    "週支出總結",
    "週收入總結",
    "月支出總結",
    "月收入總結",
  ];

  // Try to extract summary data if keywords are detected
  for (const keyword of summaryKeywords) {
    // Check if the message contains EXACTLY the keyword (not as part of a larger text)
    if (difyMessage.trim() === keyword) {
      console.log(`Summary keyword detected: ${keyword}`);

      try {
        // Try to extract summary data using regex patterns and Supabase
        // This now uses await since the function is async and passes the LINE user ID
        const summaryData = await extractSummaryData(
          difyMessage,
          keyword,
          lineUserId
        );

        if (summaryData) {
          console.log("Created summary flex message with data:", summaryData);

          // Get period type from keyword
          const periodRegex = /(日|週|周|月)/;
          const periodMatch = keyword.match(periodRegex);
          let periodType = "";
          if (periodMatch) {
            periodType = periodMatch[1] === "周" ? "週" : periodMatch[1]; // Normalize "周" to "週"
          }

          // Get the current date in Taiwan timezone
          const options = {
            timeZone: "Asia/Taipei",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          };
          const taiwanDateStr = new Date().toLocaleString("zh-TW", options);

          // Parse the date parts
          const dateParts = taiwanDateStr.split("/");
          let year, month, day;

          // Check the date format and parse accordingly
          if (dateParts.length === 3) {
            if (dateParts[0].length === 4) {
              // If the first part is a year (YYYY/MM/DD)
              year = dateParts[0];
              month = dateParts[1];
              day = dateParts[2];
            } else {
              // If it's MM/DD/YYYY format
              year = dateParts[2];
              month = dateParts[0];
              day = dateParts[1];
            }
          } else {
            // If parsing fails, use hardcoded approach
            const taiwanNow = new Date(
              new Date().getTime() + 8 * 60 * 60 * 1000
            );
            year = taiwanNow.getUTCFullYear();
            month = String(taiwanNow.getUTCMonth() + 1).padStart(2, "0");
            day = String(taiwanNow.getUTCDate()).padStart(2, "0");
          }

          // Create the formatted date
          const formattedDate = `${year}/${month}/${day}`;

          // Create appropriate date range description based on period type
          let dateRangeText = formattedDate; // Default for "日"

          if (periodType === "週") {
            // Calculate start of week (Monday)
            const today = new Date(`${year}-${month}-${day}T00:00:00Z`);
            const weekStart = new Date(today);
            const dayOfWeek = weekStart.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
            // If today is Sunday (0), go back 6 days, otherwise go back (current day - 1) days
            weekStart.setDate(
              weekStart.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1)
            );

            const weekStartYear = weekStart.getFullYear();
            const weekStartMonth = String(weekStart.getMonth() + 1).padStart(
              2,
              "0"
            );
            const weekStartDay = String(weekStart.getDate()).padStart(2, "0");

            dateRangeText = `${weekStartYear}/${weekStartMonth}/${weekStartDay} - ${formattedDate}`;
          } else if (periodType === "月") {
            // Use the first day of the month to the current day
            dateRangeText = `${year}/${month}/01 - ${formattedDate}`;
          }

          // Format the message using the specified format: "以下是{指定的週期 實際日期區間}的分析"
          // Add "本" before the period type
          const customMessage = `以下是本${periodType} ${dateRangeText}的分析`;

          // 創建摘要訊息
          const summaryFlexMessage = createSummaryMessage(summaryData);

          // 確保 summaryFlexMessage 是有效的對象
          if (summaryFlexMessage) {
            console.log("成功創建摘要 Flex 訊息");
          } else {
            console.error("無法創建摘要 Flex 訊息");
            return {
              text: "抱歉，無法生成摘要報告。",
              flexMessages: [],
              type: "text",
            };
          }

          // Return the formatted summary response with the custom message
          return {
            text: "", // 設置為空文本，不發送文本介紹
            flexMessages: [summaryFlexMessage],
            type: "summary",
          };
        }
      } catch (error) {
        console.error("Error creating summary flex message:", error);
      }

      break;
    }
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

  // Check for type in the JSON data itself (in case it's not specified separately)
  // This will look for type directly in the JSON objects
  const jsonTypeRegex = /"type":\s*"(income|expense)"/;
  const jsonTypeMatch = difyMessage.match(jsonTypeRegex);

  if (jsonTypeMatch && !typeMatch) {
    transactionType = jsonTypeMatch[1];
    console.log("Extracted transaction type from JSON data:", transactionType);
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

          // Add record ID and use record's own type if present, otherwise use the extracted transactionType
          const recordWithId = {
            ...record,
            record_id: record_id,
            type: record.type || transactionType, // Prefer record's own type if available
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

        // Add record ID and use record's own type if present, otherwise use the extracted transactionType
        const recordWithId = {
          ...jsonObject,
          record_id: record_id,
          type: jsonObject.type || transactionType, // Prefer record's own type if available
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

          // Add record ID and use record's own type if present, otherwise use the extracted transactionType
          const recordWithId = {
            ...record,
            record_id: record_id,
            type: record.type || transactionType, // Prefer record's own type if available
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

          // Add record ID and use record's own type if present, otherwise use the extracted transactionType
          jsonData.record_id = record_id;
          jsonData.type = jsonData.type || transactionType; // Prefer record's own type if available

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
            type: transactionType, // Use the extracted transaction type
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

/**
 * Function to clean message text by removing JSON objects, IDs, and type information
 */
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

  // We no longer remove type information - keep it in the message
  // cleanedText = cleanedText.replace(
  //   /\[\s*\{\s*"type"\s*:\s*"[^"]+"\s*\}\s*\](?:\s*,\s*)?/g,
  //   ""
  // );

  // Remove only ID part from ID-type combined pattern - e.g., [{"id":803}],[{"type": "expense"}]
  cleanedText = cleanedText.replace(
    /\[\s*\{\s*"id"\s*:\s*\d+\s*\}\s*\]\s*,/g,
    ""
  );

  // Remove any remaining empty brackets and comma combinations
  cleanedText = cleanedText.replace(/\[\s*\]\s*(?:,\s*\[\s*\])?/g, "");

  // Remove any bracket patterns with commas inside - e.g., [, ] or [, , ]
  cleanedText = cleanedText.replace(/\[\s*(?:,\s*)*\]/g, "");

  // Clean up multiple spaces, newlines and trim
  cleanedText = cleanedText.replace(/\s+/g, " ").trim();

  // If we have text like "以下是您本次的紀錄：" followed by nothing, remove it
  cleanedText = cleanedText.replace(/以下是您本次的紀錄：\s*$/, "");

  return cleanedText;
}

/**
 * Extract summary data from message or keywords
 */
async function extractSummaryData(text, keyword, lineUserId = "default_user") {
  const cleanText = text.trim();

  // Use regex to look for "日/週/月" at the beginning of the keyword
  const periodRegex = /(日|週|周|月)/;
  const periodMatch = keyword.match(periodRegex);
  let periodType = "";
  if (periodMatch) {
    periodType = periodMatch[1] === "周" ? "週" : periodMatch[1]; // Normalize "周" to "週"
  }

  console.log(`Period type detected: ${periodType}`);
  console.log(`Using LINE user ID: ${lineUserId}`);

  // 檢查是否是「結餘」關鍵詞
  const isBalanceKeyword = keyword.includes("結餘");

  // Determine transaction type from keyword, 除非是「結餘」關鍵詞
  let transactionType = "支出"; // 默認為支出
  if (!isBalanceKeyword) {
    const transactionTypeMatch = /支出|收入/.exec(keyword);
    if (transactionTypeMatch) {
      transactionType = transactionTypeMatch[0] === "支出" ? "支出" : "收入";
    }
  }

  console.log(`Transaction type detected: ${transactionType}`);

  // Set title based on keyword type
  let title;
  if (isBalanceKeyword || keyword === "月結餘") {
    // 如果是「結餘」關鍵詞或直接是「月結餘」，設置為「X結餘」
    title = `${periodType}結餘`;
    console.log(`Using balance title: ${title}`);
  } else {
    // 否則使用傳統的「X支出/收入總結」格式
    title = `${periodType}${transactionType}總結`;
    console.log(`Using transaction title: ${title}`);
  }

  // 初始化變數為 null，而不是使用默認值
  let incomeValue = null;
  let expenseValue = null;
  let balanceValue = null;

  // Try to extract income and expense from the text
  const incomeRegex = /收入[：:]\s*([$¥￥]?\s*[0-9,]+(?:\.[0-9]{1,2})?)/;
  const expenseRegex = /支出[：:]\s*([$¥￥]?\s*[0-9,]+(?:\.[0-9]{1,2})?)/;
  const balanceRegex =
    /(?:結餘|餘額)[：:]\s*([$¥￥]?\s*[0-9,]+(?:\.[0-9]{1,2})?)/;

  const incomeMatch = cleanText.match(incomeRegex);
  const expenseMatch = cleanText.match(expenseRegex);
  const balanceMatch = cleanText.match(balanceRegex);

  // Flag to determine if we need fallback data
  let hasData = false;

  if (incomeMatch) {
    incomeValue = incomeMatch[1].trim();
    // If the income doesn't have a currency symbol, add a default dollar sign
    if (!/^[$¥￥]/.test(incomeValue)) {
      incomeValue = `$ ${incomeValue}`;
    }
    hasData = true;
  }

  if (expenseMatch) {
    expenseValue = expenseMatch[1].trim();
    // If the expense doesn't have a currency symbol, add a default dollar sign
    if (!/^[$¥￥]/.test(expenseValue)) {
      expenseValue = `$ ${expenseValue}`;
    }
    hasData = true;
  }

  if (balanceMatch) {
    balanceValue = balanceMatch[1].trim();
    // If the balance doesn't have a currency symbol, add a default dollar sign
    if (!/^[$¥￥]/.test(balanceValue)) {
      balanceValue = `$ ${balanceValue}`;
    }
    hasData = true;
  }

  // If we have both income and expense but no balance, calculate it
  if (incomeValue && expenseValue && !balanceValue) {
    try {
      const incomeNumeric = incomeValue.replace(/[$¥￥,\s]/g, "");
      const expenseNumeric = expenseValue.replace(/[$¥￥,\s]/g, "");

      const income = parseFloat(incomeNumeric);
      const expense = parseFloat(expenseNumeric);
      const balance = income - expense;

      balanceValue = `$ ${balance.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
      hasData = true;
    } catch (error) {
      console.error("Error calculating balance:", error);
    }
  }

  // Extract top expense categories if available
  let analysisItems = extractCategories(cleanText);

  // 嘗試從 Supabase 獲取數據 (如果沒有從文本中提取到足夠的數據)
  if (!hasData || (!incomeValue && !expenseValue)) {
    try {
      console.log(`===== 嘗試從 Supabase 獲取數據 =====`);
      console.log(`尚未從文本中提取到足夠的數據，將嘗試從 Supabase 獲取`);
      console.log(`使用 LINE 用戶 ID: ${lineUserId}, 期間類型: ${periodType}`);

      const supabaseData = await getTransactionData(lineUserId, periodType);

      if (supabaseData) {
        console.log(
          `成功從 Supabase 獲取數據 (收入: ${supabaseData.income}, 支出: ${supabaseData.expense}, 結餘: ${supabaseData.balance})`
        );

        // 使用 Supabase 獲取的數據覆蓋之前的值
        incomeValue = supabaseData.income;
        expenseValue = supabaseData.expense;
        balanceValue = supabaseData.balance;

        // 根據交易類型選擇對應的分析項目
        if (
          transactionType === "收入" &&
          supabaseData.incomeAnalysisItems &&
          supabaseData.incomeAnalysisItems.length > 0
        ) {
          analysisItems = supabaseData.incomeAnalysisItems;
          console.log(
            `使用 Supabase 提供的 ${analysisItems.length} 個收入分析項目`
          );
        } else if (
          transactionType === "支出" &&
          supabaseData.expenseAnalysisItems &&
          supabaseData.expenseAnalysisItems.length > 0
        ) {
          analysisItems = supabaseData.expenseAnalysisItems;
          console.log(
            `使用 Supabase 提供的 ${analysisItems.length} 個支出分析項目`
          );
        } else {
          // 如果沒有找到對應類型的分析項目，記錄但不使用預設
          console.log(`Supabase 數據中沒有${transactionType}分析項目`);
        }

        hasData = true;
        console.log(`已成功使用 Supabase 數據`);
      } else {
        console.log(`從 Supabase 獲取數據失敗`);
      }
    } catch (error) {
      console.error(`從 Supabase 獲取數據時發生錯誤:`, error);
    } finally {
      console.log(`===== 完成從 Supabase 獲取數據 =====`);
    }
  }

  // 移除使用假數據的部分
  // 直接返回從文本或數據庫中獲取的真實數據
  // 如果沒有數據，flexMessage.js 會顯示「無資料」

  // Make sure balanceValue is consistent with income and expense
  // If we've got both income and expense but no explicit balance, calculate it
  if (incomeValue && expenseValue && !balanceValue) {
    try {
      const incomeNumeric = incomeValue.replace(/[$¥￥,\s]/g, "");
      const expenseNumeric = expenseValue.replace(/[$¥￥,\s]/g, "");

      const income = parseFloat(incomeNumeric);
      const expense = parseFloat(expenseNumeric);
      const balance = income - expense;

      balanceValue = `$ ${balance.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })}`;
    } catch (error) {
      console.error("Error calculating balance from income/expense:", error);
    }
  }

  return {
    title,
    income: incomeValue,
    expense: expenseValue,
    balance: balanceValue,
    analysisTitle: `${periodType}${transactionType}分析`,
    analysisItems,
  };
}

/**
 * Extract category data for analysis
 */
function extractCategories(text) {
  // Looking for patterns like "食物：$1,200 (37.5%)" or similar
  const categoryRegex =
    /([\u4e00-\u9fa5a-zA-Z]+)[：:]\s*([$¥￥]?\s*[0-9,]+(?:\.[0-9]{1,2})?)\s*(?:\(([0-9.]+%)\))?/g;

  const categoryMatches = [...text.matchAll(categoryRegex)];
  const analysisItems = [];

  // Skip common terms that we don't want in our category list
  const skipCategories = [
    "收入",
    "支出",
    "結餘",
    "餘額",
    "凈收入",
    "主要支出類別",
    "主要",
    "支出類別",
  ];

  categoryMatches.forEach((match) => {
    if (match.length >= 3 && !skipCategories.includes(match[1].trim())) {
      // For the amount, check if it already has a currency symbol
      const amountValue = match[2].trim();
      const hasCurrencySymbol = /^[$¥￥]/.test(amountValue);
      const formattedAmount = hasCurrencySymbol
        ? amountValue
        : `$ ${amountValue}`;

      analysisItems.push({
        category: match[1].trim(),
        amount: formattedAmount,
        percentage: match[3] ? match[3].trim() : "0%",
      });
    }
  });

  return analysisItems;
}

module.exports = {
  processDifyMessage,
  cleanMessageText,
  extractSummaryData,
};
