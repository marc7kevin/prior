/**
 * 交換引擎模組
 * 用於處理代幣交換和水龍頭操作
 */

const { ethers } = require('ethers');
const { getRandomInRange, sleep, formatTokenAmount } = require('./utils');
const { 
  TOKEN_ABI, 
  FAUCET_ABI, 
  SWAP_ROUTER_ABI,
  TRANSACTION_TYPES,
  SWAP_DATA,
  ERROR_MESSAGES 
} = require('./constants');

class SwapEngine {
  constructor(config, rpcManager, walletLoader, reporter) {
    this.config = config;
    this.rpcManager = rpcManager;
    this.walletLoader = walletLoader;
    this.reporter = reporter;
  }

  /**
   * 初始化錢包的合約實例
   * @param {ethers.Wallet} wallet - 以太坊錢包
   */
  initializeContracts(wallet) {
    const { contracts } = this.config;
    
    this.priorContract = this.rpcManager.createContract(
      contracts.priorToken,
      TOKEN_ABI,
      wallet
    );
    
    this.usdcContract = this.rpcManager.createContract(
      contracts.usdcToken,
      TOKEN_ABI,
      wallet
    );
    
    this.faucetContract = this.rpcManager.createContract(
      contracts.faucet,
      FAUCET_ABI,
      wallet
    );
    
    this.swapRouter = contracts.swapRouter;
    this.connectedWallet = this.rpcManager.connectWallet(wallet);
  }

  /**
   * 檢查 ETH 餘額
   * @returns {Promise<ethers.BigNumber>} - ETH 餘額
   */
  async checkEthBalance() {
    const balance = await this.rpcManager.getBalance(this.connectedWallet.address);
    
    this.walletLoader.updateWalletBalances(this.connectedWallet.address, {
      eth: balance
    });
    
    return balance;
  }

  /**
   * 檢查代幣餘額
   * @returns {Promise<Object>} - 代幣餘額
   */
  async checkTokenBalances() {
    try {
      const priorBalance = await this.priorContract.balanceOf(this.connectedWallet.address);
      const usdcBalance = await this.usdcContract.balanceOf(this.connectedWallet.address);
      
      const priorDecimals = await this.priorContract.decimals();
      const usdcDecimals = await this.usdcContract.decimals();
      
      const formattedPrior = formatTokenAmount(priorBalance, priorDecimals);
      const formattedUsdc = formatTokenAmount(usdcBalance, usdcDecimals);
      
      this.reporter.debug(`錢包餘額 - PRIOR: ${formattedPrior}, USDC: ${formattedUsdc}`);
      
      this.walletLoader.updateWalletBalances(this.connectedWallet.address, {
        prior: priorBalance,
        usdc: usdcBalance
      });
      
      return {
        prior: {
          balance: priorBalance,
          formatted: formattedPrior,
          decimals: priorDecimals
        },
        usdc: {
          balance: usdcBalance,
          formatted: formattedUsdc,
          decimals: usdcDecimals
        }
      };
    } catch (error) {
      this.reporter.error('無法檢查代幣餘額', error);
      throw error;
    }
  }

  /**
   * 檢查代幣授權
   * @param {string} tokenType - 代幣類型 ('prior' 或 'usdc')
   * @returns {Promise<boolean>} - 是否已授權
   */
  async checkTokenAllowance(tokenType) {
    try {
      const contract = tokenType === 'prior' ? this.priorContract : this.usdcContract;
      
      const allowance = await contract.allowance(
        this.connectedWallet.address,
        this.swapRouter
      );
      
      const isApproved = !allowance.isZero();
      
      this.walletLoader.updateWalletApproval(
        this.connectedWallet.address,
        tokenType,
        isApproved
      );
      
      return isApproved;
    } catch (error) {
      this.reporter.error(`無法檢查 ${tokenType} 授權`, error);
      throw error;
    }
  }

  /**
   * 請求水龍頭
   * @returns {Promise<ethers.providers.TransactionReceipt>} - 交易收據
   */
  async requestFaucet() {
    try {
      const { gasSettings } = this.config;
      
      this.reporter.info(`請求水龍頭 - 錢包: ${this.connectedWallet.address}`);
      
      const txParams = {
        gasLimit: getRandomInRange(
          gasSettings.faucet.gasLimitMin,
          gasSettings.faucet.gasLimitMax
        ),
        maxFeePerGas: ethers.utils.parseUnits(
          gasSettings.faucet.maxFeePerGas,
          'gwei'
        ),
        maxPriorityFeePerGas: ethers.utils.parseUnits(
          gasSettings.faucet.maxPriorityFeePerGas,
          'gwei'
        )
      };
      
      const tx = await this.faucetContract.claim(txParams);
      
      this.reporter.info(`水龍頭請求已提交 - 交易哈希: ${tx.hash}`);
      
      const receipt = await tx.wait();
      
      this.reporter.info(`水龍頭請求已確認 - 區塊號: ${receipt.blockNumber}`);
      
      // 等待一段時間以便餘額更新
      const { afterFaucet } = this.config.delays;
      const delayTime = getRandomInRange(afterFaucet.min, afterFaucet.max);
      
      this.reporter.debug(`等待 ${delayTime}ms 讓餘額更新`);
      await sleep(delayTime);
      
      // 報告交易
      await this.reporter.logTransaction(
        this.connectedWallet.address,
        TRANSACTION_TYPES.FAUCET,
        tx.hash,
        {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString()
        }
      );
      
      return receipt;
    } catch (error) {
      this.reporter.error('水龍頭請求失敗', error);
      
      if (error.message.includes(ERROR_MESSAGES.REPLACEMENT_UNDERPRICED)) {
        this.reporter.warn('交易價格過低，增加 gas 費用後重試');
        // 增加 gas 費用後重試
        return this.retryWithHigherGas(this.requestFaucet.bind(this), 'faucet');
      }
      
      throw error;
    }
  }

  /**
   * 授權代幣
   * @param {string} tokenType - 代幣類型 ('prior' 或 'usdc')
   * @returns {Promise<ethers.providers.TransactionReceipt>} - 交易收據
   */
  async approveToken(tokenType) {
    try {
      const { gasSettings, contracts } = this.config;
      const contract = tokenType === 'prior' ? this.priorContract : this.usdcContract;
      const tokenName = tokenType.toUpperCase();
      
      this.reporter.info(`授權 ${tokenName} 代幣 - 錢包: ${this.connectedWallet.address}`);
      
      const txParams = {
        gasLimit: getRandomInRange(
          gasSettings.approve.gasLimitMin,
          gasSettings.approve.gasLimitMax
        ),
        maxFeePerGas: ethers.utils.parseUnits(
          gasSettings.approve.maxFeePerGas,
          'gwei'
        ),
        maxPriorityFeePerGas: ethers.utils.parseUnits(
          gasSettings.approve.maxPriorityFeePerGas, 
          'gwei'
        )
      };
      
      const tx = await contract.approve(
        contracts.swapRouter,
        ethers.constants.MaxUint256,
        txParams
      );
      
      this.reporter.info(`${tokenName} 授權已提交 - 交易哈希: ${tx.hash}`);
      
      const receipt = await tx.wait();
      
      this.reporter.info(`${tokenName} 授權已確認 - 區塊號: ${receipt.blockNumber}`);
      
      // 更新授權狀態
      this.walletLoader.updateWalletApproval(
        this.connectedWallet.address,
        tokenType,
        true
      );
      
      // 報告交易
      await this.reporter.logTransaction(
        this.connectedWallet.address,
        tokenType === 'prior' ? TRANSACTION_TYPES.APPROVE_PRIOR : TRANSACTION_TYPES.APPROVE_USDC,
        tx.hash,
        {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString()
        }
      );
      
      return receipt;
    } catch (error) {
      this.reporter.error(`${tokenType.toUpperCase()} 授權失敗`, error);
      
      if (error.message.includes(ERROR_MESSAGES.REPLACEMENT_UNDERPRICED)) {
        this.reporter.warn('交易價格過低，增加 gas 費用後重試');
        // 增加 gas 費用後重試
        return this.retryWithHigherGas(
          () => this.approveToken(tokenType),
          'approve'
        );
      }
      
      throw error;
    }
  }

  /**
   * 執行代幣交換
   * @param {string} swapType - 交換類型 ('prior-to-usdc' 或 'usdc-to-prior')
   * @returns {Promise<ethers.providers.TransactionReceipt>} - 交易收據
   */
  async executeSwap(swapType) {
    try {
      const { gasSettings, contracts } = this.config;
      
      const swapData = swapType === 'prior-to-usdc' 
        ? SWAP_DATA.PRIOR_TO_USDC 
        : SWAP_DATA.USDC_TO_PRIOR;
      
      const txType = swapType === 'prior-to-usdc'
        ? TRANSACTION_TYPES.SWAP_PRIOR_TO_USDC
        : TRANSACTION_TYPES.SWAP_USDC_TO_PRIOR;
      
      this.reporter.info(`執行交換 ${swapType} - 錢包: ${this.connectedWallet.address}`);
      
      const txParams = {
        to: contracts.swapRouter,
        data: swapData,
        gasLimit: getRandomInRange(
          gasSettings.swap.gasLimitMin,
          gasSettings.swap.gasLimitMax
        ),
        maxFeePerGas: ethers.utils.parseUnits(
          gasSettings.swap.maxFeePerGas,
          'gwei'
        ),
        maxPriorityFeePerGas: ethers.utils.parseUnits(
          gasSettings.swap.maxPriorityFeePerGas,
          'gwei'
        )
      };
      
      const tx = await this.connectedWallet.sendTransaction(txParams);
      
      this.reporter.info(`${swapType} 交換已提交 - 交易哈希: ${tx.hash}`);
      
      const receipt = await tx.wait();
      
      this.reporter.info(`${swapType} 交換已確認 - 區塊號: ${receipt.blockNumber}`);
      
      // 報告交易
      await this.reporter.logTransaction(
        this.connectedWallet.address,
        txType,
        tx.hash,
        {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          swapType
        }
      );
      
      return receipt;
    } catch (error) {
      this.reporter.error(`${swapType} 交換失敗`, error);
      
      if (error.message.includes(ERROR_MESSAGES.REPLACEMENT_UNDERPRICED)) {
        this.reporter.warn('交易價格過低，增加 gas 費用後重試');
        // 增加 gas 費用後重試
        return this.retryWithHigherGas(
          () => this.executeSwap(swapType),
          'swap'
        );
      }
      
      throw error;
    }
  }

  /**
   * 使用更高的 gas 費用重試交易
   * @param {Function} txFunction - 交易函數
   * @param {string} txType - 交易類型
   * @returns {Promise<any>} - 交易結果
   */
  async retryWithHigherGas(txFunction, txType) {
    const { gasSettings } = this.config;
    const settings = gasSettings[txType];
    
    if (!settings.maxRetries) {
      throw new Error(`無法重試 ${txType} 交易，已達到最大重試次數`);
    }
    
    // 增加 gas 費用
    const multiplier = settings.retryMultiplier || 1.3;
    
    // 臨時修改配置
    const originalMaxFee = settings.maxFeePerGas;
    const originalPriorityFee = settings.maxPriorityFeePerGas;
    
    settings.maxFeePerGas = (parseFloat(settings.maxFeePerGas) * multiplier).toFixed(6);
    settings.maxPriorityFeePerGas = (parseFloat(settings.maxPriorityFeePerGas) * multiplier).toFixed(6);
    
    settings.maxRetries -= 1;
    
    this.reporter.debug(`重試 ${txType} 交易，增加 gas 費用: ${originalMaxFee} -> ${settings.maxFeePerGas}`);
    
    try {
      // 重試交易
      return await txFunction();
    } finally {
      // 恢復原始配置
      settings.maxFeePerGas = originalMaxFee;
      settings.maxPriorityFeePerGas = originalPriorityFee;
      settings.maxRetries += 1;
    }
  }

  /**
   * 執行一系列交易
   * @param {string[]} txSequence - 交易序列
   * @returns {Promise<boolean>} - 是否成功
   */
  async executeTransactionSequence(txSequence) {
    try {
      this.reporter.info(`開始執行交易序列 - 錢包: ${this.connectedWallet.address}`);
      this.reporter.debug(`交易序列: ${JSON.stringify(txSequence)}`);
      
      // 確保有足夠的 ETH
      const ethBalance = await this.checkEthBalance();
      
      if (ethBalance.lt(ethers.utils.parseEther('0.001'))) {
        this.reporter.warn(`ETH 餘額不足: ${ethers.utils.formatEther(ethBalance)} ETH`);
        throw new Error('ETH 餘額不足，無法執行交易');
      }
      
      // 檢查代幣餘額
      const balances = await this.checkTokenBalances();
      
      // 如果 PRIOR 餘額為 0，請求水龍頭
      if (balances.prior.balance.isZero() && this.config.wallets.requireFaucet) {
        this.reporter.info('PRIOR 餘額為 0，請求水龍頭');
        await this.requestFaucet();
        
        // 重新檢查餘額
        await this.checkTokenBalances();
      }
      
      // 執行每個交易
      for (const txType of txSequence) {
        // 交易之間的隨機延遲
        if (txSequence.indexOf(txType) > 0) {
          const { betweenTransactions } = this.config.delays;
          const delayTime = getRandomInRange(betweenTransactions.min, betweenTransactions.max);
          
          this.reporter.debug(`等待 ${delayTime}ms 後執行下一筆交易`);
          await sleep(delayTime);
        }
        
        // 根據交易類型執行相應操作
        if (txType === TRANSACTION_TYPES.SWAP_PRIOR_TO_USDC) {
          // 檢查 PRIOR 餘額
          const balances = await this.checkTokenBalances();
          const minPriorBalance = ethers.utils.parseUnits(
            this.config.transactions.minBalanceThresholds.prior,
            balances.prior.decimals
          );
          
          if (balances.prior.balance.lt(minPriorBalance)) {
            this.reporter.warn(`PRIOR 餘額不足以執行交換: ${balances.prior.formatted}`);
            continue;
          }
          
          // 檢查 PRIOR 授權
          const isPriorApproved = await this.checkTokenAllowance('prior');
          
          if (!isPriorApproved) {
            await this.approveToken('prior');
          }
          
          // 執行 PRIOR -> USDC 交換
          await this.executeSwap('prior-to-usdc');
        } 
        else if (txType === TRANSACTION_TYPES.SWAP_USDC_TO_PRIOR) {
          // 檢查 USDC 餘額
          const balances = await this.checkTokenBalances();
          const minUsdcBalance = ethers.utils.parseUnits(
            this.config.transactions.minBalanceThresholds.usdc,
            balances.usdc.decimals
          );
          
          if (balances.usdc.balance.lt(minUsdcBalance)) {
            this.reporter.warn(`USDC 餘額不足以執行交換: ${balances.usdc.formatted}`);
            continue;
          }
          
          // 檢查 USDC 授權
          const isUsdcApproved = await this.checkTokenAllowance('usdc');
          
          if (!isUsdcApproved) {
            await this.approveToken('usdc');
          }
          
          // 執行 USDC -> PRIOR 交換
          await this.executeSwap('usdc-to-prior');
        }
      }
      
      this.reporter.info(`交易序列執行完成 - 錢包: ${this.connectedWallet.address}`);
      return true;
    } catch (error) {
      this.reporter.error('執行交易序列失敗', error, {
        wallet: this.connectedWallet.address
      });
      return false;
    }
  }
}

module.exports = SwapEngine; 