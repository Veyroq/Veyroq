// scripts/arc-wallet.js
// Generates or loads an Arc Testnet wallet and checks on-chain balance on Arc L1 (Chain ID: 5042002)

import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import { ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io";
const CHAIN_ID = 5042002;

async function main() {
  console.log("=================================================");
  console.log("  VEYROQ · CIRCLE ARC TESTNET WALLET GENERATOR   ");
  console.log("=================================================");
  console.log("Connecting to Arc Testnet RPC:", ARC_RPC_URL);

  const req = new ethers.FetchRequest(ARC_RPC_URL);
  req.timeout = 25000;
  req.setHeader("User-Agent", "Mozilla/5.0 (compatible; VeyroqArcDev/1.0)");

  const network = new ethers.Network("arc-testnet", CHAIN_ID);
  const provider = new ethers.JsonRpcProvider(req, network, { staticNetwork: network });

  try {
    const currentBlock = await provider.getBlockNumber();
    console.log(`✔ Connected to Arc Testnet (Chain ID: ${CHAIN_ID}, Block: #${currentBlock})`);
  } catch (err) {
    console.error("❌ Failed to connect to Arc RPC:", err.message);
    return;
  }

  let privateKey = process.env.ARC_PRIVATE_KEY;
  let wallet;

  if (privateKey && privateKey.startsWith("0x") && privateKey.length === 66) {
    wallet = new ethers.Wallet(privateKey, provider);
    console.log("✔ Loaded existing wallet from .env (ARC_PRIVATE_KEY)");
  } else {
    wallet = ethers.Wallet.createRandom().connect(provider);
    console.log("✨ Generated NEW Arc Testnet Developer Wallet!");
    console.log("-------------------------------------------------");
    console.log("  Address:    ", wallet.address);
    console.log("  Private Key:", wallet.privateKey);
    console.log("-------------------------------------------------");

    const envPath = path.join(__dirname, "..", ".env");
    const envContent = `\n# Arc Testnet Configuration\nARC_RPC_URL=https://rpc.testnet.arc.io\nARC_CHAIN_ID=5042002\nARC_PRIVATE_KEY=${wallet.privateKey}\nARC_WALLET_ADDRESS=${wallet.address}\n`;
    fs.appendFileSync(envPath, envContent);
    console.log("✔ Saved credentials to .env file");
  }

  // Check Native Balance on Arc
  const balance = await provider.getBalance(wallet.address);
  const formattedEther = ethers.formatEther(balance);

  console.log("-------------------------------------------------");
  console.log("  Wallet Address:       ", wallet.address);
  console.log("  Arc Native Balance:   ", `${formattedEther} ARC-USDC`);
  console.log("  Arc Explorer URL:     ", `https://testnet.arcscan.app/address/${wallet.address}`);
  console.log("-------------------------------------------------");

  if (balance === 0n) {
    console.log("⚠️  Balance is 0 gas tokens.");
    console.log("👉 GET TESTNET USDC FOR GAS & SETTLEMENTS:");
    console.log("   1. Open: https://faucet.circle.com/");
    console.log("   2. Select: 'Arc Testnet'");
    console.log("   3. Paste address:", wallet.address);
    console.log("   4. Click 'Send 10 USDC'");
  } else {
    console.log("🎉 Wallet is funded! Ready to register your first transaction.");
    console.log("👉 Run: node scripts/broadcast-first-tx.js");
  }
  console.log("=================================================");
}

main().catch(console.error);
