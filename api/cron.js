require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

// Initialize Supabase client if environment variables are available
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

module.exports = async (req, res) => {
  // 暫時移除身份驗證檢查以測試API是否正常響應
  /*
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end("Unauthorized");
  }
  */

  try {
    // 如果沒有Supabase客戶端，返回測試響應
    if (!supabase) {
      return res.status(200).json({
        success: true,
        message:
          "API endpoint is working, but Supabase client is not configured.",
        env_check: {
          has_supabase_url: !!process.env.SUPABASE_URL,
          has_supabase_key: !!process.env.SUPABASE_KEY,
          has_cron_secret: !!process.env.CRON_SECRET,
        },
      });
    }

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
