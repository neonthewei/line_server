const fs = require("fs");
const path = require("path");
const { LINE_MESSAGE_LIMITS } = require("../config");

/**
 * Function to create a tutorial message using the split tutorial files
 */
function createTutorialMessage() {
  console.log("Creating tutorial messages from split files");
  try {
    // Load both tutorial templates from the split files
    const tutorial1Path = path.join(
      __dirname,
      "..",
      "templates",
      "tutorial_part1.json"
    );
    const tutorial2Path = path.join(
      __dirname,
      "..",
      "templates",
      "tutorial_part2.json"
    );

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
    const MAX_FLEX_MESSAGES = LINE_MESSAGE_LIMITS.MAX_FLEX_MESSAGES;
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

module.exports = {
  createTutorialMessage,
};
