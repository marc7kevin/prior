/**
 * 報告模組
 * 用於記錄和上報交易數據
 */

const winston = require('winston');
const { createLogger, format, transports } = winston;
const { combine, timestamp, printf, colorize } = format;
require('winston-daily-rotate-file');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { formatAddress, formatTimestamp, ensureDirExists, createAxios } = require('./utils');

class Reporter {
  constructor(config) {
    this.config = config;
    this.setupLogger();
  }

  /**
   * 設置 Winston 日誌記錄器
   */
  setupLogger() {
    const { logging } = this.config;
    
    // 確保日誌目錄存在
    if (logging.logToFile) {
      const logDir = path.dirname(logging.logFilePath);
      ensureDirExists(logDir);
    }
    
    // 定義日誌格式
    const logFormat = printf(({ level, message, timestamp }) => {
      return `[${timestamp}] ${level}: ${message}`;
    });
    
    // 配置 Winston
    const loggerOptions = {
      level: logging.level || 'info',
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      ),
      transports: [
        new transports.Console({
          format: logging.colorize ? combine(colorize(), logFormat) : logFormat
        })
      ]
    };
    
    // 添加文件輸出
    if (logging.logToFile) {
      loggerOptions.transports.push(
        new transports.DailyRotateFile({
          filename: logging.logFilePath,
          datePattern: 'YYYY-MM-DD',
          maxSize: logging.maxLogFileSize || '10m',
          maxFiles: logging.maxLogFiles || 5,
          format: combine(timestamp(), logFormat)
        })
      );
    }
    
    this.logger = createLogger(loggerOptions);
  }

  /**
   * 記錄日誌消息
   * @param {string} level - 日誌級別
   * @param {string} message - 消息內容
   * @param {Object} meta - 元數據
   */
  log(level, message, meta = {}) {
    if (meta && Object.keys(meta).length > 0) {
      this.logger.log(level, `${message} ${JSON.stringify(meta)}`);
    } else {
      this.logger.log(level, message);
    }
  }

  /**
   * 記錄錯誤
   * @param {string} message - 錯誤消息
   * @param {Error} error - 錯誤對象
   * @param {Object} meta - 元數據
   */
  error(message, error, meta = {}) {
    const errorObj = {
      message: error?.message || 'Unknown error',
      stack: error?.stack,
      ...meta
    };
    
    this.logger.error(`${message}: ${errorObj.message}`, errorObj);
  }

  /**
   * 記錄信息級別日誌
   * @param {string} message - 消息內容
   * @param {Object} meta - 元數據
   */
  info(message, meta = {}) {
    this.log('info', message, meta);
  }

  /**
   * 記錄警告級別日誌
   * @param {string} message - 消息內容
   * @param {Object} meta - 元數據
   */
  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  /**
   * 記錄調試級別日誌
   * @param {string} message - 消息內容
   * @param {Object} meta - 元數據
   */
  debug(message, meta = {}) {
    if (this.config.logging.showDebugMessages) {
      this.log('debug', message, meta);
    }
  }

  /**
   * 記錄錢包活動
   * @param {string} address - 錢包地址
   * @param {string} action - 活動類型
   * @param {Object} data - 活動數據
   */
  logWalletActivity(address, action, data = {}) {
    const formattedAddress = formatAddress(address);
    this.info(`Wallet ${formattedAddress} ${action}`, data);
  }

  /**
   * 記錄交易
   * @param {string} walletAddress - 錢包地址
   * @param {string} type - 交易類型
   * @param {string} hash - 交易哈希
   * @param {Object} details - 交易詳情
   */
  async logTransaction(walletAddress, type, hash, details = {}) {
    const formattedAddress = formatAddress(walletAddress);
    const formattedHash = formatAddress(hash, 10, 6);
    
    this.info(`Transaction ${type} (${formattedHash}) by ${formattedAddress}`, details);
    
    // 上報交易數據到 API
    await this.reportTransactionToApi(walletAddress, type, hash, details);
  }

  /**
   * 向 API 上報交易數據
   * @param {string} walletAddress - 錢包地址
   * @param {string} type - 交易類型
   * @param {string} hash - 交易哈希
   * @param {Object} details - 交易詳情
   */
  async reportTransactionToApi(walletAddress, type, hash, details = {}) {
    const { api, proxy } = this.config;
    
    if (!api?.reporting?.enabled) return;
    
    try {
      // 根據交易類型設置不同的 payload
      let payload;
      
      // 獲取代理配置
      const proxyConfig = proxy?.enabled && proxy?.file ? 
        fs.readFileSync(proxy.file, 'utf8').split('\n')[Math.floor(Math.random() * fs.readFileSync(proxy.file, 'utf8').split('\n').length)] : 
        null;
      
      if (type === 'SWAP_PRIOR_TO_USDC' || type === 'SWAP_USDC_TO_PRIOR') {
        // 交換交易的 payload
        const fromToken = type === 'SWAP_PRIOR_TO_USDC' ? 'PRIOR' : 'USDC';
        const toToken = type === 'SWAP_PRIOR_TO_USDC' ? 'USDC' : 'PRIOR';
        
        payload = {
          userId: walletAddress.toLowerCase(),
          type: "swap",
          txHash: hash,
          fromToken,
          toToken,
          fromAmount: "0.1",
          toAmount: "0.2",
          status: "completed",
          blockNumber: details.blockNumber
        };
      } else {
        // 其他類型交易的 payload
        payload = {
          wallet: walletAddress,
          type,
          hash,
          chainId: this.config.network.chainId,
          timestamp: Date.now(),
          ...details
        };
      }
      
      // 創建 axios 實例
      const axiosInstance = createAxios(proxyConfig);
      
      // 發送數據到 API
      const response = await axiosInstance.post(
        api.reporting.endpointUrl,
        payload
      );
      
      if (response.status === 200 || response.status === 201) {
        this.debug(`Transaction ${type} reported to API successfully`, { txHash: hash });
      } else {
        this.warn(`Failed to report transaction ${type}, status: ${response.status}`, { txHash: hash });
      }
    } catch (error) {
      this.warn(`API reporting error: ${error.message}`, { txHash: hash });
    }
  }

  /**
   * 激活礦工模式
   * @param {string} walletAddress - 錢包地址
   * @returns {Promise<boolean>} - 是否成功
   */
  async activateMiner(walletAddress) {
    const { api, proxy } = this.config;
    
    if (!api?.mining?.enabled) return false;
    
    try {
      // 獲取代理配置
      const proxyConfig = proxy?.enabled && proxy?.file ? 
        fs.readFileSync(proxy.file, 'utf8').split('\n')[Math.floor(Math.random() * fs.readFileSync(proxy.file, 'utf8').split('\n').length)] : 
        null;
      
      // 創建 axios 實例，添加 referer
      const axiosInstance = createAxios(proxyConfig, 'https://priornftstake.xyz/');
      
      // 發送激活請求
      const response = await axiosInstance.post(
        api.mining.activationUrl,
        {
          walletAddress: walletAddress.toLowerCase(),
          hasNFT: true
        }
      );
      
      if (response.status === 200 || response.status === 201) {
        this.info(`Miner activated for wallet ${formatAddress(walletAddress)}`);
        return true;
      } else {
        this.warn(`Failed to activate miner, status: ${response.status}`);
        return false;
      }
    } catch (error) {
      this.warn(`Miner activation error: ${error.message}`);
      return false;
    }
  }
}

module.exports = Reporter; 