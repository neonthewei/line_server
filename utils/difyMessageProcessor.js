const { createFlexMessage } = require("./flexMessage");
const { createTutorialMessage } = require("./tutorialMessage");

/**
 * Function to process Dify message and prepare LINE response
 */
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

module.exports = {
  processDifyMessage,
  cleanMessageText,
};
