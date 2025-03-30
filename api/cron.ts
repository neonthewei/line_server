import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await supabase.rpc("generate_daily_recurring_transactions");

  if (error) {
    console.error("❌ Error executing function:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ message: "✅ Success! Transactions generated." });
  }