// Veyroq Real On-Chain RPC & Explorer Transaction Scanner
// Queries live EVM JSON-RPC nodes and manages persistent transaction tagging.

export const NETWORKS = {
  'Arc': {
    name: 'Arc Testnet',
    chainId: 5042002,
    rpcUrl: 'https://rpc.testnet.arc.io',
    explorerTxUrl: 'https://explorer.testnet.arc.io/tx/',
    nativeCurrency: 'USDC',
    usdcAddress: '0x3600000000000000000000000000000000000000',
    usdcDecimals: 6
  },
  'Base': {
    name: 'Base Testnet',
    chainId: 8453,
    rpcUrl: 'https://sepolia.base.org',
    explorerTxUrl: 'https://sepolia.basescan.org/tx/',
    nativeCurrency: 'ETH',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcDecimals: 6
  },
  'Monad': {
    name: 'Monad Testnet',
    chainId: 10143,
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    explorerTxUrl: 'https://testnet.monadexplorer.com/tx/',
    nativeCurrency: 'MON',
    usdcAddress: null,
    usdcDecimals: 6
  },
  'Arbitrum': {
    name: 'Arbitrum Testnet',
    chainId: 421614,
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    explorerTxUrl: 'https://sepolia.arbiscan.io/tx/',
    nativeCurrency: 'ETH',
    usdcAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    usdcDecimals: 6
  },
  'Ethereum': {
    name: 'Ethereum Testnet',
    chainId: 1,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorerTxUrl: 'https://sepolia.etherscan.io/tx/',
    nativeCurrency: 'ETH',
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    usdcDecimals: 6
  }
};

export function getExplorerAddressUrl(networkKey, address) {
  const net = NETWORKS[networkKey] || NETWORKS['Arc'];
  const base = (net.explorerTxUrl || 'https://explorer.testnet.arc.io/tx/').replace('/tx/', '/address/');
  return `${base}${address || ''}`;
}

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

// Query live ERC-20 USDC balance for an address on any configured network (defaults to Arc)
export async function fetchUsdcBalance(address, networkKey = 'Arc') {
  const network = NETWORKS[networkKey] || NETWORKS['Arc'];
  if (!address || !address.startsWith('0x') || address.length !== 42) {
    return { supported: false, balance: 0, raw: 0n, networkKey, networkName: network.name, symbol: 'USDC' };
  }
  if (!network.usdcAddress) {
    return { supported: false, balance: 0, raw: 0n, networkKey, networkName: network.name, symbol: 'USDC' };
  }

  const cleanAddr = address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const rawHex = await rpcCall(network.rpcUrl, 'eth_call', [{ to: network.usdcAddress, data: '0x70a08231' + cleanAddr }, 'latest']);
  const raw = rawHex && rawHex !== '0x' ? BigInt(rawHex) : 0n;
  const balance = formatUnitsUSDC(raw);

  return {
    supported: true,
    balance,
    raw,
    networkKey,
    networkName: network.name,
    usdcAddress: network.usdcAddress,
    symbol: 'USDC'
  };
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

    // 2. Query recent ERC-20 USDC transfer events (filtered strictly by chain USDC contract when configured)
    const fromBlock = '0x' + Math.max(0, latestBlock - 9000).toString(16);
    const topicAddr = addressToTopic(address);

    // ERC-20 Transfer(address,address,uint256) signature
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const contractFilter = network.usdcAddress ? { address: network.usdcAddress } : {};

    // Query outgoing & incoming USDC transfers in parallel
    const [sentLogs, receivedLogs] = await Promise.all([
      rpcCall(rpcUrl, 'eth_getLogs', [{
        fromBlock,
        toBlock: 'latest',
        ...contractFilter,
        topics: [TRANSFER_TOPIC, topicAddr]
      }]).catch(() => []),
      rpcCall(rpcUrl, 'eth_getLogs', [{
        fromBlock,
        toBlock: 'latest',
        ...contractFilter,
        topics: [TRANSFER_TOPIC, null, topicAddr]
      }]).catch(() => [])
    ]);

    // Deduplicate identical log emissions and drop non-USDC 18-decimal native duplicate logs
    const seenLogs = new Set();
    const combined = [...sentLogs, ...receivedLogs].filter(log => {
      if (network.usdcAddress && log.address && log.address.toLowerCase() !== network.usdcAddress.toLowerCase()) {
        return false;
      }
      const key = `${(log.transactionHash || '').toLowerCase()}:${log.logIndex || ''}`;
      if (log.transactionHash && log.logIndex != null) {
        if (seenLogs.has(key)) return false;
        seenLogs.add(key);
      }
      return true;
    });
    const tags = getStoredTags();

    // Map logs to clean transaction records
    const transactions = combined.map((log, idx) => {
      const isOutgoing = (log.topics[1] || '').toLowerCase() === topicAddr.toLowerCase();
      const rawCounterpartyTopic = isOutgoing ? log.topics[2] : log.topics[1];
      const counterparty = rawCounterpartyTopic ? '0x' + rawCounterpartyTopic.slice(26) : '0x00';
      const blockNum = parseInt(log.blockNumber, 16);
      const grossAmount = formatUnitsUSDC(log.data || '0x0');
      const txHash = log.transactionHash || `tx-${networkKey}-${blockNum}-${idx}`;
      const tsMs = log.blockTimestamp ? parseInt(log.blockTimestamp, 16) * 1000 : Date.now();
      const dateStr = new Date(tsMs).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

      const tagInfo = tags[txHash.toLowerCase()] || {};
      const plainCounterparty = tagInfo.tag || (isOutgoing ? `Transfer to ${counterparty.slice(0, 6)}...${counterparty.slice(-4)}` : `Received from ${counterparty.slice(0, 6)}...${counterparty.slice(-4)}`);
      const category = tagInfo.category || (isOutgoing ? 'Operating Expense' : 'Treasury Inflow');

      return {
        id: txHash,
        hash: txHash,
        date: dateStr,
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

    if (transactions.length > 0) {
      return transactions;
    }

    // 3. Fallback to Circle Arc Explorer Indexer API for full historical block depth
    if (networkKey === 'Arc') {
      try {
        const expUrl = `https://explorer.testnet.arc.io/api/v2/addresses/${address}/token-transfers`;
        const expRes = await fetch(expUrl);
        if (expRes && typeof expRes.json === 'function') {
          const expData = await expRes.json();
          const usdcLower = (network.usdcAddress || '').toLowerCase();
          const items = Array.isArray(expData?.items)
            ? expData.items.filter(item => {
                const tokAddr = (item.token?.address_hash || item.token?.address || '').toLowerCase();
                return !usdcLower || !tokAddr || tokAddr === usdcLower;
              })
            : [];
          if (items.length > 0) {
            return items.map((item, idx) => {
              const fromHash = item.from?.hash || '0x00';
              const toHash = item.to?.hash || '0x00';
              const isOutgoing = fromHash.toLowerCase() === address.toLowerCase();
              const counterparty = isOutgoing ? toHash : fromHash;
              const blockNum = item.block_number || 0;
              const grossAmount = formatUnitsUSDC(item.total?.value || '0');
              const txHash = item.transaction_hash || `tx-Arc-${blockNum}-${idx}`;
              const dateStr = item.timestamp
                ? item.timestamp.replace('T', ' ').slice(0, 19) + ' UTC'
                : new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

              const tagInfo = tags[txHash.toLowerCase()] || {};
              const plainCounterparty = tagInfo.tag || (isOutgoing ? `Transfer to ${counterparty.slice(0, 6)}...${counterparty.slice(-4)}` : `Received from ${counterparty.slice(0, 6)}...${counterparty.slice(-4)}`);
              const category = tagInfo.category || (isOutgoing ? 'Operating Expense' : 'Treasury Inflow');

              return {
                id: txHash,
                hash: txHash,
                date: dateStr,
                block: blockNum,
                type: isOutgoing ? 'OUTGOING_PAYMENT' : 'INCOMING_TRANSFER',
                category,
                counterparty: `${counterparty.slice(0, 6)}...${counterparty.slice(-4)}`,
                rawCounterparty: counterparty,
                plainCounterparty,
                grossAmount,
                asset: item.token?.symbol || 'USDC',
                explorerLink: `${network.explorerTxUrl}${txHash}`,
                isTagged: Boolean(tagInfo.tag),
                notes: tagInfo.notes || ''
              };
            });
          }
        }
      } catch {}
    }

    return transactions;
  } catch (err) {
    console.warn(`RPC lookup error on ${network.name}:`, err.message);
    return [];
  }
}

