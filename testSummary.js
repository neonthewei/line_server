const { createSummaryMessage } = require("./utils/flexMessage");

// Simulate transaction data with both income and expense categories
function testIncomeAnalysis() {
  console.log("=== Testing Income Analysis ===");

  // Create test data for income analysis summary
  const incomeAnalysisData = {
    title: "月收入總結",
    income: "$ 15,000",
    expense: "$ 9,000",
    balance: "$ 6,000",
    analysisTitle: "月收入分析",
    analysisItems: [
      { category: "薪資", amount: "$ 12,000", percentage: "80%" },
      { category: "獎金", amount: "$ 2,000", percentage: "13%" },
      { category: "兼職", amount: "$ 800", percentage: "5%" },
      { category: "其他", amount: "$ 200", percentage: "2%" },
    ],
  };

  // Create a flex message
  const incomeSummary = createSummaryMessage(incomeAnalysisData);
  console.log("Income Summary Analysis successful");

  // 測試無數據情況
  console.log("=== Testing No Data ===");
  const noDataSummary = createSummaryMessage({});
  console.log("No Data Summary created");

  // 測試部分數據情況
  console.log("=== Testing Partial Data ===");
  const partialDataSummary = createSummaryMessage({
    title: "日結餘",
    income: "$ 500",
  });
  console.log("Partial Data Summary created");

  // Verify some basic structure
  if (
    incomeSummary &&
    incomeSummary.body &&
    incomeSummary.body.contents &&
    incomeSummary.body.contents.length >= 4
  ) {
    console.log("✅ Summary structure looks good");

    // Check if chart exists with categories
    const analysisContainer = incomeSummary.body.contents[3];
    if (
      analysisContainer &&
      analysisContainer.contents &&
      analysisContainer.contents.length > 0
    ) {
      console.log("✅ Analysis chart container exists");

      // Check if analysis title is correct
      try {
        const analysisTitle = incomeSummary.body.contents[2].contents[0].text;
        console.log(`Analysis title: ${analysisTitle}`);
      } catch (error) {
        console.log("❌ Could not verify analysis title");
      }
    } else {
      console.log("❌ Analysis chart container is missing or empty");
    }
  } else {
    console.log("❌ Summary structure is incorrect");
  }
}

// Test expense analysis as well for comparison
function testExpenseAnalysis() {
  console.log("\n=== Testing Expense Analysis ===");

  // Create test data for expense analysis summary
  const expenseAnalysisData = {
    title: "月支出總結",
    income: "$ 15,000",
    expense: "$ 9,000",
    balance: "$ 6,000",
    analysisTitle: "月支出分析",
    analysisItems: [
      { category: "住房", amount: "$ 3,500", percentage: "39%" },
      { category: "餐飲", amount: "$ 2,500", percentage: "28%" },
      { category: "交通", amount: "$ 1,200", percentage: "13%" },
      { category: "購物", amount: "$ 1,000", percentage: "11%" },
      { category: "其他", amount: "$ 800", percentage: "9%" },
    ],
  };

  // Create a flex message
  const expenseSummary = createSummaryMessage(expenseAnalysisData);
  console.log("Expense Summary Analysis successful");

  // Verify some basic structure
  if (
    expenseSummary &&
    expenseSummary.body &&
    expenseSummary.body.contents &&
    expenseSummary.body.contents.length >= 4
  ) {
    console.log("✅ Summary structure looks good");

    // Check if chart exists with categories
    const analysisContainer = expenseSummary.body.contents[3];
    if (
      analysisContainer &&
      analysisContainer.contents &&
      analysisContainer.contents.length > 0
    ) {
      console.log("✅ Analysis chart container exists");

      // Check if analysis title is correct
      try {
        const analysisTitle = expenseSummary.body.contents[2].contents[0].text;
        console.log(`Analysis title: ${analysisTitle}`);
      } catch (error) {
        console.log("❌ Could not verify analysis title");
      }
    } else {
      console.log("❌ Analysis chart container is missing or empty");
    }
  } else {
    console.log("❌ Summary structure is incorrect");
  }
}

// Run the tests
testIncomeAnalysis();
testExpenseAnalysis();
