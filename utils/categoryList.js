const fs = require("fs");
const path = require("path");
const { getSupabaseClient } = require("./supabaseUtils");

/**
 * 创建分类列表的Flex Messages
 * @param {string} lineUserId - LINE用户ID
 * @returns {Promise<object>} - 包含收入和支出分类的flex message
 */
async function createCategoryListMessage(lineUserId) {
  try {
    console.log("创建分类列表Flex Messages，用户ID:", lineUserId);

    // 直接从categories表获取用户分类数据
    const categoriesData = await getCategoriesForUser(lineUserId);

    if (
      !categoriesData ||
      (categoriesData.incomeCategories.length === 0 &&
        categoriesData.expenseCategories.length === 0)
    ) {
      console.log("没有获取到分类数据，返回默认分类列表");
      // 返回单个气泡消息而非数组
      return createDefaultCategoryMessage();
    }

    const incomeCategories = categoriesData.incomeCategories;
    const expenseCategories = categoriesData.expenseCategories;

    console.log(
      `获取到 ${incomeCategories.length} 个收入分类和 ${expenseCategories.length} 个支出分类`
    );

    // 加载模板文件
    const templatePath = path.join(
      __dirname,
      "../templates/category_list.json"
    );
    const templateString = fs.readFileSync(templatePath, "utf8");
    let template = JSON.parse(templateString);

    // 重新排序气泡，将支出分类放在第一位，收入分类放在第二位
    if (template.contents.length > 1) {
      // 仅当有两个气泡时需要调整顺序
      const expenseBubble = template.contents.find(
        (bubble) => bubble.body.contents[0].text === "支出分類"
      );
      const incomeBubble = template.contents.find(
        (bubble) => bubble.body.contents[0].text === "收入分類"
      );

      if (expenseBubble && incomeBubble) {
        template.contents = [expenseBubble, incomeBubble];
      }
    }

    // 如果只有收入分类，只保留收入气泡
    if (incomeCategories.length > 0 && expenseCategories.length === 0) {
      template.contents = [
        template.contents.find(
          (bubble) => bubble.body.contents[0].text === "收入分類"
        ),
      ];
    }
    // 如果只有支出分类，只保留支出气泡
    else if (expenseCategories.length > 0 && incomeCategories.length === 0) {
      template.contents = [
        template.contents.find(
          (bubble) => bubble.body.contents[0].text === "支出分類"
        ),
      ];
    }
    // 如果两者都有，之前已经调整好顺序

    // 处理收入分类
    if (incomeCategories.length > 0) {
      // 获取收入气泡
      const incomeBubble = template.contents.find(
        (bubble) => bubble.body.contents[0].text === "收入分類"
      );

      if (incomeBubble) {
        // 更新收入气泡的内容
        incomeBubble.body.contents = [
          // 保留标题
          incomeBubble.body.contents[0],
          // 添加分隔线
          {
            type: "separator",
            color: "#DDDDDD",
            margin: "xl",
          },
          // 添加分类容器
          {
            type: "box",
            layout: "vertical",
            contents: [],
            margin: "xl",
            spacing: "md",
          },
        ];

        // 每三个分类创建一行
        for (let i = 0; i < incomeCategories.length; i += 3) {
          const rowCategories = incomeCategories.slice(
            i,
            Math.min(i + 3, incomeCategories.length)
          );
          const row = createCategoryRow(rowCategories);

          // 第一行以外的行添加上边距
          if (i > 0) {
            row.margin = "md";
          }

          incomeBubble.body.contents[2].contents.push(row);
        }
      }
    }

    // 处理支出分类
    if (expenseCategories.length > 0) {
      // 获取支出气泡
      const expenseBubble = template.contents.find(
        (bubble) => bubble.body.contents[0].text === "支出分類"
      );

      if (expenseBubble) {
        // 更新支出气泡的内容
        expenseBubble.body.contents = [
          // 保留标题
          expenseBubble.body.contents[0],
          // 添加分隔线
          {
            type: "separator",
            color: "#DDDDDD",
            margin: "xl",
          },
          // 添加分类容器
          {
            type: "box",
            layout: "vertical",
            contents: [],
            margin: "xl",
            spacing: "md",
          },
        ];

        // 每三个分类创建一行
        for (let i = 0; i < expenseCategories.length; i += 3) {
          const rowCategories = expenseCategories.slice(
            i,
            Math.min(i + 3, expenseCategories.length)
          );
          const row = createCategoryRow(rowCategories);

          // 第一行以外的行添加上边距
          if (i > 0) {
            row.margin = "md";
          }

          expenseBubble.body.contents[2].contents.push(row);
        }
      }
    }

    // 如果没有content，返回默认消息
    if (template.contents.length === 0) {
      return createDefaultCategoryMessage();
    }

    // 如果只有一个气泡，就直接返回该气泡
    if (template.contents.length === 1) {
      return template.contents[0];
    }

    return template;
  } catch (error) {
    console.error("创建分类列表Flex Messages时出错:", error);
    return createDefaultCategoryMessage();
  }
}

/**
 * 创建分类标签行
 * @param {Array} categories - 分类名称数组
 * @returns {Object} - 分类标签行
 */
function createCategoryRow(categories) {
  // 创建行容器
  const row = {
    type: "box",
    layout: "horizontal",
    contents: [],
    spacing: "md",
  };

  // 总是创建3个列，保持一致的宽度
  for (let i = 0; i < 3; i++) {
    // 如果该位置有分类则显示，否则创建一个空的透明盒子
    if (i < categories.length) {
      const label = {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: categories[i],
            size: "md",
            color: "#555555",
            align: "center",
          },
        ],
        backgroundColor: "#F5F5F5",
        cornerRadius: "lg",
        paddingAll: "md",
        flex: 1,
      };
      row.contents.push(label);
    } else {
      // 空位置用透明盒子占位，保持相同的尺寸和结构
      const emptySpace = {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: " ",
            size: "md",
            color: "#FFFFFF00", // 透明文字
            align: "center",
          },
        ],
        backgroundColor: "#FFFFFF00", // 完全透明
        cornerRadius: "lg",
        paddingAll: "md",
        flex: 1,
      };
      row.contents.push(emptySpace);
    }
  }

  return row;
}

/**
 * 从categories表获取用户的分类数据
 * @param {string} lineUserId - LINE用户ID
 * @returns {Promise<Object>} - 包含收入和支出分类的对象
 */
async function getCategoriesForUser(lineUserId) {
  try {
    console.log(`从categories表获取用户 ${lineUserId} 的分类数据`);

    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error("无法创建Supabase客户端");
      return null;
    }

    // 1. 获取系统预设分类（user_id为null且未删除）
    const { data: systemCategories, error: systemError } = await supabase
      .from("categories")
      .select("name, type")
      .is("user_id", null)
      .eq("is_deleted", false);

    if (systemError) {
      console.error("查询系统预设分类时出错:", systemError);
      return null;
    }

    // 2. 获取用户所有的分类记录（包括已删除的）
    const { data: userCategories, error: userError } = await supabase
      .from("categories")
      .select("name, type, is_deleted")
      .eq("user_id", lineUserId);

    if (userError) {
      console.error("查询用户分类时出错:", userError);
      return null;
    }

    // 3. 处理合并分类
    // 创建用户已删除的系统预设分类名称集合
    const userDeletedSystemCategories = new Set(
      userCategories
        .filter((cat) => cat.is_deleted === true)
        .map((cat) => cat.name)
    );

    console.log(
      `用户已删除的系统预设分类数: ${userDeletedSystemCategories.size}`
    );

    // 获取有效的系统预设分类（排除用户已删除的）
    const validSystemCategories = systemCategories.filter(
      (cat) => !userDeletedSystemCategories.has(cat.name)
    );

    console.log(`有效的系统预设分类数: ${validSystemCategories.length}`);

    // 获取用户自定义且未删除的分类
    const validUserCategories = userCategories.filter(
      (cat) => cat.is_deleted === false
    );

    console.log(`用户自定义且未删除的分类数: ${validUserCategories.length}`);

    // 合并系统分类和用户分类
    const allValidCategories = [
      ...validSystemCategories,
      ...validUserCategories,
    ];

    // 去重（因为用户可能有与系统分类同名的自定义分类）
    const uniqueCategories = [];
    const nameSet = new Set();

    allValidCategories.forEach((cat) => {
      if (!nameSet.has(cat.name)) {
        nameSet.add(cat.name);
        uniqueCategories.push(cat);
      }
    });

    // 区分收入和支出分类
    const incomeCategories = uniqueCategories
      .filter((cat) => cat.type === "income")
      .map((cat) => cat.name);

    const expenseCategories = uniqueCategories
      .filter((cat) => cat.type === "expense")
      .map((cat) => cat.name);

    console.log(
      `成功获取到 ${incomeCategories.length} 个收入分类和 ${expenseCategories.length} 个支出分类`
    );

    return {
      incomeCategories,
      expenseCategories,
    };
  } catch (error) {
    console.error("获取分类数据时出错:", error);
    return null;
  }
}

/**
 * 创建默认的分类列表Flex Message
 * @returns {object} - 默认分类列表flex message
 */
function createDefaultCategoryMessage() {
  try {
    // 创建一个简单的气泡消息
    return {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "分類",
            weight: "bold",
            color: "#4A90E2",
            size: "md",
          },
          {
            type: "separator",
            color: "#DDDDDD",
            margin: "md",
          },
          {
            type: "text",
            text: "目前還沒有分類數據，請先創建一些分類。",
            color: "#555555",
            align: "center",
            margin: "md",
          },
        ],
        paddingAll: "xl",
      },
    };
  } catch (error) {
    console.error("创建默认分类消息时出错:", error);

    // 最基本的消息格式，不会出错
    return {
      type: "text",
      text: "目前還沒有分類數據，請先創建一些分類。",
    };
  }
}

module.exports = {
  createCategoryListMessage,
};
