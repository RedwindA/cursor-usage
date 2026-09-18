"use strict";
(() => {
  // src/background/index.ts
  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id || !tab.url) return;
    let host = "";
    try {
      host = new URL(tab.url).hostname;
    } catch {
      return;
    }
    if (host !== "cursor.com" && host !== "www.cursor.com") return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
    } catch {
    }
  });
})();
//# sourceMappingURL=background.js.map
