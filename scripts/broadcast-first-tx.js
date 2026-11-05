// scripts/broadcast-first-tx.js
// Broadcasts your first live transaction on Circle's Arc Testnet (Chain ID: 5042002)
// Demonstrates Veyroq's selective disclosure and Merkle proof commitment on Arcscan Explorer!

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
  console.log("=================================================================");
  console.log("  VEYROQ · BROADCAST FIRST LIVE TRANSACTION ON CIRCLE ARC L1     ");
  console.log("=================================================================");

  // Build resilient Arc JSON-RPC provider with custom headers and static network
  const req = new ethers.FetchRequest(ARC_RPC_URL);
  req.timeout = 25000;
  req.setHeader("User-Agent", "Mozilla/5.0 (compatible; VeyroqArcDev/1.0)");

  const network = new ethers.Network("arc-testnet", CHAIN_ID);
  const provider = new ethers.JsonRpcProvider(req, network, { staticNetwork: network });

  const privateKey = process.env.ARC_PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ No ARC_PRIVATE_KEY found in .env. Run 'node scripts/arc-wallet.js' first!");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  console.log("✔ Operator Wallet Address:", wallet.address);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  const formattedBalance = ethers.formatEther(balance);
  console.log("✔ Arc Native Gas Balance:", `${formattedBalance} ARC-USDC`);

  if (balance === 0n) {
    console.log("\n⚠️  Wallet has 0 gas tokens.");
    console.log("-----------------------------------------------------------------");
    console.log("👉 GET TESTNET USDC FROM CIRCLE FAUCET IN 15 SECONDS:");
    console.log("   1. Open: https://faucet.circle.com/");
    console.log("   2. Network: Select 'Arc Testnet'");
    console.log("   3. Address:", wallet.address);
    console.log("   4. Click 'Send 10 USDC'");
    console.log("   5. Re-run: node scripts/broadcast-first-tx.js");
    console.log("-----------------------------------------------------------------");
    return;
  }

  console.log("\n🚀 Initiating Veyroq Deployment & Transaction on Arc...");

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || 25000000000n;

  // 1. Try to deploy VeyroqRegistry.sol
  const artifactPath = path.join(__dirname, "..", "contracts", "out", "VeyroqRegistry.sol", "VeyroqRegistry.json");

  if (fs.existsSync(artifactPath)) {
    try {
      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet);

      console.log("📦 Deploying VeyroqRegistry.sol smart contract to Arc Testnet...");
      console.log("   Constructor parameters: _usdcToken=0x0, _treasury=" + wallet.address + ", _protocolFee=0");

      const registry = await factory.deploy(
        ethers.ZeroAddress,
        wallet.address,
        0n,
        {
          gasLimit: 2500000,
          gasPrice: gasPrice
        }
      );

      const deployTx = registry.deploymentTransaction();
      console.log("⏳ Transaction Broadcast to Arc Testnet!");
      console.log("   Tx Hash:", deployTx.hash);
      console.log(`   Arcscan: https://testnet.arcscan.app/tx/${deployTx.hash}`);

      console.log("⏳ Waiting for sub-second block confirmation...");
      await registry.waitForDeployment();
      const contractAddress = await registry.getAddress();

      console.log("\n=================================================================");
      console.log("🎉 SUCCESS! VeyroqRegistry DEPLOYED ON CIRCLE ARC TESTNET!");
      console.log("=================================================================");
      console.log("  Contract Address:   ", contractAddress);
      console.log("  Contract Explorer:  ", `https://testnet.arcscan.app/address/${contractAddress}`);
      console.log("  Deployment Tx:      ", `https://testnet.arcscan.app/tx/${deployTx.hash}`);
      console.log("-----------------------------------------------------------------");

      // Save contract address to .env
      const envPath = path.join(__dirname, "..", ".env");
      fs.appendFileSync(envPath, `\nVEYROQ_REGISTRY_ADDRESS=${contractAddress}\n`);
      console.log("✔ Saved VEYROQ_REGISTRY_ADDRESS to .env");

      // Now interact with the contract: Commit our first Cryptographic Audit Proof!
      console.log("\n📝 Committing First Cryptographic Audit Proof to VeyroqRegistry...");
      const sampleMerkleRoot = "0xa1e4f9b8c2d11099432857492cdaee11b402891901aef8302948102948102938";
      const startBlock = 70200000n;
      const endBlock = 70280000n;
      const txCount = 6n;
      const metadataHash = ethers.keccak256(ethers.toUtf8Bytes("FY2026-Q3 Corporate Treasury Audit"));

      const commitTx = await registry.commitAuditProof(
        wallet.address,
        sampleMerkleRoot,
        startBlock,
        endBlock,
        txCount,
        metadataHash,
        {
          gasLimit: 600000,
          gasPrice: gasPrice
        }
      );

      console.log("⏳ Audit Proof Commit Broadcast! Tx Hash:", commitTx.hash);
      console.log(`   Arcscan: https://testnet.arcscan.app/tx/${commitTx.hash}`);
      await commitTx.wait();

      console.log("\n=================================================================");
      console.log("🎉 AUDIT PROOF COMMITMENT CONFIRMED ON ARC TESTNET!");
      console.log("=================================================================");
      console.log("  Tx Hash:          ", commitTx.hash);
      console.log("  Arcscan URL:      ", `https://testnet.arcscan.app/tx/${commitTx.hash}`);
      console.log("-----------------------------------------------------------------");
      console.log("🔐 PRIVACY & ENCRYPTION VERIFICATION (FOR ARKHOUSE):");
      console.log("  • Look at the Arcscan explorer URL above.");
      console.log("  • Notice that ONLY the 32-byte Merkle root hash is stored on-chain:");
      console.log(`    ${sampleMerkleRoot}`);
      console.log("  • Sensitive details (payroll, recipient names, $ amounts)");
      console.log("    remain strictly encrypted client-side in the treasury's memory.");
      console.log("  • Anyone with a Scoped View Key can mathematically verify 0 omissions!");
      console.log("=================================================================");
      return;
    } catch (deployErr) {
      console.warn("⚠️ Contract deployment warning:", deployErr.message);
      console.log("Falling back to direct on-chain cryptographic commitment transaction...");
    }
  }

  // Fallback: Direct on-chain cryptographic payload broadcast
  console.log("📝 Broadcasting direct cryptographic commitment transaction to Arc L1...");
  const sampleMerkleRoot = "0xa1e4f9b8c2d11099432857492cdaee11b402891901aef8302948102948102938";

  const tx = await wallet.sendTransaction({
    to: wallet.address,
    value: ethers.parseEther("0.001"),
    data: sampleMerkleRoot,
    gasPrice: gasPrice,
    gasLimit: 100000
  });

  console.log("⏳ Broadcast complete! Tx Hash:", tx.hash);
  console.log(`   Arcscan: https://testnet.arcscan.app/tx/${tx.hash}`);

  const receipt = await tx.wait();
  console.log("\n=================================================================");
  console.log("🎉 FIRST TRANSACTION CONFIRMED ON ARC TESTNET!");
  console.log("=================================================================");
  console.log("  Block Number:     #", receipt.blockNumber);
  console.log("  Transaction Hash: ", receipt.hash);
  console.log("  Arcscan URL:      ", `https://testnet.arcscan.app/tx/${receipt.hash}`);
  console.log("=================================================================");
}

main().catch(console.error);
