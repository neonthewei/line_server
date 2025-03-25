const crypto = require("crypto");
const { handleWebhook } = require("../controllers/webhookController");

// Verify LINE signature middleware function
function verifyLineSignature(req, signature) {
  console.log("Verifying LINE signature...");
  const calculatedSignature = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(JSON.stringify(req.body))
    .digest("base64");

  console.log("Calculated signature:", calculatedSignature);
  console.log("Received signature:", signature);

  return calculatedSignature === signature;
}

module.exports = async (req, res) => {
  console.log("Webhook endpoint called with method:", req.method);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const signature = req.headers["x-line-signature"];
  if (!signature) {
    console.error("Missing LINE signature");
    return res.status(400).json({ error: "Missing signature" });
  }

  if (!verifyLineSignature(req, signature)) {
    console.error("Invalid LINE signature");
    return res.status(403).json({ error: "Invalid signature" });
  }

  console.log("Signature verified, handling webhook...");

  try {
    await handleWebhook(req, res);
  } catch (error) {
    console.error("Error in webhook handler:", error);
    // 確保回應只發送一次
    if (!res.headersSent) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
};
