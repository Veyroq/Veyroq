// scripts/circle-sdk-flow.js
// Complete Circle Programmable Wallets (Developer-Controlled) integration example for Arc Testnet
// Uses @circle-fin/developer-controlled-wallets

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import dotenv from "dotenv";

dotenv.config();

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || "YOUR_TEST_API_KEY";
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || "YOUR_TEST_ENTITY_SECRET";

async function main() {
  console.log("=================================================================");
  console.log("  VEYROQ · CIRCLE PROGRAMMABLE WALLETS (ARC TESTNET)             ");
  console.log("=================================================================");

  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
    console.log("ℹ️  CIRCLE API CREDENTIALS SETUP:");
    console.log("   To run programmatic wallet generation via Circle Console:");
    console.log("   1. Sign in to Circle Developer Console: https://console.circle.com/");
    console.log("   2. Go to 'Developer' -> API Keys -> Create API Key.");
    console.log("   3. Register your 32-byte hex Entity Secret.");
    console.log("   4. Set them in .env:");
    console.log("      CIRCLE_API_KEY=TEST_API_KEY_...");
    console.log("      CIRCLE_ENTITY_SECRET=YOUR_32_BYTE_HEX_ENTITY_SECRET");
    console.log("-----------------------------------------------------------------");
  }

  try {
    const circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
    });

    console.log("✔ Circle SDK client initialized.");
    console.log("Target Blockchain: Arc Testnet (ARC-TESTNET / EVM 5042002)");
    console.log("SDK Package: @circle-fin/developer-controlled-wallets v10.8.1");

    // How to create a Wallet Set programmatically:
    /*
    const walletSet = await circleClient.createWalletSet({
      name: "Veyroq Treasury Enclave - Arc Testnet",
    });
    console.log("Wallet Set Created:", walletSet.data?.walletSet?.id);

    // Create wallet inside that set:
    const wallets = await circleClient.createWallets({
      walletSetId: walletSet.data?.walletSet?.id,
      blockchains: ["ARC-TESTNET"],
      accountType: "EOA",
      count: 1,
    });
    console.log("New Arc Wallet:", wallets.data?.wallets[0]);
    */

    console.log("\n💡 Ready for Arkhouse documentation!");
  } catch (err) {
    console.error("Circle SDK Initialization notice:", err.message);
  }
}

main().catch(console.error);
