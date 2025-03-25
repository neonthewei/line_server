module.exports = (req, res) => {
  res.status(200).json({
    message: "Cron API is working!",
    time: new Date().toISOString(),
    env: {
      // 只檢查環境變量是否存在，不顯示實際值
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_KEY: !!process.env.SUPABASE_KEY,
      CRON_SECRET: !!process.env.CRON_SECRET,
    },
  });
};
