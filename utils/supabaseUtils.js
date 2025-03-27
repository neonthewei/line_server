const { createClient } = require("@supabase/supabase-js");

/**
 * 創建並返回 Supabase 客戶端
 */
function getSupabaseClient() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("Supabase 環境變量未設置正確");
      console.error(`SUPABASE_URL: ${supabaseUrl ? "已設置" : "未設置"}`);
      console.error(`SUPABASE_KEY: ${supabaseKey ? "已設置" : "未設置"}`);
      return null;
    }

    return createClient(supabaseUrl, supabaseKey);
  } catch (error) {
    console.error("創建 Supabase 客戶端時出錯:", error);
    return null;
  }
}

/**
 * 根據 LINE 用戶 ID 獲取系統用戶 ID
 * @param {string} lineUserId - LINE 用戶 ID
 * @returns {Promise<string>} - 系統用戶 ID
 */
async function getUserIdFromLineId(lineUserId) {
  try {
    console.log(`===== 開始查詢用戶 ID =====`);
    console.log(`查詢 LINE 用戶 ID: ${lineUserId}`);

    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error("無法創建 Supabase 客戶端");
      return "default_user";
    }

    // 直接查詢 users 表中匹配 LINE 用戶 ID 的記錄
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (error) {
      // 檢查是否是"表不存在"的錯誤
      if (error.code === "42P01") {
        console.error(`數據庫中不存在 users 表，需要創建該表`);
        console.log(`請確保在 Supabase 中創建以下表結構：
        - users 表:
          - id (主鍵)
          - line_user_id (用於存儲 LINE 用戶 ID)
          - 其他需要的用戶信息字段`);
      } else if (error.code === "PGRST116") {
        console.log(`未找到對應 LINE 用戶 ID ${lineUserId} 的記錄`);
      } else {
        console.error(`查詢用戶 ID 時出錯:`, error);
      }
      console.log(`將使用默認用戶 ID: default_user`);
      return "default_user";
    }

    if (data) {
      console.log(
        `成功找到用戶 ID: ${data.id} (對應 LINE 用戶 ID: ${lineUserId})`
      );
      return data.id;
    } else {
      console.log(
        `未找到對應 LINE 用戶 ID ${lineUserId} 的記錄，將使用默認用戶 ID: default_user`
      );
      return "default_user";
    }
  } catch (error) {
    console.error(`getUserIdFromLineId 發生異常:`, error);
    console.log(`將使用默認用戶 ID: default_user`);
    return "default_user";
  } finally {
    console.log(`===== 完成查詢用戶 ID =====`);
  }
}

/**
 * 根據用戶ID和時間範圍獲取交易數據
 * @param {string} lineUserId - LINE 用戶 ID
 * @param {string} periodType - 時間範圍類型: '日', '週', '月'
 * @returns {Promise<Object>} - 包含收入、支出、分類數據的對象
 */
async function getTransactionData(lineUserId, periodType) {
  try {
    console.log(`===== 開始獲取交易數據 =====`);
    console.log(`LINE 用戶 ID: ${lineUserId}`);
    console.log(`時間範圍: ${periodType}`);

    // 直接使用 LINE 用戶 ID 作為查詢條件
    const userId = lineUserId;
    console.log(`使用 LINE 用戶 ID 作為查詢條件: ${userId}`);

    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error("無法創建 Supabase 客戶端，將使用默認數據");
      return null;
    }

    // 使用更直接的方式獲取台灣台北時區的當前日期 (GMT+8)
    // 使用台灣時區字符串創建日期對象
    const options = {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    const taiwanDateStr = new Date().toLocaleString("zh-TW", options);

    // 解析年月日
    const dateParts = taiwanDateStr.split("/");
    // 台灣日期格式為 MM/DD/YYYY，我們需要轉換為 YYYY-MM-DD
    let year, month, day;

    // 檢查日期格式並解析
    if (dateParts.length === 3) {
      if (dateParts[0].length === 4) {
        // 如果第一部分是年份 (YYYY/MM/DD)
        year = dateParts[0];
        month = dateParts[1].padStart(2, "0");
        day = dateParts[2].padStart(2, "0");
      } else {
        // 如果是 MM/DD/YYYY 格式
        year = dateParts[2];
        month = dateParts[0].padStart(2, "0");
        day = dateParts[1].padStart(2, "0");
      }
    } else {
      // 如果無法解析，使用硬編碼的方式
      const taiwanNow = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
      year = taiwanNow.getUTCFullYear();
      month = String(taiwanNow.getUTCMonth() + 1).padStart(2, "0");
      day = String(taiwanNow.getUTCDate()).padStart(2, "0");
    }

    // 格式化為 YYYY-MM-DD
    const todayStr = `${year}-${month}-${day}`;

    // 創建用於計算週和月範圍的日期對象
    const today = new Date(`${year}-${month}-${day}T00:00:00Z`);

    console.log(`台灣台北現在日期: ${todayStr} (解析自 ${taiwanDateStr})`);

    // 初始化基本查詢
    let query = supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .order("datetime", { ascending: false });

    let timeRangeDescription = "";
    let transactionsInRange = [];

    // 根據期間類型添加日期篩選條件
    if (periodType === "日") {
      timeRangeDescription = "今日";

      // 獲取所有交易記錄
      const { data, error } = await query;

      if (error) {
        console.error(`查詢交易數據時出錯:`, error);
        return null;
      }

      if (!data || data.length === 0) {
        console.log(`用戶 ${userId} 沒有任何交易記錄，將使用默認數據`);
        return null;
      }

      // 篩選當天的記錄
      transactionsInRange = data.filter((record) => {
        if (!record.datetime) return false;
        // datetime 只存儲日期，直接比較是否等於今天的日期
        const recordDate = record.datetime.split("T")[0];
        console.log(`比較記錄日期 ${recordDate} 與今日 ${todayStr}`);
        return recordDate === todayStr;
      });
    } else if (periodType === "週") {
      // 計算本週的開始日期（週日）
      const weekStart = new Date(today);
      const day = weekStart.getDay(); // 0 是週日, 6 是週六
      weekStart.setDate(weekStart.getDate() - day);

      // 格式化為 YYYY-MM-DD
      const weekStartYear = weekStart.getFullYear();
      const weekStartMonth = String(weekStart.getMonth() + 1).padStart(2, "0");
      const weekStartDay = String(weekStart.getDate()).padStart(2, "0");
      const weekStartStr = `${weekStartYear}-${weekStartMonth}-${weekStartDay}`;

      timeRangeDescription = `本週 (${weekStartStr} 至 ${todayStr})`;

      // 獲取所有交易記錄
      const { data, error } = await query;

      if (error) {
        console.error(`查詢交易數據時出錯:`, error);
        return null;
      }

      if (!data || data.length === 0) {
        console.log(`用戶 ${userId} 沒有任何交易記錄，將使用默認數據`);
        return null;
      }

      // 篩選本週的記錄
      transactionsInRange = data.filter((record) => {
        if (!record.datetime) return false;
        const recordDate = record.datetime.split("T")[0];
        return recordDate >= weekStartStr && recordDate <= todayStr;
      });
    } else if (periodType === "月") {
      // 計算本月的開始日期
      const monthStartStr = `${year}-${month}-01`;

      timeRangeDescription = `本月 (${monthStartStr} 至 ${todayStr})`;

      // 獲取所有交易記錄
      const { data, error } = await query;

      if (error) {
        console.error(`查詢交易數據時出錯:`, error);
        return null;
      }

      if (!data || data.length === 0) {
        console.log(`用戶 ${userId} 沒有任何交易記錄，將使用默認數據`);
        return null;
      }

      // 篩選本月的記錄
      transactionsInRange = data.filter((record) => {
        if (!record.datetime) return false;
        const recordDate = record.datetime.split("T")[0];
        return recordDate >= monthStartStr && recordDate <= todayStr;
      });
    } else {
      // 如果不是特定的時間範圍，獲取所有記錄
      const { data, error } = await query;

      if (error) {
        // 檢查是否是"表不存在"的錯誤
        if (error.code === "42P01") {
          console.error(`數據庫中不存在 transactions 表，需要創建該表`);
          console.log(`請確保在 Supabase 中創建以下表結構：
          - transactions 表:
            - id (主鍵)
            - user_id (用於存儲 LINE 用戶 ID)
            - type (收入/支出類型，例如 "income" 或 "expense")
            - category (類別，例如 "餐飲"、"交通" 等)
            - amount (金額)
            - datetime (日期時間)
            - 其他需要的交易信息字段`);
        } else {
          console.error(`查詢交易數據時出錯:`, error);
        }
        return null;
      }

      if (!data || data.length === 0) {
        console.log(`用戶 ${userId} 沒有任何交易記錄，將使用默認數據`);
        return null;
      }

      timeRangeDescription = "所有時間";
      transactionsInRange = data;
    }

    console.log(`時間範圍描述: ${timeRangeDescription}`);
    console.log(`找到符合範圍的記錄數: ${transactionsInRange.length}`);

    if (transactionsInRange.length === 0) {
      console.log(
        `用戶 ${userId} 在${timeRangeDescription}沒有交易記錄，將使用默認數據`
      );
      return null;
    }

    return processTransactions(transactionsInRange);
  } catch (error) {
    console.error(`getTransactionData 發生異常:`, error);
    return null;
  } finally {
    console.log(`===== 完成獲取交易數據 =====`);
  }
}

/**
 * 處理交易記錄並格式化結果
 * @param {Array} data - 交易記錄數組
 * @returns {Object} - 格式化後的結果對象
 */
function processTransactions(data) {
  console.log(`成功找到 ${data.length} 條交易記錄`);
  // 只打印前2條記錄數據的簡短摘要，避免過多輸出
  if (data.length > 0) {
    console.log(`前2條交易記錄摘要:`);
    for (let i = 0; i < Math.min(2, data.length); i++) {
      const record = data[i];
      console.log(
        `  #${i + 1}: 類型=${record.type}, 類別=${record.category}, 金額=${
          record.amount
        }`
      );
    }
  }

  // 初始化結果對象
  const result = {
    income: 0,
    expense: 0,
    balance: 0,
    expenseCategories: {}, // 改名為expenseCategories以與incomeCategories區分
    incomeCategories: {}, // 新增：追蹤收入類別
  };

  // 處理交易數據
  let incomeCount = 0;
  let expenseCount = 0;

  data.forEach((transaction) => {
    if (!transaction.amount) {
      console.log(`跳過沒有金額的交易 ID ${transaction.id || "unknown"}`);
      return;
    }

    const amount = parseFloat(transaction.amount);

    // 根據類型處理收入或支出
    if (transaction.type === "income") {
      result.income += amount;
      incomeCount++;

      // 新增：處理收入類別統計
      const category = transaction.category || "其他";
      if (!result.incomeCategories[category]) {
        result.incomeCategories[category] = 0;
      }
      result.incomeCategories[category] += amount;
    } else {
      // 支出類型
      result.expense += amount;
      expenseCount++;

      // 處理支出類別統計
      const category = transaction.category || "其他";
      if (!result.expenseCategories[category]) {
        result.expenseCategories[category] = 0;
      }
      result.expenseCategories[category] += amount;
    }
  });

  console.log(
    `處理結果: 收入記錄 ${incomeCount} 條，支出記錄 ${expenseCount} 條`
  );
  console.log(`總收入: ${result.income}, 總支出: ${result.expense}`);

  // 計算餘額
  result.balance = result.income - result.expense;

  // 處理類別的顯示格式和百分比
  const expenseAnalysisItems = [];
  const incomeAnalysisItems = [];

  // 處理支出類別分析
  if (result.expense > 0) {
    Object.entries(result.expenseCategories).forEach(([category, amount]) => {
      const percentage = (amount / result.expense) * 100;
      expenseAnalysisItems.push({
        category,
        amount: `$ ${amount.toLocaleString("en-US", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })}`,
        percentage: `${Math.round(percentage)}%`,
      });
    });

    console.log(`支出類別分析: ${expenseAnalysisItems.length} 個類別`);
  } else {
    console.log(`沒有支出數據，無法生成支出類別分析`);
  }

  // 新增：處理收入類別分析
  if (result.income > 0) {
    Object.entries(result.incomeCategories).forEach(([category, amount]) => {
      const percentage = (amount / result.income) * 100;
      incomeAnalysisItems.push({
        category,
        amount: `$ ${amount.toLocaleString("en-US", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })}`,
        percentage: `${Math.round(percentage)}%`,
      });
    });

    console.log(`收入類別分析: ${incomeAnalysisItems.length} 個類別`);
  } else {
    console.log(`沒有收入數據，無法生成收入類別分析`);
  }

  // 根據金額排序類別（從高到低）
  expenseAnalysisItems.sort((a, b) => {
    const amountA = parseFloat(a.amount.replace(/[$,\s]/g, ""));
    const amountB = parseFloat(b.amount.replace(/[$,\s]/g, ""));
    return amountB - amountA;
  });

  // 排序收入類別
  incomeAnalysisItems.sort((a, b) => {
    const amountA = parseFloat(a.amount.replace(/[$,\s]/g, ""));
    const amountB = parseFloat(b.amount.replace(/[$,\s]/g, ""));
    return amountB - amountA;
  });

  // 格式化結果
  const formattedResult = {
    income: `$ ${result.income.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`,
    expense: `$ ${result.expense.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`,
    balance: `$ ${result.balance.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`,
    expenseAnalysisItems: expenseAnalysisItems,
    incomeAnalysisItems: incomeAnalysisItems,
  };

  console.log(
    `成功格式化結果: 收入=${formattedResult.income}, 支出=${formattedResult.expense}, 結餘=${formattedResult.balance}`
  );

  return formattedResult;
}

/**
 * 嘗試創建必要的資料庫表 (僅用於開發環境)
 * 請注意: 這個函數應該謹慎使用，最好通過 Supabase Dashboard 手動創建表
 */
async function createDatabaseSchema() {
  try {
    console.log("開始嘗試創建數據庫表...");

    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error("無法創建 Supabase 客戶端");
      return { success: false, message: "無法創建 Supabase 客戶端" };
    }

    // 檢查環境 - 出於安全考慮，只在開發環境執行
    if (process.env.NODE_ENV !== "development") {
      return {
        success: false,
        message:
          "該函數只能在開發環境中執行。請在 Supabase 控制台中手動創建表。",
      };
    }

    console.log("檢查 transactions 表是否存在...");
    const { error: transactionsCheckError } = await supabase
      .from("transactions")
      .select("id")
      .limit(1)
      .single();

    if (transactionsCheckError && transactionsCheckError.code === "42P01") {
      console.log("transactions 表不存在，提供創建指南...");

      // 提供表結構說明
      console.log(`
請在 Supabase 控制台中創建以下表:

transactions 表:
  - id (uuid, 主鍵)
  - user_id (text, 不能為空) - 用於存儲 LINE 用戶 ID
  - type (text, 不能為空) - "income" 或 "expense"
  - category (text)
  - amount (numeric, 不能為空)
  - memo (text)
  - datetime (timestamp with time zone, 默認 now())
  - is_fixed (boolean, 默認 false)
  - created_at (timestamp with time zone, 默認 now())
  - updated_at (timestamp with time zone)
      `);

      return {
        success: false,
        message: "請根據提供的信息在 Supabase 控制台中手動創建表",
      };
    } else if (transactionsCheckError) {
      console.error("檢查 transactions 表時出錯:", transactionsCheckError);
      return {
        success: false,
        message: "檢查 transactions 表時出錯",
      };
    } else {
      console.log("transactions 表已存在");
      return { success: true, message: "數據庫表檢查完成" };
    }
  } catch (error) {
    console.error("創建數據庫表時發生錯誤:", error);
    return { success: false, message: "檢查數據庫表時發生錯誤" };
  }
}

module.exports = {
  getSupabaseClient,
  getUserIdFromLineId,
  getTransactionData,
  createDatabaseSchema,
};
