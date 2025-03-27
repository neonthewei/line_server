# 資料庫設置指南 (簡化版)

本文檔說明如何在 Supabase 中設置必要的數據表以支持「旺來記帳機器人」的功能。

## 前提條件

1. 您需要一個 Supabase 帳戶並創建了一個項目
2. 您需要獲取 Supabase URL 和 API Key（可在項目設置中找到）
3. 將這些值添加到您的 `.env` 文件中：
   ```
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_key
   ```

## 簡化的資料庫結構

旺來記帳機器人使用了一個簡化的資料庫結構，只需要一個 `transactions` 表來存儲所有交易數據。用戶標識直接使用 LINE 用戶 ID 存儲在 `user_id` 欄位中，不需要單獨的用戶表。

## 設置 transactions 表

在 Supabase SQL 編輯器中執行：

```sql
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL, -- 直接存儲 LINE 用戶 ID
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category TEXT,
    amount NUMERIC NOT NULL,
    memo TEXT,
    datetime TIMESTAMP WITH TIME ZONE DEFAULT now(),
    is_fixed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- 創建索引以加速查詢
CREATE INDEX idx_transactions_user_id ON public.transactions (user_id);
CREATE INDEX idx_transactions_datetime ON public.transactions (datetime);
CREATE INDEX idx_transactions_type ON public.transactions (type);

-- 啟用行級安全 (如果需要)
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
```

## 添加測試數據

使用您實際的 LINE 用戶 ID 添加一些測試數據：

```sql
-- 插入測試交易記錄 (請替換為您的實際 LINE 用戶 ID)
INSERT INTO public.transactions (user_id, type, category, amount, memo, datetime, is_fixed)
VALUES
('您的LINE用戶ID', 'income', '薪水', 30000, '本月薪水', NOW() - INTERVAL '5 days', true),
('您的LINE用戶ID', 'expense', '餐飲', 500, '晚餐', NOW() - INTERVAL '4 days', false),
('您的LINE用戶ID', 'expense', '交通', 200, '計程車', NOW() - INTERVAL '3 days', false),
('您的LINE用戶ID', 'expense', '購物', 1500, '衣服', NOW() - INTERVAL '2 days', false),
('您的LINE用戶ID', 'expense', '娛樂', 800, '電影', NOW() - INTERVAL '1 day', false),
('您的LINE用戶ID', 'expense', '其他', 300, '雜項', NOW(), false);
```

> **重要提示**: 請將 `'您的LINE用戶ID'` 替換為控制台中顯示的實際 LINE 用戶 ID (如 `'U08946a96a3892561e1c3baa589ffeaee'`)。

## 故障排除

1. **表不存在錯誤**

   如果您看到錯誤 `relation "public.transactions" does not exist`，請按照上面的 SQL 創建 transactions 表。

2. **沒有交易記錄**

   如果系統提示 "用戶在指定時間範圍內沒有交易記錄"，請檢查：

   - 您已經使用正確的 LINE 用戶 ID 添加了交易記錄
   - 添加的記錄時間在請求的時間範圍內（日/週/月）
   - 交易記錄的類型正確（income/expense）

3. **確認您的 LINE 用戶 ID**

   您可以在應用日誌中找到您的 LINE 用戶 ID，通常顯示為:

   ```
   查詢 LINE 用戶 ID: U08946a96a3892561e1c3baa589ffeaee
   ```

## 測試摘要功能

設置好資料庫和測試數據後，發送以下消息測試:

- "日支出總結" - 獲取今天的支出摘要
- "週支出總結" - 獲取本週的支出摘要
- "月支出總結" - 獲取本月的支出摘要
- "日收入總結" - 獲取今天的收入摘要
