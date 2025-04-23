/**
 * Prior Protocol 測試網機器人
 * 主入口文件
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { ethers } = require('ethers');
const chalk = require('chalk');

// 引入自定義模組
const Reporter = require('./reporter');
const RpcManager = require('./rpcManager');
const WalletLoader = require('./walletLoader');
const SwapEngine = require('./swapEngine');
const { 
  sleep, 
  getRandomInRange, 
  generateTransactionSequence, 
  mergeDeep,
  formatAddress
} = require('./utils');
const { TRANSACTION_TYPES } = require('./constants');

// 命令行參數解析
const program = new Command();
program
  .name('prior-bot')
  .description('Prior Protocol 測試網機器人')
  .version('1.0.0')
  .option('-c, --config <path>', '配置文件路徑', './config.json')
  .option('-w, --wallets <path>', '私鑰文件路徑')
  .option('-m, --max-concurrent <number>', '最大並行錢包數')
  .option('-d, --debug', '啟用調試日誌')
  .option('-o, --one-time', '僅運行一次，不循環')
  .parse(process.argv);

const options = program.opts();

// 異步主函數
async function main() {
  try {
    console.log(chalk.cyan('========================================='));
    console.log(chalk.cyan('   Prior Protocol 測試網機器人啟動中'));
    console.log(chalk.cyan('========================================='));
    
    // 加載配置
    const configPath = options.config || process.env.CONFIG_FILE || './config.json';
    
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red(`錯誤: 找不到配置文件 ${configPath}`));
      process.exit(1);
    }
    
    let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // 應用命令行選項覆蓋配置
    if (options.maxConcurrent) {
      config.wallets.maxConcurrent = parseInt(options.maxConcurrent);
    }
    
    if (options.debug) {
      config.logging.level = 'debug';
      config.logging.showDebugMessages = true;
    }
    
    if (options.oneTime) {
      config.wallets.runForever = false;
    }
    
    // 初始化報告器
    const reporter = new Reporter(config);
    reporter.info('機器人已啟動');
    reporter.info(`配置已加載: ${configPath}`);
    
    // 初始化 RPC 管理器
    reporter.info('初始化 RPC 管理器...');
    const rpcManager = new RpcManager(config, reporter);
    
    // 驗證網絡連接
    const network = await rpcManager.getNetwork();
    reporter.info(`連接到網絡: ${network.name} (ChainID: ${network.chainId})`);
    
    if (network.chainId !== config.network.chainId) {
      reporter.error(`網絡 ID 不匹配，預期 ${config.network.chainId}，獲得 ${network.chainId}`);
      process.exit(1);
    }
    
    // 初始化錢包加載器
    reporter.info('初始化錢包加載器...');
    const walletLoader = new WalletLoader(config, reporter);
    
    // 加載錢包
    const privateKeysPath = options.wallets || process.env.PRIVATE_KEYS_FILE || './wallets.txt';
    
    if (!fs.existsSync(privateKeysPath)) {
      reporter.error(`找不到私鑰文件: ${privateKeysPath}`);
      process.exit(1);
    }
    
    reporter.info(`從文件加載錢包: ${privateKeysPath}`);
    walletLoader.loadWallets(privateKeysPath);
    
    const wallets = walletLoader.getWallets();
    reporter.info(`成功加載 ${wallets.length} 個錢包`);
    
    // 初始化交換引擎
    reporter.info('初始化交換引擎...');
    const swapEngine = new SwapEngine(config, rpcManager, walletLoader, reporter);
    
    // 啟動主循環
    reporter.info('開始主循環...');
    await startMainLoop(config, reporter, walletLoader, swapEngine);
    
  } catch (error) {
    console.error(chalk.red(`啟動失敗: ${error.message}`));
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * 主循環
 * @param {Object} config - 配置對象
 * @param {Reporter} reporter - 報告器
 * @param {WalletLoader} walletLoader - 錢包加載器
 * @param {SwapEngine} swapEngine - 交換引擎
 */
async function startMainLoop(config, reporter, walletLoader, swapEngine) {
  const { wallets, delays } = config;
  
  reporter.info(`機器人已啟動，最大並行錢包數: ${wallets.maxConcurrent}`);
  
  // 創建錢包計數器
  let walletCounter = 0;
  
  // 主循環
  while (true) {
    try {
      // 獲取可用的錢包
      const availableWallets = walletLoader.getAvailableWallets();
      const runningWallets = walletLoader.getRunningWalletsCount();
      
      reporter.debug(`可用錢包: ${availableWallets.length}, 運行中錢包: ${runningWallets}`);
      
      // 添加更清晰的日誌訊息，顯示當前並行運行的錢包數量
      reporter.info(`當前並行錢包數: ${runningWallets}/${wallets.maxConcurrent}`);
      
      // 檢查當前運行的錢包數量是否已達到最大值
      if (runningWallets >= wallets.maxConcurrent) {
        reporter.debug(`已達到最大並行錢包數 ${wallets.maxConcurrent}，等待...`);
        await sleep(delays.walletCheckInterval);
        continue;
      }
      
      // 從可用錢包中選擇要運行的數量
      const walletsToRun = availableWallets.slice(0, wallets.maxConcurrent - runningWallets);
      
      if (walletsToRun.length === 0) {
        reporter.debug('沒有可用的錢包，等待...');
        await sleep(delays.walletCheckInterval);
        continue;
      }
      
      // 為每個錢包啟動任務
      for (const wallet of walletsToRun) {
        walletCounter++;
        const walletNumber = walletCounter;
        
        // 標記錢包為運行中
        walletLoader.markWalletAsRunning(wallet.address);
        
        // 啟動錢包任務
        runWalletTask(
          wallet,
          walletNumber,
          config,
          reporter,
          walletLoader,
          swapEngine
        );
        
        // 等待隨機時間後再啟動下一個錢包
        const betweenWalletsDelay = getRandomInRange(
          delays.betweenWallets.min,
          delays.betweenWallets.max
        );
        
        reporter.info(`等待 ${betweenWalletsDelay}ms 後啟動下一個錢包`);
        await sleep(betweenWalletsDelay);
      }
      
      // 檢查是否為一次性運行模式
      if (!wallets.runForever) {
        const stats = walletLoader.getWalletStats();
        
        // 如果所有錢包都完成了或正在運行，且沒有可用錢包，則結束循環
        if (stats.completed + stats.running >= stats.total && stats.available === 0) {
          reporter.info('所有錢包都已完成運行，退出主循環');
          break;
        }
      }
      
      // 等待一段時間後再次檢查
      await sleep(delays.walletCheckInterval);
    } catch (error) {
      reporter.error('主循環發生錯誤', error);
      await sleep(10000); // 發生錯誤時等待 10 秒再繼續
    }
  }
  
  reporter.info('機器人已停止');
}

/**
 * 運行單個錢包的任務
 * @param {ethers.Wallet} wallet - 以太坊錢包
 * @param {number} walletNumber - 錢包序號
 * @param {Object} config - 配置對象
 * @param {Reporter} reporter - 報告器
 * @param {WalletLoader} walletLoader - 錢包加載器
 * @param {SwapEngine} swapEngine - 交換引擎
 */
async function runWalletTask(wallet, walletNumber, config, reporter, walletLoader, swapEngine) {
  const walletAddress = wallet.address;
  const shortAddress = formatAddress(walletAddress);
  
  reporter.info(`開始處理錢包 #${walletNumber} (${shortAddress})`);
  
  try {
    // 初始化合約
    swapEngine.initializeContracts(wallet);
    
    // 生成交易序列
    const txSequence = generateTransactionSequence(config, { TRANSACTION_TYPES });
    
    // 執行交易序列
    const success = await swapEngine.executeTransactionSequence(txSequence);
    
    // 標記錢包為已完成
    walletLoader.markWalletAsCompleted(walletAddress, success);
    
    if (success) {
      reporter.info(`錢包 #${walletNumber} (${shortAddress}) 完成所有交易`);
      
      // 激活礦工 (如果啟用)
      if (config.api.mining.enabled) {
        await reporter.activateMiner(walletAddress);
      }
    } else {
      reporter.warn(`錢包 #${walletNumber} (${shortAddress}) 未能完成所有交易`);
    }
  } catch (error) {
    reporter.error(`錢包 #${walletNumber} (${shortAddress}) 處理失敗`, error);
    walletLoader.markWalletAsCompleted(walletAddress, false, error.message);
  }
}

// 啟動程序
main().catch(err => {
  console.error(chalk.red('致命錯誤:'), err);
  process.exit(1);
}); 