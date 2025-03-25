const express = require("express");
const verifyLineSignature = require("../middleware/lineVerification");
const { handleWebhook } = require("../controllers/webhookController");

const router = express.Router();

// Webhook endpoint
router.post("/webhook", verifyLineSignature, handleWebhook);

// Health check endpoint
router.get("/health", (req, res) => {
  res.status(200).send("OK");
});

module.exports = router;
