/**
 * 工具函數模組
 * 包含各種實用功能
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const chalk = require('chalk');
const moment = require('moment');
const _ = require('lodash');
const axios = require('axios');

/**
 * 從文件讀取錢包私鑰
 * @param {string} filePath - 私鑰文件路徑
 * @returns {string[]} - 私鑰數組
 */
function loadPrivateKeys(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`找不到私鑰文件: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    // 過濾註釋行和空行，並確保私鑰有 0x 前綴
    // 注意：可以處理有或沒有 0x 前綴的私鑰
    const privateKeys = lines
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(key => key.startsWith('0x') ? key : `0x${key}`);
    
    if (!privateKeys.length) {
      throw new Error('私鑰文件中沒有有效的私鑰');
    }
    
    return privateKeys;
  } catch (error) {
    throw new Error(`無法加載私鑰: ${error.message}`);
  }
}

/**
 * 生成兩個數字之間的隨機整數
 * @param {number} min - 最小值（包含）
 * @param {number} max - 最大值（包含）
 * @returns {number} - 隨機整數
 */
function getRandomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 等待指定的毫秒數
 * @param {number} ms - 等待的毫秒數
 * @returns {Promise<void>} - Promise
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 格式化代幣金額
 * @param {ethers.BigNumber} amount - 代幣金額
 * @param {number} decimals - 代幣小數位數
 * @returns {string} - 格式化後的金額
 */
function formatTokenAmount(amount, decimals = 18) {
  return ethers.utils.formatUnits(amount, decimals);
}

/**
 * 格式化地址，顯示首尾幾個字符
 * @param {string} address - 地址
 * @param {number} prefixLength - 前綴長度
 * @param {number} suffixLength - 後綴長度
 * @returns {string} - 格式化後的地址
 */
function formatAddress(address, prefixLength = 6, suffixLength = 4) {
  if (!address) return '';
  if (address.length <= prefixLength + suffixLength) return address;
  
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}

/**
 * 格式化時間戳為人類可讀格式
 * @param {number} timestamp - 時間戳（毫秒）
 * @returns {string} - 格式化的時間
 */
function formatTimestamp(timestamp) {
  return moment(timestamp).format('YYYY-MM-DD HH:mm:ss');
}

/**
 * 生成交易序列
 * @param {Object} config - 配置對象
 * @param {Object} constants - 常量對象
 * @returns {string[]} - 交易類型序列
 */
function generateTransactionSequence(config, constants) {
  const { TRANSACTION_TYPES } = constants;
  const { transactions } = config;
  
  // 基本交易類型
  const transactionTypes = [
    TRANSACTION_TYPES.SWAP_PRIOR_TO_USDC,
    TRANSACTION_TYPES.SWAP_USDC_TO_PRIOR
  ];
  
  // 生成隨機序列
  const count = getRandomInRange(
    transactions.minTransactionsPerWallet,
    transactions.maxTransactionsPerWallet
  );
  
  let sequence = [];
  
  // 如果配置要求始終以 PRIOR_TO_USDC 開始
  if (transactions.patterns.alwaysStartWithPriorToUsdc) {
    sequence.push(TRANSACTION_TYPES.SWAP_PRIOR_TO_USDC);
  }
  
  // 填充剩餘的交易
  while (sequence.length < count) {
    // 避免連續相同的交易類型
    const lastType = sequence[sequence.length - 1];
    const availableTypes = transactionTypes.filter(type => type !== lastType);
    
    const randomType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
    sequence.push(randomType);
  }
  
  return sequence;
}

/**
 * 深度合併對象
 * @param {Object} target - 目標對象
 * @param {Object} source - 源對象
 * @returns {Object} - 合併後的對象
 */
function mergeDeep(target, source) {
  return _.merge({}, target, source);
}

/**
 * 確保目錄存在
 * @param {string} dirPath - 目錄路徑
 */
function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 格式化 Gas 費用
 * @param {ethers.BigNumber} value - Gas 費用
 * @returns {string} - 格式化後的 Gas 費用
 */
function formatGasPrice(value) {
  return `${ethers.utils.formatUnits(value, 'gwei')} Gwei`;
}

/**
 * 創建 axios 實例，支持代理
 * @param {string|null} proxy - 代理配置
 * @param {string|null} referer - 請求的 referer
 * @returns {import('axios').AxiosInstance} - axios 實例
 */
function createAxios(proxy = null, referer = null) {
  const axiosConfig = {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    },
    timeout: 15000
  };
  
  if (referer) {
    axiosConfig.headers.Referer = referer;
  }
  
  if (proxy) {
    const [host, port] = proxy.split(':');
    axiosConfig.proxy = {
      host,
      port: parseInt(port)
    };
  }
  
  return axios.create(axiosConfig);
}

module.exports = {
  loadPrivateKeys,
  getRandomInRange,
  sleep,
  formatTokenAmount,
  formatAddress,
  formatTimestamp,
  generateTransactionSequence,
  mergeDeep,
  ensureDirExists,
  formatGasPrice,
  createAxios
}; 