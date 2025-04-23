# Prior Protocol 測試網機器人

自動化機器人用於在 Prior Protocol 測試網（Base Sepolia）上進行各種交互操作，包括從水龍頭獲取代幣、進行代幣交換和其他活動。

## 功能特點

- 支持多錢包並行操作
- 智能管理交易序列
- 自動處理 Prior 和 USDC 代幣交換
- 完整的錯誤處理和重試機制
- 詳細的日誌記錄
- 可配置的延遲和 Gas 費用
- 支持多個 RPC 端點和自動切換
- 支持 API 報告和挖礦激活

## 安裝

1. 安裝 Node.js (建議 v16 或更高版本)
2. 克隆此儲存庫
3. 安裝依賴:

```bash
npm install
```

## 配置

1. 複製 `.env.example` 檔案並重命名為 `.env`
2. 在 `.env` 檔案中設置適當的環境變數
3. 創建一個包含私鑰的檔案 (參照 `wallets.example.txt`)，每行一個私鑰，並將其命名為 `wallets.txt`
4. 根據需要調整 `config.json` 中的參數

## 使用方法

### 基本用法

```bash
node main.js
```

### 命令行選項

```bash
# 使用自定義配置文件
node main.js -c ./custom-config.json

# 使用自定義錢包文件
node main.js -w ./my-wallets.txt

# 設置最大並行錢包數
node main.js -m 5

# 啟用調試日誌
node main.js -d

# 僅運行一次，不循環
node main.js -o

# 查看所有選項
node main.js --help
```

## 配置說明

### 網絡配置

- `network.chainId`: Base Sepolia 測試網的鏈 ID (84532)
- `network.rpc.urls`: 可用的 RPC 端點列表
- `network.rpc.timeoutMs`: RPC 請求超時時間
- `network.rpc.retryDelay`: 重試延遲時間
- `network.rpc.maxRetries`: 最大重試次數

### 合約地址

- `contracts.priorToken`: Prior 代幣合約地址
- `contracts.usdcToken`: USDC 代幣合約地址
- `contracts.swapRouter`: 交換路由合約地址
- `contracts.faucet`: 水龍頭合約地址

### Gas 設置

為每種交易類型（水龍頭、授權、交換）配置 Gas 限制和費用。

### 延遲設置

配置各種操作之間的延遲時間：

- 錢包之間的延遲
- 交易之間的延遲
- 水龍頭請求後的延遲
- 輪次之間的延遲

### 錢包設置

- `wallets.maxConcurrent`: 最大並行錢包數
- `wallets.runForever`: 是否永久運行
- `wallets.randomizeOrder`: 是否隨機打亂錢包順序
- `wallets.requireFaucet`: 如果 PRIOR 餘額為 0，是否自動請求水龍頭

## 日誌記錄

日誌檔案將保存在 `./logs` 目錄中（可在配置中調整）。

## 安全提示

- 請勿將含有真實資金的私鑰用於此機器人
- 僅在測試網上使用
- 永遠不要將您的私鑰提交到 Git 儲存庫
- 使用 `.gitignore` 排除敏感檔案 (如 `.env` 和 `wallets.txt`)

## 支持的交易類型

- 從水龍頭獲取 PRIOR 代幣
- 授權 PRIOR 或 USDC 代幣
- PRIOR -> USDC 交換
- USDC -> PRIOR 交換

## 故障排除

- 如果遇到網絡問題，機器人會自動切換到下一個可用的 RPC 端點
- 如果交易失敗（例如因為 Gas 價格過低），機器人將嘗試增加 Gas 費用並重試
- 查看日誌文件以獲取詳細的錯誤信息

## 許可證

ISC 