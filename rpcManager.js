/**
 * RPC 管理模組
 * 用於管理多個 RPC 端點
 */

const { ethers } = require('ethers');
const { sleep } = require('./utils');

class RpcManager {
  constructor(config, reporter) {
    this.config = config;
    this.reporter = reporter;
    this.providers = [];
    this.currentProviderIndex = 0;
    this.initializeProviders();
  }

  /**
   * 初始化所有 RPC 提供者
   */
  initializeProviders() {
    const { urls } = this.config.network.rpc;
    
    if (!urls || urls.length === 0) {
      throw new Error('未配置 RPC URL');
    }
    
    this.reporter.debug(`初始化 ${urls.length} 個 RPC 端點`);
    
    // 為每個 URL 創建提供者
    this.providers = urls.map(url => {
      return {
        url,
        provider: new ethers.providers.JsonRpcProvider(url),
        failCount: 0,
        lastError: null,
        lastUsed: 0,
        isCurrentlyTesting: false
      };
    });
    
    // 初始驗證所有提供者
    this.testAllProviders();
  }

  /**
   * 測試所有 RPC 提供者的連接
   */
  async testAllProviders() {
    this.reporter.debug('測試所有 RPC 提供者的連接');
    
    for (let i = 0; i < this.providers.length; i++) {
      await this.testProvider(i);
    }
    
    // 確保至少有一個有效的提供者
    const hasValidProvider = this.providers.some(p => p.failCount === 0);
    
    if (!hasValidProvider) {
      this.reporter.error('所有 RPC 提供者都不可用');
      throw new Error('所有 RPC 提供者都不可用，請檢查網絡連接或 RPC URL');
    }
    
    // 選擇可用的提供者作為當前提供者
    this.currentProviderIndex = this.providers.findIndex(p => p.failCount === 0);
    this.reporter.info(`選擇 ${this.providers[this.currentProviderIndex].url} 作為當前 RPC 提供者`);
  }

  /**
   * 測試單個 RPC 提供者
   * @param {number} index - 提供者索引
   * @returns {Promise<boolean>} - 測試是否成功
   */
  async testProvider(index) {
    const provider = this.providers[index];
    
    if (provider.isCurrentlyTesting) {
      return false;
    }
    
    provider.isCurrentlyTesting = true;
    
    try {
      this.reporter.debug(`測試 RPC 提供者: ${provider.url}`);
      
      // 獲取網絡和區塊信息來驗證提供者
      const network = await provider.provider.getNetwork();
      
      // 驗證是否是正確的網絡
      if (network.chainId !== this.config.network.chainId) {
        throw new Error(`網絡 ID 不匹配，預期 ${this.config.network.chainId}，獲得 ${network.chainId}`);
      }
      
      const blockNumber = await provider.provider.getBlockNumber();
      this.reporter.debug(`RPC ${provider.url} 測試成功，當前區塊: ${blockNumber}`);
      
      // 重置失敗計數
      provider.failCount = 0;
      provider.lastError = null;
      provider.isCurrentlyTesting = false;
      return true;
    } catch (error) {
      provider.failCount++;
      provider.lastError = error.message;
      this.reporter.warn(`RPC ${provider.url} 測試失敗: ${error.message}`);
      provider.isCurrentlyTesting = false;
      return false;
    }
  }

  /**
   * 獲取當前活動的提供者
   * @returns {ethers.providers.JsonRpcProvider} - 當前提供者
   */
  getCurrentProvider() {
    return this.providers[this.currentProviderIndex].provider;
  }

  /**
   * 切換到下一個提供者
   * @returns {ethers.providers.JsonRpcProvider} - 新的當前提供者
   */
  switchToNextProvider() {
    const oldIndex = this.currentProviderIndex;
    let attempts = 0;
    
    // 嘗試找到一個未失敗的提供者
    while (attempts < this.providers.length) {
      this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
      
      if (this.providers[this.currentProviderIndex].failCount === 0) {
        break;
      }
      
      attempts++;
    }
    
    const newProvider = this.providers[this.currentProviderIndex];
    
    if (oldIndex !== this.currentProviderIndex) {
      this.reporter.info(`切換 RPC 提供者: ${this.providers[oldIndex].url} -> ${newProvider.url}`);
    }
    
    return newProvider.provider;
  }

  /**
   * 標記當前提供者為失敗
   * @param {string} errorMessage - 錯誤消息
   * @returns {ethers.providers.JsonRpcProvider} - 新的提供者或 null
   */
  markCurrentProviderAsFailed(errorMessage) {
    const provider = this.providers[this.currentProviderIndex];
    
    provider.failCount++;
    provider.lastError = errorMessage;
    
    this.reporter.warn(`RPC 提供者 ${provider.url} 失敗: ${errorMessage}`);
    
    // 如果所有提供者都失敗了
    if (this.providers.every(p => p.failCount > 0)) {
      this.reporter.error('所有 RPC 提供者都已失敗');
      // 重置所有提供者的失敗計數，給他們一個新機會
      this.providers.forEach(p => p.failCount = Math.max(0, p.failCount - 1));
    }
    
    return this.switchToNextProvider();
  }

  /**
   * 獲取提供者並連接錢包
   * @param {ethers.Wallet} wallet - 以太坊錢包
   * @returns {ethers.Wallet} - 連接提供者的錢包
   */
  connectWallet(wallet) {
    return wallet.connect(this.getCurrentProvider());
  }

  /**
   * 使用當前提供者創建合約實例
   * @param {string} address - 合約地址
   * @param {Array} abi - 合約 ABI
   * @param {ethers.Wallet} wallet - 以太坊錢包
   * @returns {ethers.Contract} - 合約實例
   */
  createContract(address, abi, wallet) {
    return new ethers.Contract(
      address,
      abi,
      wallet.connect(this.getCurrentProvider())
    );
  }

  /**
   * 包裝 Provider 調用以處理錯誤和重試
   * @param {Function} action - 包含 Provider 調用的函數
   * @param {Object} options - 選項
   * @returns {Promise<any>} - 操作結果
   */
  async withProvider(action, options = {}) {
    const {
      maxRetries = this.config.network.rpc.maxRetries,
      retryDelay = this.config.network.rpc.retryDelay,
      timeoutMs = this.config.network.rpc.timeoutMs
    } = options;
    
    let retries = 0;
    let lastError = null;
    
    while (retries <= maxRetries) {
      try {
        // 創建超時 Promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('RPC 請求超時')), timeoutMs);
        });
        
        // 執行操作並應用超時
        const result = await Promise.race([action(), timeoutPromise]);
        return result;
      } catch (error) {
        lastError = error;
        retries++;
        
        this.reporter.debug(`RPC 操作失敗，重試 ${retries}/${maxRetries}: ${error.message}`);
        
        // 如果包含特定的錯誤模式，切換提供者
        if (
          error.message.includes('timeout') ||
          error.message.includes('server error') ||
          error.message.includes('network error') ||
          error.message.includes('connection refused')
        ) {
          this.markCurrentProviderAsFailed(error.message);
        }
        
        if (retries <= maxRetries) {
          await sleep(retryDelay);
        }
      }
    }
    
    throw lastError || new Error('RPC 操作失敗，達到最大重試次數');
  }

  /**
   * 獲取網絡信息
   * @returns {Promise<Object>} - 網絡信息
   */
  async getNetwork() {
    return this.withProvider(() => this.getCurrentProvider().getNetwork());
  }

  /**
   * 獲取當前區塊號
   * @returns {Promise<number>} - 區塊號
   */
  async getBlockNumber() {
    return this.withProvider(() => this.getCurrentProvider().getBlockNumber());
  }

  /**
   * 獲取 Gas 價格
   * @returns {Promise<ethers.BigNumber>} - Gas 價格
   */
  async getGasPrice() {
    return this.withProvider(() => this.getCurrentProvider().getGasPrice());
  }

  /**
   * 獲取 ETH 餘額
   * @param {string} address - 地址
   * @returns {Promise<ethers.BigNumber>} - ETH 餘額
   */
  async getBalance(address) {
    return this.withProvider(() => this.getCurrentProvider().getBalance(address));
  }
}

module.exports = RpcManager; 