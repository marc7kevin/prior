/**
 * 常量定義文件
 * 包含合約 ABI 和其它常量
 */

// ERC20 代幣合約 ABI
const TOKEN_ABI = [
  // 只包含必要的方法
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

// 水龍頭合約 ABI
const FAUCET_ABI = [
  "function claim() returns (bool)"
];

// 交換路由合約 ABI
const SWAP_ROUTER_ABI = [
  "function swap(bytes calldata data) external payable returns (bool)"
];

// 交易類型
const TRANSACTION_TYPES = {
  FAUCET: 'FAUCET',
  APPROVE_PRIOR: 'APPROVE_PRIOR',
  APPROVE_USDC: 'APPROVE_USDC',
  SWAP_PRIOR_TO_USDC: 'SWAP_PRIOR_TO_USDC',
  SWAP_USDC_TO_PRIOR: 'SWAP_USDC_TO_PRIOR'
};

// 交換交易數據
const SWAP_DATA = {
  PRIOR_TO_USDC: '0x8ec7baf1000000000000000000000000000000000000000000000000016345785d8a0000',
  USDC_TO_PRIOR: '0x8ec7baf1000000000000000000000000000000000000000000000000000000000000002d'
};

// 錯誤類型
const ERROR_TYPES = {
  RPC_ERROR: 'RPC_ERROR',
  TRANSACTION_ERROR: 'TRANSACTION_ERROR',
  BALANCE_ERROR: 'BALANCE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// 特定錯誤消息
const ERROR_MESSAGES = {
  REPLACEMENT_UNDERPRICED: 'replacement transaction underpriced',
  NONCE_TOO_LOW: 'nonce too low',
  INSUFFICIENT_FUNDS: 'insufficient funds',
  EXECUTION_REVERTED: 'execution reverted'
};

module.exports = {
  TOKEN_ABI,
  FAUCET_ABI,
  SWAP_ROUTER_ABI,
  TRANSACTION_TYPES,
  SWAP_DATA,
  ERROR_TYPES,
  ERROR_MESSAGES
}; 