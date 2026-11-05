// Veyroq Real On-Chain RPC & Explorer Transaction Scanner
// Queries live EVM JSON-RPC nodes and manages persistent transaction tagging.

export const NETWORKS = {
  'Arc': {
    name: 'Circle Arc Testnet',
    chainId: 5042002,
    rpcUrl: 'https://rpc.testnet.arc.io',
    explorerTxUrl: 'https://explorer.testnet.arc.io/tx/',
    nativeCurrency: 'USDC'
  },
  'Base': {
    name: 'Base Mainnet',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    explorerTxUrl: 'https://basescan.org/tx/',
    nativeCurrency: 'ETH'
  },
  'Monad': {
    name: 'Monad Testnet',
    chainId: 10143,
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    explorerTxUrl: 'https://testnet.monadexplorer.com/tx/',
    nativeCurrency: 'MON'
  },
  'Arbitrum': {
    name: 'Arbitrum One',
    chainId: 42161,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerTxUrl: 'https://arbiscan.io/tx/',
    nativeCurrency: 'ETH'
  },
  'Ethereum': {
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: 'https://eth.llamarpc.com',
    explorerTxUrl: 'https://etherscan.io/tx/',
    nativeCurrency: 'ETH'
  }
};

const TAG_STORAGE_KEY = 'veyroq_tagged_transactions_v1';

// In-memory fallback for test environments without localStorage
let memoryStorage = {};

export function getStoredTags() {
  if (typeof localStorage !== 'undefined') {
    try {
      return JSON.parse(localStorage.getItem(TAG_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }
  return memoryStorage;
}

export function saveTransactionTag(txHash, tag, category = 'Uncategorized', notes = '') {
  if (!txHash) return;
  const key = txHash.toLowerCase();
  const current = getStoredTags();
  current[key] = {
    tag: tag.trim(),
    category: category.trim(),
    notes: notes.trim(),
    updatedAt: new Date().toISOString()
  };

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
      console.warn('Could not save to localStorage:', e);
    }
  } else {
    memoryStorage = current;
  }
  return current[key];
}

export function getTransactionTag(txHash) {
  if (!txHash) return null;
  const tags = getStoredTags();
  return tags[txHash.toLowerCase()] || null;
}

// Convert 20-byte address to 32-byte topic for log filtering
export function addressToTopic(address) {
  if (!address || !address.startsWith('0x')) return null;
  return '0x' + address.slice(2).toLowerCase().padStart(64, '0');
}

// Format raw hex balance or wei to human USDC decimal (6 decimals)
export function formatUnitsUSDC(hexOrBigInt) {
  try {
    const val = typeof hexOrBigInt === 'string' ? BigInt(hexOrBigInt) : BigInt(hexOrBigInt || 0);
    const whole = val / 1000000n;
    const frac = val % 1000000n;
    return parseFloat(`${whole}.${frac.toString().padStart(6, '0')}`);
  } catch {
    return 0;
  }
}

// Low-level JSON-RPC fetcher with timeout
export async function rpcCall(rpcUrl, method, params = [], timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'RPC Error');
    return json.result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// Pull real on-chain transactions for an address
export async function fetchLiveTransactions(address, networkKey = 'Arc') {
  if (!address || !address.startsWith('0x')) {
    throw new Error('Invalid EVM address');
  }

  const network = NETWORKS[networkKey] || NETWORKS['Arc'];
  const rpcUrl = network.rpcUrl;

  try {
    // 1. Get latest block number
    const latestBlockHex = await rpcCall(rpcUrl, 'eth_blockNumber', []);
    const latestBlock = parseInt(latestBlockHex, 16);

    // 2. Query recent transfer events (search last 50,000 blocks)
    const fromBlock = '0x' + Math.max(0, latestBlock - 50000).toString(16);
    const topicAddr = addressToTopic(address);

    // ERC-20 Transfer(address,address,uint256) signature
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    // Query outgoing & incoming transfers in parallel
    const [sentLogs, receivedLogs] = await Promise.all([
      rpcCall(rpcUrl, 'eth_getLogs', [{
        fromBlock,
        toBlock: 'latest',
        topics: [TRANSFER_TOPIC, topicAddr]
      }]).catch(() => []),
      rpcCall(rpcUrl, 'eth_getLogs', [{
        fromBlock,
        toBlock: 'latest',
        topics: [TRANSFER_TOPIC, null, topicAddr]
      }]).catch(() => [])
    ]);

    const combined = [...sentLogs, ...receivedLogs];
    const tags = getStoredTags();

    // Map logs to clean transaction records
    const transactions = combined.map((log, idx) => {
      const isOutgoing = (log.topics[1] || '').toLowerCase() === topicAddr.toLowerCase();
      const rawCounterpartyTopic = isOutgoing ? log.topics[2] : log.topics[1];
      const counterparty = rawCounterpartyTopic ? '0x' + rawCounterpartyTopic.slice(26) : '0x00';
      const blockNum = parseInt(log.blockNumber, 16);
      const grossAmount = formatUnitsUSDC(log.data || '0x0');
      const txHash = log.transactionHash || `tx-${networkKey}-${blockNum}-${idx}`;

      const tagInfo = tags[txHash.toLowerCase()] || {};
      const plainCounterparty = tagInfo.tag || (isOutgoing ? `Transfer to ${counterparty.slice(0, 6)}...${counterparty.slice(-4)}` : `Received from ${counterparty.slice(0, 6)}...${counterparty.slice(-4)}`);
      const category = tagInfo.category || (isOutgoing ? 'Operating Expense' : 'Treasury Inflow');

      return {
        id: txHash,
        hash: txHash,
        date: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
        block: blockNum,
        type: isOutgoing ? 'OUTGOING_PAYMENT' : 'INCOMING_TRANSFER',
        category,
        counterparty: `${counterparty.slice(0, 6)}...${counterparty.slice(-4)}`,
        rawCounterparty: counterparty,
        plainCounterparty,
        grossAmount,
        asset: 'USDC',
        explorerLink: `${network.explorerTxUrl}${txHash}`,
        isTagged: Boolean(tagInfo.tag),
        notes: tagInfo.notes || ''
      };
    });

    return transactions;
  } catch (err) {
    console.warn(`RPC lookup error on ${network.name}:`, err.message);
    return [];
  }
}

