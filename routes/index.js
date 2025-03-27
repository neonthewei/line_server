const express = require("express");
const verifyLineSignature = require("../middleware/lineVerification");
const { handleWebhook } = require("../controllers/webhookController");
const { createDatabaseSchema } = require("../utils/supabaseUtils");

const router = express.Router();

// Webhook endpoint
router.post("/webhook", verifyLineSignature, handleWebhook);

// Health check endpoint
router.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Database schema check endpoint (for development only)
router.get("/db-check", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({
      success: false,
      message: "此端點在生產環境中被禁用",
    });
  }

  try {
    const result = await createDatabaseSchema();
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error("數據庫檢查錯誤:", error);
    res.status(500).json({
      success: false,
      message: "數據庫檢查過程中發生錯誤",
      error: error.message,
    });
  }
});

module.exports = router;
