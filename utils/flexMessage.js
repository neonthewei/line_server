const fs = require("fs");
const path = require("path");

/**
 * Function to create a Flex Message using the template and data
 */
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

module.exports = {
  createFlexMessage,
};
