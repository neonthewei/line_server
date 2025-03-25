const { ADMIN_SETTINGS } = require("../config");
const { forwardMessageToTarget } = require("../services/lineService");

// 管理員 Push 模式開關
let adminPushModeEnabled = false;

/**
 * 切換管理員 Push 模式
 * @param {boolean} enabled - 是否啟用 Push 模式
 * @returns {boolean} - 當前 Push 模式狀態
 */
function toggleAdminPushMode(enabled) {
  adminPushModeEnabled = enabled;
  console.log(`管理員 Push 模式已${enabled ? "開啟" : "關閉"}`);
  return adminPushModeEnabled;
}

/**
 * 處理管理員命令
 * @param {string} userMessage - 用戶消息
 * @param {string} userId - 用戶ID
 * @returns {Object|null} - 回應對象，如果不是管理員命令則返回null
 */
async function handleAdminCommand(userMessage, userId) {
  // 檢查是否為管理員
  if (userId !== process.env.ADMIN_USER_ID) {
    return null;
  }

  // 處理管理員命令
  if (userMessage === "開啟Push模式") {
    toggleAdminPushMode(true);
    return {
      type: "text",
      text: "已開啟 Push 模式。您發送的所有消息將被轉發給目標用戶。",
    };
  } else if (userMessage === "關閉Push模式") {
    toggleAdminPushMode(false);
    return {
      type: "text",
      text: "已關閉 Push 模式。",
    };
  } else if (userMessage === "Push狀態") {
    return {
      type: "text",
      text: `Push 模式目前${adminPushModeEnabled ? "已開啟" : "已關閉"}`,
    };
  } else if (adminPushModeEnabled) {
    // 如果 Push 模式開啟，轉發消息給目標用戶
    try {
      await forwardMessageToTarget(userMessage, ADMIN_SETTINGS.TARGET_USER_ID);
      return {
        type: "text",
        text: `已成功轉發消息給目標用戶。`,
      };
    } catch (error) {
      return {
        type: "text",
        text: "消息轉發失敗，請稍後再試。",
      };
    }
  }

  // 不是管理員命令
  return null;
}

module.exports = {
  toggleAdminPushMode,
  handleAdminCommand,
  isAdminPushMode: () => adminPushModeEnabled,
};
