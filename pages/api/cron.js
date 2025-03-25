// Import Supabase client
import { createClient } from "@supabase/supabase-js";

// Define the API handler
export default async function handler(req, res) {
  // Check if this is a Vercel cron invocation
  const isVercelCron = req.headers["x-vercel-cron"] === "1";

  try {
    // Initialize Supabase client if credentials are available
    let supabaseStatus = "Not initialized";
    let result = null;

    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_KEY
      );
      supabaseStatus = "Initialized";

      // Only execute the database function on actual cron invocations or when BYPASS_CRON_CHECK is set
      if (isVercelCron || process.env.BYPASS_CRON_CHECK) {
        try {
          const { data, error } = await supabase.rpc(
            "generate_daily_recurring_transactions"
          );

          if (error) {
            supabaseStatus = "Error calling function";
            result = error.message;
          } else {
            supabaseStatus = "Function called successfully";
            result = data;
          }
        } catch (dbError) {
          supabaseStatus = "Exception during function call";
          result = dbError.message;
        }
      } else {
        supabaseStatus = "Skipped function call (not a cron invocation)";
      }
    }

    // Return status information
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      isCronInvocation: isVercelCron,
      supabase: {
        status: supabaseStatus,
        hasCredentials: !!(
          process.env.SUPABASE_URL && process.env.SUPABASE_KEY
        ),
      },
      result: result,
    });
  } catch (error) {
    // Handle any unexpected errors
    return res.status(500).json({
      success: false,
      message: "Unexpected error occurred",
      error: error.message,
    });
  }
}
