// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/VeyroqRegistry.sol";

/**
 * @title DeployVeyroqRegistry
 * @notice Foundry deployment script for VeyroqRegistry on Circle's Arc Testnet / Mainnet.
 *
 * Usage:
 *   # Dry-run (simulation):
 *   forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --broadcast --verify -vvvv
 *
 *   # With environment variables:
 *   USDC_TOKEN=0x...  TREASURY=0x...  PROTOCOL_FEE=500000  \
 *   forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --private-key $DEPLOYER_KEY --broadcast
 *
 * Environment Variables:
 *   USDC_TOKEN    - Address of ERC-20 USDC on Arc (use address(0) for native USDC gas)
 *   TREASURY      - Treasury address to collect protocol fees
 *   PROTOCOL_FEE  - Initial fee in USDC (6 decimals). E.g., 500000 = $0.50 USDC
 *   DEPLOYER_KEY  - Private key of the deployer (DO NOT commit to version control)
 */
contract DeployVeyroqRegistry is Script {

    function run() external {
        // Read deployment parameters from environment variables
        uint256 deployerKey = vm.envOr("DEPLOYER_KEY", uint256(0));
        address usdcToken = vm.envOr("USDC_TOKEN", address(0));
        address treasury = vm.envAddress("TREASURY");
        uint256 protocolFee = vm.envOr("PROTOCOL_FEE", uint256(5_000_000)); // Default testnet: $5 USDC
        uint256 singleOrgFee = vm.envOr("SINGLE_ORG_FEE", uint256(5_000_000));   // Default testnet: $5 USDC
        uint256 enterpriseFee = vm.envOr("ENTERPRISE_FEE", uint256(50_000_000)); // Default testnet: $50 USDC
        uint256 partnerFee = vm.envOr("PARTNER_FEE", uint256(150_000_000));     // Default testnet: $150 USDC

        require(treasury != address(0), "Deploy: TREASURY env var must be set");

        console.log("=== Veyroq Deployment Configuration ===");
        console.log("  USDC Token:", usdcToken);
        console.log("  Treasury:", treasury);
        console.log("  Protocol Fee:", protocolFee);
        console.log("  SingleOrg Fee:", singleOrgFee);
        console.log("  Enterprise Fee:", enterpriseFee);
        console.log("  Partner Fee:", partnerFee);
        console.log("========================================");

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        VeyroqRegistry registry = new VeyroqRegistry(
            usdcToken,
            treasury,
            protocolFee,
            singleOrgFee,
            enterpriseFee,
            partnerFee
        );

        console.log("VeyroqRegistry deployed at:", address(registry));

        vm.stopBroadcast();

        // Log deployment summary
        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("  Contract: VeyroqRegistry");
        console.log("  Address:", address(registry));
        console.log("  Network: Circle Arc");
        console.log("  Owner:", registry.owner());
        console.log("===========================");
    }
}
