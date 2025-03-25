const crypto = require("crypto");

/**
 * LINE Message Signature Verification Middleware
 * Verifies that webhook requests are coming from LINE by checking the signature
 */
const verifyLineSignature = (req, res, next) => {
  console.log("Received webhook request:", {
    headers: req.headers,
    body: req.body,
  });

  const signature = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(JSON.stringify(req.body))
    .digest("base64");

  console.log("Calculated signature:", signature);
  console.log("Received signature:", req.headers["x-line-signature"]);

  if (signature !== req.headers["x-line-signature"]) {
    console.error("Signature verification failed");
    return res.status(403).json({ error: "Invalid signature" });
  }
  console.log("Signature verification passed");
  next();
};

module.exports = verifyLineSignature;
