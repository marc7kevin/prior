/**
 * 錢包加載模組
 * 用於從文件中加載並管理錢包
 */

const { ethers } = require('ethers');
const { loadPrivateKeys, formatAddress, getRandomInRange } = require('./utils');

class WalletLoader {
  constructor(config, reporter) {
    this.config = config;
    this.reporter = reporter;
    this.wallets = [];
    this.walletStates = new Map();
  }

  /**
   * 從文件加載錢包
   * @param {string} privateKeysPath - 私鑰文件路徑
   */
  loadWallets(privateKeysPath) {
    try {
      const privateKeys = loadPrivateKeys(privateKeysPath);
      this.reporter.info(`從文件中加載了 ${privateKeys.length} 個錢包`);
      
      this.wallets = privateKeys.map(privateKey => {
        const wallet = new ethers.Wallet(privateKey);
        this.initializeWalletState(wallet.address);
        return wallet;
      });
      
      if (this.config.wallets.randomizeOrder) {
        this.shuffleWallets();
      }
      
      return this.wallets;
    } catch (error) {
      this.reporter.error('加載錢包失敗', error);
      throw error;
    }
  }

  /**
   * 初始化錢包狀態
   * @param {string} address - 錢包地址
   */
  initializeWalletState(address) {
    this.walletStates.set(address, {
      isRunning: false,
      lastRunTime: 0,
      nextRunTime: Date.now(),
      transactionsCompleted: 0,
      errors: 0,
      lastError: null,
      status: 'ready',
      balances: {
        eth: null,
        prior: null,
        usdc: null
      },
      approvals: {
        prior: false,
        usdc: false
      }
    });
  }

  /**
   * 打亂錢包順序
   */
  shuffleWallets() {
    for (let i = this.wallets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.wallets[i], this.wallets[j]] = [this.wallets[j], this.wallets[i]];
    }
    this.reporter.debug('已隨機打亂錢包順序');
  }

  /**
   * 獲取所有錢包
   * @returns {ethers.Wallet[]} - 所有錢包
   */
  getWallets() {
    return this.wallets;
  }

  /**
   * 獲取可用的錢包（未運行的）
   * @returns {ethers.Wallet[]} - 可用的錢包
   */
  getAvailableWallets() {
    return this.wallets.filter(wallet => {
      const state = this.getWalletState(wallet.address);
      return !state.isRunning && Date.now() >= state.nextRunTime;
    });
  }

  /**
   * 獲取當前運行的錢包數量
   * @returns {number} - 運行中的錢包數量
   */
  getRunningWalletsCount() {
    return Array.from(this.walletStates.values()).filter(state => state.isRunning).length;
  }

  /**
   * 獲取錢包狀態
   * @param {string} address - 錢包地址
   * @returns {Object} - 錢包狀態
   */
  getWalletState(address) {
    if (!this.walletStates.has(address)) {
      this.initializeWalletState(address);
    }
    return this.walletStates.get(address);
  }

  /**
   * 更新錢包狀態
   * @param {string} address - 錢包地址
   * @param {Object} updates - 狀態更新
   */
  updateWalletState(address, updates) {
    const currentState = this.getWalletState(address);
    const newState = { ...currentState, ...updates };
    this.walletStates.set(address, newState);
  }

  /**
   * 標記錢包為運行中
   * @param {string} address - 錢包地址
   */
  markWalletAsRunning(address) {
    this.updateWalletState(address, {
      isRunning: true,
      lastRunTime: Date.now(),
      status: 'running'
    });
    this.reporter.debug(`標記錢包 ${formatAddress(address)} 為運行中`);
  }

  /**
   * 標記錢包為已完成
   * @param {string} address - 錢包地址
   * @param {boolean} success - 是否成功完成
   * @param {string} errorMessage - 錯誤消息（如果失敗）
   */
  markWalletAsCompleted(address, success = true, errorMessage = null) {
    const { transactionsCompleted } = this.getWalletState(address);
    
    // 計算下次運行時間
    const { delays, wallets } = this.config;
    let nextRunDelay;
    
    if (success) {
      nextRunDelay = getRandomInRange(delays.betweenRounds.min, delays.betweenRounds.max);
    } else {
      // 如果失敗，較短時間後重試
      nextRunDelay = getRandomInRange(60000, 120000);
    }
    
    const updates = {
      isRunning: false,
      transactionsCompleted: success ? transactionsCompleted + 1 : transactionsCompleted,
      nextRunTime: Date.now() + nextRunDelay,
      status: success ? 'completed' : 'failed'
    };
    
    if (!success) {
      updates.errors = this.getWalletState(address).errors + 1;
      updates.lastError = errorMessage;
    }
    
    this.updateWalletState(address, updates);
    
    // 如果錢包不是永久運行，並且已完成配置的交易次數，則停用它
    if (!wallets.runForever && updates.transactionsCompleted >= wallets.maxTransactions) {
      this.updateWalletState(address, {
        status: 'retired',
        nextRunTime: Number.MAX_SAFE_INTEGER
      });
    }
    
    this.reporter.debug(`標記錢包 ${formatAddress(address)} 為已完成，狀態: ${updates.status}`);
  }

  /**
   * 更新錢包餘額信息
   * @param {string} address - 錢包地址
   * @param {Object} balances - 餘額對象
   */
  updateWalletBalances(address, balances) {
    const state = this.getWalletState(address);
    this.updateWalletState(address, {
      balances: { ...state.balances, ...balances }
    });
  }

  /**
   * 更新錢包授權狀態
   * @param {string} address - 錢包地址
   * @param {string} token - 代幣類型 ('prior' 或 'usdc')
   * @param {boolean} isApproved - 是否已授權
   */
  updateWalletApproval(address, token, isApproved) {
    const state = this.getWalletState(address);
    const approvals = { ...state.approvals };
    approvals[token] = isApproved;
    
    this.updateWalletState(address, { approvals });
  }

  /**
   * 獲取錢包統計信息
   * @returns {Object} - 統計信息
   */
  getWalletStats() {
    const total = this.wallets.length;
    const running = this.getRunningWalletsCount();
    const available = this.getAvailableWallets().length;
    const completed = Array.from(this.walletStates.values())
      .filter(state => state.transactionsCompleted > 0)
      .length;
    
    return {
      total,
      running,
      available,
      completed,
      waiting: total - running - available
    };
  }
}

module.exports = WalletLoader; 