require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = async function handler(req, res) {
  // 驗證請求的 Authorization 頭是否匹配 CRON_SECRET
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end("Unauthorized");
  }

  try {
    console.log("Starting daily transaction generation...");

    // Execute the SQL function for generating daily recurring transactions
    const { data, error } = await supabase.rpc(
      "generate_daily_recurring_transactions"
    );

    if (error) {
      console.error("Error executing function:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to generate daily transactions",
        error: error.message,
      });
    }

    console.log("Daily transactions generated successfully");
    return res.status(200).json({
      success: true,
      message: "Daily recurring transactions generated successfully",
      data,
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred",
      error: error.message,
    });
  }
};
