# ChatGPT历史记录导出器 (ChatGPT Universal Exporter Enhanced)

**说明**：  
这是一个适用于 **ChatGPT 网页版（https://chat.openai.com 与 https://chatgpt.com）** 的用户脚本，  
可以一键导出你的所有聊天记录（支持 JSON / Markdown / HTML 格式），并自动打包为 ZIP 文件下载。

---

## 🚀 功能简介

- ✅ 支持导出 **全部聊天记录**（包括归档的旧对话）  
- ✅ 导出格式：JSON、Markdown、HTML  
- ✅ 自动打包成 ZIP 文件  
- ✅ 支持 **团队空间（Team Workspace）**  
- ✅ 断点重试、防止请求失败  
- ✅ 优雅美观的导出界面

---

## 🧩 安装方法

### 1. 安装 Tampermonkey（油猴插件）
根据浏览器选择安装：
- Chrome / Edge：[https://tampermonkey.net/?ext=dhdg&browser=chrome](https://tampermonkey.net/?ext=dhdg&browser=chrome)
- Firefox：[https://tampermonkey.net/?ext=dhdg&browser=firefox](https://tampermonkey.net/?ext=dhdg&browser=firefox)

安装后，浏览器右上角会出现一个黑底白点 🐒 图标。

### 2. 安装脚本
1. 打开此仓库中的 [`ChatGPT-历史记录导出器.user.js`](./userscript/ChatGPT-历史记录导出器.user.js)  
2. 点击「Raw」或「原始文件」按钮  
3. Tampermonkey 会自动弹出安装提示 → 点击「安装」即可。

---

## 💬 使用方法

1. 登录 ChatGPT 网站：[https://chat.openai.com](https://chat.openai.com) 或 [https://chatgpt.com](https://chatgpt.com)  
2. 等待页面加载后，右下角会出现绿色按钮：**「Export Conversations」**  
3. 点击它，选择要导出的格式（JSON / Markdown / HTML）  
4. 选择导出类型：  
   - 「个人空间」适用于普通账户  
   - 「团队空间」适用于 ChatGPT Team / Enterprise 账户  
5. 点击「开始导出」即可。脚本会自动导出并下载一个 `.zip` 文件。

---

## 📦 导出文件结构示例

