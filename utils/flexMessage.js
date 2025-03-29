const fs = require("fs");
const path = require("path");

/**
 * Function to create a Flex Message using the template and data
 */
function createFlexMessage(data) {
  console.log(
    "Creating Flex Message with data:",
    JSON.stringify({
      category: data.category,
      amount: data.amount,
      type: data.type,
      is_fixed: data.is_fixed,
    })
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

    // Load the template from templates/transaction_record.json
    const templatePath = path.join(
      __dirname,
      "..",
      "templates",
      "transaction_record.json"
    );
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
      .replace("${recordId}", recordIdParam);

    // Parse the string back to JSON
    const flexMessage = JSON.parse(flexMessageString);

    console.log("Flex Message created successfully");
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

/**
 * Function to create a Summary Flex Message using the template and data
 */
function createSummaryMessage(data) {
  console.log(
    "Creating Summary Flex Message with data:",
    JSON.stringify({
      title: data.title,
      income: data.income,
      expense: data.expense,
      balance: data.balance,
      analysisTitle: data.analysisTitle,
      analysisItemsCount: data.analysisItems ? data.analysisItems.length : 0,
    })
  );

  try {
    // Load the template from templates/summary.json
    const templatePath = path.join(
      __dirname,
      "..",
      "templates",
      "summary.json"
    );
    const templateString = fs.readFileSync(templatePath, "utf8");

    // Determine the correct title format based on data
    let title = data.title || "無資料";
    let periodPrefix = ""; // 用於存儲期間前綴（日、週、月）

    // Check if it's a specific period summary (日/週/月)
    const periodMatch = title.match(/(日|週|周|月)([收支入出]+)/);
    if (periodMatch) {
      // Get the period prefix
      periodPrefix = periodMatch[1]; // 保存期間前綴（日、週、月）
      // Reformat to "X結餘" format instead of "X支出總結"
      title = `${periodPrefix}結餘`;
    }

    // Create period-prefixed income and expense labels - 使用更簡短的標籤「收」和「支」
    const incomeLabel = periodPrefix ? `${periodPrefix}收` : "收";
    const expenseLabel = periodPrefix ? `${periodPrefix}支` : "支";

    // 處理金額數字，無數據時顯示為 $ 0 而非無資料
    let incomeValue = data.income || "$ 0";
    let expenseValue = data.expense || "$ 0";
    let balanceValue = data.balance || "$ 0";

    // Replace placeholders with actual values, including the modified labels
    let flexMessageString = templateString
      .replace("${TITLE}", title)
      .replace("${BALANCE_VALUE}", balanceValue)
      .replace("${INCOME_VALUE}", incomeValue)
      .replace("${EXPENSE_VALUE}", expenseValue)
      .replace("${ANALYSIS_TITLE}", data.analysisTitle || "支出分析")
      .replace(/"text": "收"/, `"text": "${incomeLabel}"`)
      .replace(/"text": "支"/, `"text": "${expenseLabel}"`);

    // Parse the string back to JSON
    const flexMessage = JSON.parse(flexMessageString);

    // 確保數字容器有足夠的空間並調整顯示模式
    if (flexMessage.body.contents && flexMessage.body.contents.length > 0) {
      const topSection = flexMessage.body.contents[0];

      // 調整左側結餘數字 (balance) 的顯示方式
      if (
        topSection.contents[0].contents &&
        topSection.contents[0].contents.length > 1
      ) {
        // 結餘標題容器 (第一個子容器)
        const titleContainer = topSection.contents[0].contents[0];
        if (titleContainer.contents && titleContainer.contents.length > 0) {
          const titleElement = titleContainer.contents[0];
          titleElement.align = "start";
          titleElement.margin = "none"; // 移除標題邊距
          // 確保標題垂直對齊在底部
          titleContainer.justifyContent = "flex-end";
          titleContainer.alignItems = "center";
          titleContainer.height = "18px"; // 設置更小的高度
          titleContainer.paddingBottom = "0px"; // 移除底部間距
        }

        // 結餘數字容器 (第二個子容器)
        const balanceContainer = topSection.contents[0].contents[1];
        if (balanceContainer.contents && balanceContainer.contents.length > 0) {
          const balanceElement = balanceContainer.contents[0];
          balanceElement.adjustMode = "shrink-to-fit";
          balanceElement.maxLines = 1; // 限制為單行
          balanceElement.size = "xxl"; // 確保使用更大的字體
          // 確保數字垂直對齊在頂部
          balanceContainer.justifyContent = "flex-start";
          balanceContainer.alignItems = "center";
          balanceContainer.height = "18px"; // 設置與收入、支出相同的高度
          balanceContainer.margin = "none"; // 移除邊距
          balanceContainer.paddingTop = "0px"; // 移除頂部間距
        }

        // 確保左側容器間距最小化
        topSection.contents[0].spacing = "none";
        topSection.contents[0].height = "36px"; // 調整為更小的高度
        topSection.contents[0].paddingTop = "0px";
        topSection.contents[0].paddingBottom = "0px";
      }

      // 調整右側收入和支出數字的容器和顯示方式
      if (topSection.contents[1].contents) {
        // 調整收入標籤和數字
        if (
          topSection.contents[1].contents[0].contents &&
          topSection.contents[1].contents[0].contents.length > 1
        ) {
          // 調整收入標籤位置和對齊方式
          const incomeLabelElement =
            topSection.contents[1].contents[0].contents[0];
          incomeLabelElement.align = "start";
          incomeLabelElement.margin = "xl"; // 從 md 改為 xl

          // 調整收入數字
          const incomeElement = topSection.contents[1].contents[0].contents[1];
          incomeElement.adjustMode = "shrink-to-fit";
          incomeElement.maxLines = 1; // 限制為單行
          incomeElement.size = "md"; // 保持中等大小
          incomeElement.flex = 1;

          // 設置收入容器高度
          topSection.contents[1].contents[0].height = "18px";
          topSection.contents[1].contents[0].margin = "none"; // 移除邊距
        }

        // 調整支出標籤和數字
        if (
          topSection.contents[1].contents[1].contents &&
          topSection.contents[1].contents[1].contents.length > 1
        ) {
          // 調整支出標籤位置和對齊方式
          const expenseLabelElement =
            topSection.contents[1].contents[1].contents[0];
          expenseLabelElement.align = "start";
          expenseLabelElement.margin = "xl"; // 從 md 改為 xl

          // 調整支出數字
          const expenseElement = topSection.contents[1].contents[1].contents[1];
          expenseElement.adjustMode = "shrink-to-fit";
          expenseElement.maxLines = 1; // 限制為單行
          expenseElement.size = "md"; // 保持中等大小
          expenseElement.flex = 1;

          // 設置支出容器高度，與收入一致
          topSection.contents[1].contents[1].height = "18px";
          topSection.contents[1].contents[1].margin = "none"; // 移除邊距
        }

        // 給右側容器設置和左側一致的尺寸和間距
        topSection.contents[1].flex = 2;
        topSection.contents[1].paddingStart = "12px";
        topSection.contents[1].spacing = "none";
        topSection.contents[1].height = "36px"; // 調整為更小的高度
        topSection.contents[1].paddingTop = "0px";
        topSection.contents[1].paddingBottom = "0px";
      }

      // 調整整體頂部區域的高度和間距
      topSection.height = "48px"; // 調整為更小的高度
      topSection.paddingBottom = "20px"; // 增加底部間距，從 12px 提高到 20px

      // 調整分隔線下方間距
      if (flexMessage.body.contents.length > 1) {
        // 第二個元素是分隔線容器
        const separatorBox = flexMessage.body.contents[1];
        // 增加分隔線上方的間距
        separatorBox.paddingTop = "8px";
        separatorBox.paddingBottom = "12px"; // 保持分隔線下方間距不變
      }
    }

    // Add analysis items if they exist
    if (
      data.analysisItems &&
      Array.isArray(data.analysisItems) &&
      data.analysisItems.length > 0 &&
      flexMessage.body.contents.length >= 4
    ) {
      const analysisContainer = flexMessage.body.contents[3];

      // Clear any existing contents
      analysisContainer.contents = [];

      // Define a sequence of colors to use based on the image reference
      // These colors represent the various categories in the example image
      const colorSequence = [
        "#4A90E2", // 藍色 (娛樂)
        "#50E3C2", // 青綠色 (購物)
        "#FFCE56", // 黃色 (哈哈)
        "#FF9650", // 橙色 (電話)
        "#A78BFA", // 紫色 (醫療)
        "#4CAF50", // 綠色 (晚餐)
        "#9C27B0", // 深紫色 (餐飲)
        "#FF6B6B", // 紅色 (其他)
        "#2196F3", // 淺藍色 (早餐)
        "#26C6DA", // 淺綠藍色 (甜點)
        "#FFC107", // 金黃色 (水電)
      ];

      // First, filter out items with 0% to avoid showing them
      const validItems = data.analysisItems.filter((item) => {
        const percentMatch = item.percentage?.match(/^(\d+(\.\d+)?)%$/);
        return percentMatch && parseFloat(percentMatch[1]) > 0;
      });

      // Format percentages - remove decimal places
      validItems.forEach((item) => {
        if (item.percentage) {
          const percentMatch = item.percentage.match(/^(\d+)(\.\d+)?%$/);
          if (percentMatch) {
            // Keep only the integer part
            item.percentage = `${percentMatch[1]}%`;
          }
        }
      });

      // Sort items by percentage in descending order
      validItems.sort((a, b) => {
        const percentA = parseFloat(a.percentage.replace("%", "")) || 0;
        const percentB = parseFloat(b.percentage.replace("%", "")) || 0;
        return percentB - percentA;
      });

      // Create the stacked progress bar container
      const progressBarContainer = {
        type: "box",
        layout: "horizontal",
        contents: [],
        height: "24px",
        cornerRadius: "md",
        margin: "md",
      };

      // Calculate total percentage first (for normalization)
      let totalPercentage = 0;
      validItems.forEach((item) => {
        if (item.percentage) {
          const percentMatch = item.percentage.match(/^(\d+(\.\d+)?)%$/);
          if (percentMatch && percentMatch[1]) {
            totalPercentage += parseFloat(percentMatch[1]);
          }
        }
      });

      // Add each category segment to the progress bar
      let processedPercentage = 0;
      validItems.forEach((item, index) => {
        // Extract percentage as a number
        let percentValue = 0;
        if (item.percentage) {
          const percentMatch = item.percentage.match(/^(\d+(\.\d+)?)%$/);
          if (percentMatch && percentMatch[1]) {
            percentValue = parseFloat(percentMatch[1]);
          }
        }

        // Skip if percentage is 0
        if (percentValue <= 0) return;

        // Assign color based on index in the sequence
        const colorIndex = index % colorSequence.length;
        const segmentColor = colorSequence[colorIndex];

        // Store the color for later use with the legend
        item.color = segmentColor;

        // Calculate normalized width to ensure total is exactly 100%
        let segmentWidth;

        // For the last item, use the remaining percentage to ensure we reach 100%
        if (index === validItems.length - 1) {
          segmentWidth = 100 - processedPercentage;
        } else {
          // Otherwise calculate proportional width
          segmentWidth =
            totalPercentage > 0
              ? Math.round((percentValue / totalPercentage) * 100)
              : 0;
          processedPercentage += segmentWidth;
        }

        // Add segment to progress bar
        progressBarContainer.contents.push({
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "filler",
            },
          ],
          width: `${segmentWidth}%`,
          backgroundColor: segmentColor,
        });
      });

      // Add the progress bar to analysis container
      analysisContainer.contents.push(progressBarContainer);

      // Add spacing between progress bar and legend
      analysisContainer.contents.push({
        type: "box",
        layout: "vertical",
        contents: [],
        height: "16px",
      });

      // Organize items in rows of 3 horizontally
      for (let i = 0; i < validItems.length; i += 3) {
        // Create a row container
        const rowContents = [];

        // Add up to 3 items to this row
        for (let j = 0; j < 3; j++) {
          if (i + j < validItems.length) {
            const item = validItems[i + j];
            const itemColor = item.color; // Use the stored color

            // Create the legend item
            const legendItem = {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "box",
                  layout: "vertical",
                  contents: [],
                  width: "12px",
                  height: "12px",
                  backgroundColor: itemColor,
                  cornerRadius: "sm",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "sm",
                },
                {
                  type: "text",
                  text: item.category,
                  size: "xs",
                  color: "#555555",
                  flex: 0,
                  gravity: "center",
                  margin: "xs",
                },
                {
                  type: "text",
                  text: item.percentage,
                  size: "xs",
                  color: "#555555",
                  flex: 0,
                  gravity: "center",
                  margin: "xs",
                },
              ],
              spacing: "xs",
              flex: 1,
              alignItems: "center",
            };

            rowContents.push(legendItem);
          } else {
            // Add an empty spacer for alignment if we don't have enough items
            rowContents.push({
              type: "filler",
              flex: 1,
            });
          }
        }

        // Add the row to the analysis container
        const rowBox = {
          type: "box",
          layout: "horizontal",
          contents: rowContents,
          margin: "md",
          spacing: "md",
        };

        analysisContainer.contents.push(rowBox);
      }
    } else if (flexMessage.body.contents.length >= 4) {
      // 如果沒有分析項目數據，顯示無數據的信息
      const analysisContainer = flexMessage.body.contents[3];

      // Clear any existing contents
      analysisContainer.contents = [];

      // 添加灰色的空比例條
      const emptyProgressBarContainer = {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "filler",
              },
            ],
            width: "100%",
            backgroundColor: "#EEEEEE",
          },
        ],
        height: "24px",
        cornerRadius: "md",
        margin: "md",
      };

      // 先添加灰色的空比例條
      analysisContainer.contents.push(emptyProgressBarContainer);

      // 添加間距
      analysisContainer.contents.push({
        type: "box",
        layout: "vertical",
        contents: [],
        height: "16px",
      });

      // 添加無數據的提示
      analysisContainer.contents.push({
        type: "text",
        text: "暫無分析數據",
        size: "sm",
        color: "#999999",
        align: "center",
        margin: "md",
      });
    }

    console.log("Summary Flex Message created successfully");
    return flexMessage;
  } catch (error) {
    console.error("Error creating Summary Flex Message:", error);
    // Return a simple fallback Flex Message
    const fallbackMessage = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: data.title || "收支總結",
            weight: "bold",
            size: "lg",
          },
          {
            type: "text",
            text: `${periodPrefix}收: ${data.income || "$ 0"}`,
            size: "md",
            margin: "md",
          },
          {
            type: "text",
            text: `${periodPrefix}支: ${data.expense || "$ 0"}`,
            size: "md",
            margin: "sm",
          },
          {
            type: "text",
            text: `總計: ${data.balance || "$ 0"}`,
            size: "md",
            margin: "sm",
            weight: "bold",
          },
        ],
      },
    };

    return fallbackMessage;
  }
}

/**
 * Function to create a simplified Balance Summary Flex Message with only the top part
 */
function createBalanceSummaryMessage(data) {
  console.log(
    "Creating Balance Summary Flex Message with data:",
    JSON.stringify({
      title: data.title || "月結餘",
      income: data.income,
      expense: data.expense,
      balance: data.balance,
    })
  );

  try {
    // 使用標準的 summary.json 模板
    const templatePath = path.join(
      __dirname,
      "..",
      "templates",
      "summary.json"
    );
    const templateString = fs.readFileSync(templatePath, "utf8");

    // 設置標題為「月結餘」
    let title = data.title || "月結餘";
    let periodPrefix = "月"; // 默認使用「月」作為前綴

    // 如果標題中包含期間前綴和交易類型，提取期間前綴並將標題格式化為「X結餘」
    const periodMatch = title.match(/(日|週|周|月)([收支入出]+)/);
    if (periodMatch) {
      // 獲取期間前綴
      periodPrefix = periodMatch[1] === "周" ? "週" : periodMatch[1]; // 標準化「周」為「週」
      // 重新格式化為「X結餘」格式，而不是「X支出總結」
      title = `${periodPrefix}結餘`;
    } else if (title === "月結餘") {
      // 如果標題已經是「月結餘」，確保 periodPrefix 設置為「月」
      periodPrefix = "月";
    }

    console.log(`Final title for Balance Summary: ${title}`);

    // 創建收入和支出標籤
    const incomeLabel = `${periodPrefix}收`;
    const expenseLabel = `${periodPrefix}支`;

    // 處理金額值，無數據時顯示為 $ 0 而非無資料
    let incomeValue = data.income || "$ 0";
    let expenseValue = data.expense || "$ 0";
    let balanceValue = data.balance || "$ 0";

    // 替換模板中的佔位符
    let flexMessageString = templateString
      .replace("${TITLE}", title)
      .replace("${BALANCE_VALUE}", balanceValue)
      .replace("${INCOME_VALUE}", incomeValue)
      .replace("${EXPENSE_VALUE}", expenseValue)
      .replace("${ANALYSIS_TITLE}", "") // 不顯示分析標題
      .replace(/"text": "收"/, `"text": "${incomeLabel}"`)
      .replace(/"text": "支"/, `"text": "${expenseLabel}"`);

    // 解析回 JSON
    const flexMessage = JSON.parse(flexMessageString);

    // 調整摘要 Flex 消息，只保留頂部的結餘、收入和支出部分
    if (flexMessage.body.contents && flexMessage.body.contents.length > 0) {
      // 只保留頂部結餘/收入/支出部分，完全移除分隔線和分析部分
      flexMessage.body.contents = [flexMessage.body.contents[0]];

      // 與標準摘要相同的樣式調整
      const topSection = flexMessage.body.contents[0];

      // 調整左側結餘數字
      if (
        topSection.contents[0].contents &&
        topSection.contents[0].contents.length > 1
      ) {
        // 結餘標題容器
        const titleContainer = topSection.contents[0].contents[0];
        if (titleContainer.contents && titleContainer.contents.length > 0) {
          const titleElement = titleContainer.contents[0];
          titleElement.align = "start";
          titleElement.margin = "none";
          titleContainer.justifyContent = "flex-end";
          titleContainer.alignItems = "center";
          titleContainer.height = "18px";
          titleContainer.paddingBottom = "0px";
        }

        // 結餘數字容器
        const balanceContainer = topSection.contents[0].contents[1];
        if (balanceContainer.contents && balanceContainer.contents.length > 0) {
          const balanceElement = balanceContainer.contents[0];
          balanceElement.adjustMode = "shrink-to-fit";
          balanceElement.maxLines = 1;
          balanceElement.size = "xxl";
          balanceContainer.justifyContent = "flex-start";
          balanceContainer.alignItems = "center";
          balanceContainer.height = "18px";
          balanceContainer.margin = "none";
          balanceContainer.paddingTop = "0px";
        }

        topSection.contents[0].spacing = "none";
        topSection.contents[0].height = "36px";
        topSection.contents[0].paddingTop = "0px";
        topSection.contents[0].paddingBottom = "0px";
      }

      // 調整右側收入和支出
      if (topSection.contents[1].contents) {
        // 調整收入
        if (
          topSection.contents[1].contents[0].contents &&
          topSection.contents[1].contents[0].contents.length > 1
        ) {
          const incomeLabelElement =
            topSection.contents[1].contents[0].contents[0];
          incomeLabelElement.align = "start";
          incomeLabelElement.margin = "xl";

          const incomeElement = topSection.contents[1].contents[0].contents[1];
          incomeElement.adjustMode = "shrink-to-fit";
          incomeElement.maxLines = 1;
          incomeElement.size = "md";
          incomeElement.flex = 1;

          topSection.contents[1].contents[0].height = "18px";
          topSection.contents[1].contents[0].margin = "none";
        }

        // 調整支出
        if (
          topSection.contents[1].contents[1].contents &&
          topSection.contents[1].contents[1].contents.length > 1
        ) {
          const expenseLabelElement =
            topSection.contents[1].contents[1].contents[0];
          expenseLabelElement.align = "start";
          expenseLabelElement.margin = "xl";

          const expenseElement = topSection.contents[1].contents[1].contents[1];
          expenseElement.adjustMode = "shrink-to-fit";
          expenseElement.maxLines = 1;
          expenseElement.size = "md";
          expenseElement.flex = 1;

          topSection.contents[1].contents[1].height = "18px";
          topSection.contents[1].contents[1].margin = "none";
        }

        topSection.contents[1].flex = 2;
        topSection.contents[1].paddingStart = "12px";
        topSection.contents[1].spacing = "none";
        topSection.contents[1].height = "36px";
        topSection.contents[1].paddingTop = "0px";
        topSection.contents[1].paddingBottom = "0px";
      }

      // 調整整體頂部區域
      topSection.height = "48px";
      topSection.paddingBottom = "0px"; // 移除底部間距，因為已經沒有分隔線了

      // 調整底部間距
      flexMessage.body.paddingBottom = "12px";
    }

    console.log("Balance Summary Flex Message created successfully");
    return flexMessage;
  } catch (error) {
    console.error("Error creating Balance Summary Flex Message:", error);
    // 返回一個簡單的後備消息
    return {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "月結餘",
            weight: "bold",
            size: "md",
          },
          {
            type: "text",
            text: data.balance || "$ 0",
            size: "xl",
            weight: "bold",
            margin: "md",
          },
          {
            type: "box",
            layout: "horizontal",
            margin: "md",
            contents: [
              {
                type: "text",
                text: "月收入:",
                size: "sm",
                color: "#555555",
                flex: 1,
              },
              {
                type: "text",
                text: data.income || "$ 0",
                size: "sm",
                color: "#555555",
                flex: 1,
                align: "end",
              },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            margin: "sm",
            contents: [
              {
                type: "text",
                text: "月支出:",
                size: "sm",
                color: "#555555",
                flex: 1,
              },
              {
                type: "text",
                text: data.expense || "$ 0",
                size: "sm",
                color: "#555555",
                flex: 1,
                align: "end",
              },
            ],
          },
        ],
      },
    };
  }
}

module.exports = {
  createFlexMessage,
  createSummaryMessage,
  createBalanceSummaryMessage,
};
