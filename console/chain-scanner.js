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

export function dedupeAndSortTransactions(existing = [], incoming = []) {
  const merged = [];
  const seen = new Set();
  const keyOf = (t) => {
    const hash = String(t?.hash || t?.id || '').toLowerCase();
    if (hash && t?.logIndex !== undefined && t?.logIndex !== null && Number.isFinite(Number(t.logIndex))) {
      return `${hash}#${Number(t.logIndex)}`;
    }
    return `${hash}:${t?.block || 0}:${t?.grossAmount || 0}:${String(t?.rawCounterparty || '').toLowerCase()}`;
  };
  for (const list of [existing, incoming]) {
    if (!Array.isArray(list)) continue;
    for (const tx of list) {
      const k = keyOf(tx);
      if (!seen.has(k)) {
        seen.add(k);
        merged.push(tx);
      }
    }
  }
  merged.sort((a, b) => ((b.block || 0) - (a.block || 0)) || ((Number(b.logIndex) || 0) - (Number(a.logIndex) || 0)));
  return merged;
}

// Fetch paginated real USDC transfer history (Arc Explorer cursor + live RPC merge)
export async function fetchLiveTransactionsPage(address, networkKey = 'Arc', { cursor = null, maxPages = 2 } = {}) {
  if (!address || !address.startsWith('0x')) {
    throw new Error('Invalid EVM address');
  }

  const network = NETWORKS[networkKey] || NETWORKS['Arc'];
  const rpcUrl = network.rpcUrl;
  const tags = getStoredTags();
  let rpcTransactions = [];

  try {
    // 1. On initial load (cursor === null), scan recent ERC-20 USDC Transfer logs via RPC
    if (!cursor) {
      const latestBlockHex = await rpcCall(rpcUrl, 'eth_blockNumber', []);
      const latestBlock = parseInt(latestBlockHex, 16);
      const fromBlock = '0x' + Math.max(0, latestBlock - 9000).toString(16);
      const topicAddr = addressToTopic(address);
      const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const contractFilter = network.usdcAddress ? { address: network.usdcAddress } : {};

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

      rpcTransactions = combined.map((log, idx) => {
        const isOutgoing = (log.topics[1] || '').toLowerCase() === topicAddr.toLowerCase();
        const rawCounterpartyTopic = isOutgoing ? log.topics[2] : log.topics[1];
        const counterparty = rawCounterpartyTopic ? '0x' + rawCounterpartyTopic.slice(26) : '0x00';
        const blockNum = parseInt(log.blockNumber, 16);
        const logIndex = log.logIndex != null ? parseInt(log.logIndex, 16) : null;
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
          logIndex: Number.isFinite(logIndex) ? logIndex : null,
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
    }

    // 2. Query Arc Explorer Indexer API with token filter & cursor pagination (exact 1:1 parity with Arc Explorer)
    if (networkKey === 'Arc') {
      try {
        const usdcLower = (network.usdcAddress || '').toLowerCase();
        const baseExpUrl = `https://explorer.testnet.arc.io/api/v2/addresses/${address}/token-transfers`;
        const pageBudget = Math.max(1, Math.min(20, Number(maxPages) || 2));
        let nextParams = cursor && typeof cursor === 'object' ? { ...cursor } : null;
        const explorerItems = [];
        const seenCursors = new Set();
        let explorerSucceeded = false;

        for (let page = 0; page < pageBudget; page++) {
          const qs = new URLSearchParams();
          if (network.usdcAddress) qs.set('token', network.usdcAddress);
          if (nextParams && typeof nextParams === 'object') {
            for (const [k, v] of Object.entries(nextParams)) {
              if (v !== undefined && v !== null) qs.set(k, String(v));
            }
          }
          const qsStr = qs.toString();
          if (page > 0 && seenCursors.has(qsStr)) {
            nextParams = null;
            break;
          }
          seenCursors.add(qsStr);
          const pageUrl = qsStr ? `${baseExpUrl}?${qsStr}` : baseExpUrl;

          const expRes = await fetch(pageUrl);
          if (!expRes || typeof expRes.json !== 'function') break;
          const expData = await expRes.json();
          if (!expData || !Array.isArray(expData.items)) break;
          explorerSucceeded = true;

          for (const item of expData.items) {
            const tokAddr = (item.token?.address_hash || item.token?.address || '').toLowerCase();
            if (!usdcLower || !tokAddr || tokAddr === usdcLower) {
              explorerItems.push(item);
            }
          }

          if (!expData.next_page_params || typeof expData.next_page_params !== 'object') {
            nextParams = null;
            break;
          }
          nextParams = expData.next_page_params;
        }

        if (explorerSucceeded) {
          const explorerTxs = explorerItems.map((item, idx) => {
            const fromHash = item.from?.hash || '0x00';
            const toHash = item.to?.hash || '0x00';
            const isOutgoing = fromHash.toLowerCase() === address.toLowerCase();
            const counterparty = isOutgoing ? toHash : fromHash;
            const blockNum = item.block_number || 0;
            const logIndex = item.log_index != null ? Number(item.log_index) : null;
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
              logIndex: Number.isFinite(logIndex) ? logIndex : null,
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

          const merged = dedupeAndSortTransactions(rpcTransactions, explorerTxs);
          return {
            transactions: merged,
            nextCursor: nextParams,
            hasMore: Boolean(nextParams),
            explorerSynced: true
          };
        }
      } catch {}
    }

    return {
      transactions: rpcTransactions,
      nextCursor: null,
      hasMore: false,
      explorerSynced: false
    };
  } catch (err) {
    console.warn(`RPC lookup error on ${network.name}:`, err.message);
    return {
      transactions: [],
      nextCursor: null,
      hasMore: false,
      explorerSynced: false
    };
  }
}

// Pull real on-chain transactions for an address (backward-compatible array wrapper)
export async function fetchLiveTransactions(address, networkKey = 'Arc') {
  const page = await fetchLiveTransactionsPage(address, networkKey, { cursor: null, maxPages: 10 });
  return page.transactions;
}

