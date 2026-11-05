// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/VeyroqRegistry.sol";
import "./mocks/MockUSDC.sol";

contract VeyroqRegistryTest is Test {
    VeyroqRegistry public registry;
    MockUSDC public usdc;

    address public owner = address(0x1);
    address public treasury = address(0x2);
    address public organization = address(0x10);
    address public auditor = address(0x20);
    address public unauthorized = address(0x99);

    uint256 public constant PROTOCOL_FEE = 25 * 10 ** 6; // 25 USDC (6 decimals)

    function setUp() public {
        vm.warp(1_700_000_000); // Set realistic timestamp to prevent underflow

        vm.startPrank(owner);
        usdc = new MockUSDC();
        registry = new VeyroqRegistry(address(usdc), treasury, PROTOCOL_FEE);
        vm.stopPrank();

        // Mint USDC to test parties
        usdc.mint(organization, 1_000 * 10 ** 6);
        usdc.mint(auditor, 1_000 * 10 ** 6);

        // Approve registry
        vm.prank(organization);
        usdc.approve(address(registry), type(uint256).max);

        vm.prank(auditor);
        usdc.approve(address(registry), type(uint256).max);
    }

    function test_AuthorizeAuditor() public {
        uint256 validUntil = block.timestamp + 90 days;
        bytes32 scopeHash = keccak256("FY2026_Q3_AUDIT_ENGAGEMENT");

        vm.prank(organization);
        registry.authorizeAuditor(auditor, validUntil, scopeHash);

        assertTrue(registry.isAuditorAuthorized(organization, auditor));
    }

    function test_RevokeAuditor() public {
        uint256 validUntil = block.timestamp + 90 days;
        bytes32 scopeHash = keccak256("FY2026_Q3_AUDIT_ENGAGEMENT");

        vm.startPrank(organization);
        registry.authorizeAuditor(auditor, validUntil, scopeHash);
        assertTrue(registry.isAuditorAuthorized(organization, auditor));

        registry.revokeAuditor(auditor);
        assertFalse(registry.isAuditorAuthorized(organization, auditor));
        vm.stopPrank();
    }

    function test_CommitAuditProof_ByOrganization() public {
        bytes32 auditRoot = keccak256("MERKLE_ROOT_100_TRANSACTIONS");
        uint256 start = block.timestamp - 30 days;
        uint256 end = block.timestamp;
        uint256 txCount = 100;
        bytes32 meta = keccak256("IPFS_REPORT_HASH");

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(organization);
        uint256 proofId = registry.commitAuditProof(organization, auditRoot, start, end, txCount, meta);

        assertEq(proofId, 0);
        assertEq(registry.getCommitmentCount(organization), 1);
        assertEq(usdc.balanceOf(treasury), treasuryBefore + PROTOCOL_FEE);

        IVeyroqRegistry.AuditCommitment memory c = registry.getAuditCommitment(organization, 0);
        assertEq(c.auditRootHash, auditRoot);
        assertEq(c.transactionCount, txCount);
        assertEq(c.submitter, organization);
    }

    function test_CommitAuditProof_ByAuthorizedAuditor() public {
        uint256 validUntil = block.timestamp + 30 days;
        bytes32 scopeHash = keccak256("SCOPE_Q3");

        vm.prank(organization);
        registry.authorizeAuditor(auditor, validUntil, scopeHash);

        bytes32 auditRoot = keccak256("MERKLE_ROOT_Q3");

        vm.prank(auditor);
        uint256 proofId = registry.commitAuditProof(
            organization,
            auditRoot,
            block.timestamp - 15 days,
            block.timestamp,
            42,
            bytes32(0)
        );

        assertEq(proofId, 0);
        IVeyroqRegistry.AuditCommitment memory c = registry.getAuditCommitment(organization, 0);
        assertEq(c.submitter, auditor);
    }

    function test_RevertIf_UnauthorizedSubmitter() public {
        bytes32 auditRoot = keccak256("MERKLE_ROOT");

        vm.prank(unauthorized);
        vm.expectRevert("VeyroqRegistry: Submitter unauthorized");
        registry.commitAuditProof(organization, auditRoot, 100, 200, 5, bytes32(0));
    }

    function test_RevertIf_ExpiredAuditor() public {
        uint256 validUntil = block.timestamp + 10 days;
        vm.prank(organization);
        registry.authorizeAuditor(auditor, validUntil, bytes32(0));

        // Fast-forward past expiry
        vm.warp(block.timestamp + 11 days);

        vm.prank(auditor);
        vm.expectRevert("VeyroqRegistry: Submitter unauthorized");
        registry.commitAuditProof(organization, keccak256("ROOT"), 100, 200, 5, bytes32(0));
    }

    function test_MerkleInclusionVerification() public {
        // Construct a simple 2-leaf Merkle Tree:
        // leaf1 = keccak256("Tx1: $50,000 to Vendor B")
        // leaf2 = keccak256("Tx2: $12,500 to Employee C")
        bytes32 leaf1 = keccak256(abi.encodePacked("Tx1: $50,000 to Vendor B"));
        bytes32 leaf2 = keccak256(abi.encodePacked("Tx2: $12,500 to Employee C"));

        // Sort pair according to OpenZeppelin standard
        bytes32 root = leaf1 < leaf2
            ? keccak256(abi.encodePacked(leaf1, leaf2))
            : keccak256(abi.encodePacked(leaf2, leaf1));

        // Organization commits root
        vm.prank(organization);
        uint256 proofId = registry.commitAuditProof(organization, root, 1000, 2000, 2, bytes32(0));

        // Proof for leaf1 is simply [leaf2]
        bytes32[] memory proofForLeaf1 = new bytes32[](1);
        proofForLeaf1[0] = leaf2;

        // Verify leaf1 inclusion on-chain
        bool isIncluded = registry.verifyTransactionInclusion(organization, proofId, leaf1, proofForLeaf1);
        assertTrue(isIncluded);

        // Verification with forged leaf must fail
        bytes32 fakeLeaf = keccak256(abi.encodePacked("Fake Tx: $999,999"));
        bool isFakeIncluded = registry.verifyTransactionInclusion(organization, proofId, fakeLeaf, proofForLeaf1);
        assertFalse(isFakeIncluded);
    }
}
