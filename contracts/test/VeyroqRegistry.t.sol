// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/VeyroqRegistry.sol";
import "./mocks/MockUSDC.sol";

contract VeyroqRegistryTest is Test {
    VeyroqRegistry public registry;
    MockUSDC public usdc;

    address public owner = address(0x1);
    address public treasury = address(0x2);
    address public newOwnerCandidate = address(0x3);
    address public organization = address(0x10);
    address public auditor = address(0x20);
    address public unauthorized = address(0x99);

    uint256 public constant PROTOCOL_FEE = 5 * 10 ** 6; // 5 USDC (6 decimals)
    uint256 public constant SINGLE_ORG_FEE = 5 * 10 ** 6; // $5 USDC (6 decimals)
    uint256 public constant ENTERPRISE_FEE = 50 * 10 ** 6; // $50 USDC (6 decimals)
    uint256 public constant PARTNER_FEE = 150 * 10 ** 6; // $150 USDC (6 decimals)

    function setUp() public {
        vm.warp(1_700_000_000); // Set realistic timestamp to prevent underflow

        vm.startPrank(owner);
        usdc = new MockUSDC();
        registry = new VeyroqRegistry(address(usdc), treasury, PROTOCOL_FEE, SINGLE_ORG_FEE, ENTERPRISE_FEE, PARTNER_FEE);
        vm.stopPrank();

        // Mint USDC to test parties (enough for multi-month enterprise subscriptions)
        usdc.mint(organization, 50_000 * 10 ** 6);
        usdc.mint(auditor, 50_000 * 10 ** 6);

        // Approve registry
        vm.prank(organization);
        usdc.approve(address(registry), type(uint256).max);

        vm.prank(auditor);
        usdc.approve(address(registry), type(uint256).max);

        // Activate baseline Enterprise & Partner subscriptions for core tests
        vm.prank(organization);
        registry.subscribe(IVeyroqRegistry.PlanTier.Enterprise, 1);

        vm.prank(auditor);
        registry.subscribe(IVeyroqRegistry.PlanTier.Partner, 1);
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

    function test_BatchInclusionVerification() public {
        bytes32 leaf1 = keccak256(abi.encodePacked("Tx1: Payroll"));
        bytes32 leaf2 = keccak256(abi.encodePacked("Tx2: Vendor"));

        bytes32 root = leaf1 < leaf2
            ? keccak256(abi.encodePacked(leaf1, leaf2))
            : keccak256(abi.encodePacked(leaf2, leaf1));

        vm.prank(organization);
        uint256 proofId = registry.commitAuditProof(organization, root, 1000, 2000, 2, bytes32(0));

        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = leaf1;
        leaves[1] = keccak256("Forged Tx");

        bytes32[][] memory proofs = new bytes32[][](2);
        proofs[0] = new bytes32[](1);
        proofs[0][0] = leaf2;
        proofs[1] = new bytes32[](1);
        proofs[1][0] = leaf2;

        bool[] memory results = registry.verifyBatchInclusion(organization, proofId, leaves, proofs);
        assertEq(results.length, 2);
        assertTrue(results[0]);
        assertFalse(results[1]);
    }

    function test_GetAuditCommitmentsPagination() public {
        bytes32 root = keccak256("ROOT");
        vm.startPrank(organization);
        registry.commitAuditProof(organization, root, 100, 200, 10, bytes32(0));
        registry.commitAuditProof(organization, root, 200, 300, 20, bytes32(0));
        registry.commitAuditProof(organization, root, 300, 400, 30, bytes32(0));
        vm.stopPrank();

        assertEq(registry.getCommitmentCount(organization), 3);

        IVeyroqRegistry.AuditCommitment[] memory page1 = registry.getAuditCommitments(organization, 0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0].transactionCount, 10);
        assertEq(page1[1].transactionCount, 20);

        IVeyroqRegistry.AuditCommitment[] memory page2 = registry.getAuditCommitments(organization, 2, 2);
        assertEq(page2.length, 1);
        assertEq(page2[0].transactionCount, 30);

        IVeyroqRegistry.AuditCommitment[] memory emptyPage = registry.getAuditCommitments(organization, 5, 2);
        assertEq(emptyPage.length, 0);
    }

    function test_NativeFeeCommitment() public {
        // Deploy registry configured for native gas USDC (usdcToken = address(0))
        uint256 nativeFee = 1 ether / 100; // 0.01 native gas
        vm.prank(owner);
        VeyroqRegistry nativeRegistry = new VeyroqRegistry(address(0), treasury, nativeFee, 0.01 ether, 0.1 ether, 0.2 ether);

        vm.deal(organization, 1 ether);
        vm.prank(organization);
        nativeRegistry.subscribe{value: 0.1 ether}(IVeyroqRegistry.PlanTier.Enterprise, 1);

        uint256 treasuryBefore = treasury.balance;

        vm.prank(organization);
        uint256 proofId = nativeRegistry.commitAuditProof{value: nativeFee}(
            organization,
            keccak256("NATIVE_ROOT"),
            100,
            200,
            5,
            bytes32(0)
        );

        assertEq(proofId, 0);
        assertEq(treasury.balance, treasuryBefore + nativeFee);
    }

    function test_RevertIf_IncorrectNativeFeePaid() public {
        uint256 nativeFee = 1 ether / 100;
        vm.prank(owner);
        VeyroqRegistry nativeRegistry = new VeyroqRegistry(address(0), treasury, nativeFee, 0.01 ether, 0.1 ether, 0.2 ether);

        vm.deal(organization, 1 ether);
        vm.prank(organization);
        nativeRegistry.subscribe{value: 0.1 ether}(IVeyroqRegistry.PlanTier.Enterprise, 1);

        // Underpayment
        vm.prank(organization);
        vm.expectRevert("VeyroqRegistry: Incorrect native fee paid");
        nativeRegistry.commitAuditProof{value: nativeFee - 1}(
            organization,
            keccak256("NATIVE_ROOT"),
            100,
            200,
            5,
            bytes32(0)
        );

        // Overpayment
        vm.prank(organization);
        vm.expectRevert("VeyroqRegistry: Incorrect native fee paid");
        nativeRegistry.commitAuditProof{value: nativeFee + 1}(
            organization,
            keccak256("NATIVE_ROOT"),
            100,
            200,
            5,
            bytes32(0)
        );
    }

    function test_RevertIf_ValueSentWhenUSDCRequired() public {
        vm.deal(organization, 1 ether);

        vm.prank(organization);
        vm.expectRevert("VeyroqRegistry: Value not accepted for ERC20 fee");
        registry.commitAuditProof{value: 1000}(
            organization,
            keccak256("ROOT"),
            100,
            200,
            5,
            bytes32(0)
        );
    }

    function test_RevertIf_ZeroAddressOrganization() public {
        vm.prank(organization);
        vm.expectRevert("VeyroqRegistry: Invalid organization");
        registry.commitAuditProof(address(0), keccak256("ROOT"), 100, 200, 5, bytes32(0));
    }

    function test_RevertIf_EmptyRootHash() public {
        vm.prank(organization);
        vm.expectRevert("VeyroqRegistry: Invalid root hash");
        registry.commitAuditProof(organization, bytes32(0), 100, 200, 5, bytes32(0));
    }

    function test_RevertIf_InvalidPeriodRange() public {
        vm.prank(organization);
        vm.expectRevert("VeyroqRegistry: Invalid period range");
        registry.commitAuditProof(organization, keccak256("ROOT"), 200, 100, 5, bytes32(0));
    }

    function test_RevertIf_ZeroTransactionCount() public {
        vm.prank(organization);
        vm.expectRevert("VeyroqRegistry: Zero transactions");
        registry.commitAuditProof(organization, keccak256("ROOT"), 100, 200, 0, bytes32(0));
    }

    function test_Admin_SetProtocolFee() public {
        vm.prank(owner);
        registry.setProtocolFee(50 * 10 ** 6);
        assertEq(registry.protocolFee(), 50 * 10 ** 6);

        // Non-owner revert
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.setProtocolFee(10);
    }

    function test_Admin_SetTreasury() public {
        address newTreasury = address(0x777);
        vm.prank(owner);
        registry.setTreasury(newTreasury);
        assertEq(registry.treasury(), newTreasury);

        // Revert on zero address
        vm.prank(owner);
        vm.expectRevert("VeyroqRegistry: Invalid treasury");
        registry.setTreasury(address(0));
    }

    function test_Admin_SetUSDCToken() public {
        address newUsdc = address(0x888);
        vm.prank(owner);
        registry.setUSDCToken(newUsdc);
        assertEq(address(registry.usdcToken()), newUsdc);
    }

    function test_Admin_RescueTokenAndNative() public {
        // Test token rescue
        MockUSDC extraToken = new MockUSDC();
        extraToken.mint(address(registry), 500 * 10 ** 6);

        address recipient = address(0x555);
        vm.prank(owner);
        registry.rescueToken(address(extraToken), recipient, 500 * 10 ** 6);
        assertEq(extraToken.balanceOf(recipient), 500 * 10 ** 6);

        // Test native rescue
        vm.deal(address(registry), 2 ether);
        uint256 recBefore = recipient.balance;
        vm.prank(owner);
        registry.rescueNative(payable(recipient));
        assertEq(recipient.balance, recBefore + 2 ether);
    }

    // Property-based Fuzz Test: Merkle inclusion for arbitrary fuzzed leaves
    function testFuzz_MerkleInclusion(bytes32 leaf1, bytes32 leaf2) public {
        vm.assume(leaf1 != bytes32(0) && leaf2 != bytes32(0));
        vm.assume(leaf1 != leaf2);

        bytes32 root = leaf1 < leaf2
            ? keccak256(abi.encodePacked(leaf1, leaf2))
            : keccak256(abi.encodePacked(leaf2, leaf1));

        vm.prank(organization);
        uint256 proofId = registry.commitAuditProof(organization, root, 1000, 2000, 2, bytes32(0));

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf2;

        bool verified = registry.verifyTransactionInclusion(organization, proofId, leaf1, proof);
        assertTrue(verified);
    }

    // ─── Subscription Engine Tests ──────────────────────────────────────────

    function test_Subscribe_SingleOrg_USDC() public {
        address newOrg = address(0x29);
        usdc.mint(newOrg, 10_000 * 10 ** 6);
        vm.prank(newOrg);
        usdc.approve(address(registry), type(uint256).max);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 singleOrgMonthly = registry.singleOrgFee();
        assertEq(singleOrgMonthly, 5 * 10 ** 6);

        vm.prank(newOrg);
        registry.subscribe(IVeyroqRegistry.PlanTier.SingleOrg, 1);

        (IVeyroqRegistry.PlanTier tier, uint256 expiresAt, bool isActive) = registry.getSubscription(newOrg);
        assertEq(uint256(tier), uint256(IVeyroqRegistry.PlanTier.SingleOrg));
        assertEq(expiresAt, block.timestamp + 30 days);
        assertTrue(isActive);
        assertEq(usdc.balanceOf(treasury), treasuryBefore + singleOrgMonthly);
    }

    function test_Subscribe_Enterprise_USDC() public {
        address newOrg = address(0x30);
        usdc.mint(newOrg, 10_000 * 10 ** 6);
        vm.prank(newOrg);
        usdc.approve(address(registry), type(uint256).max);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 enterpriseMonthly = registry.enterpriseFee();

        vm.prank(newOrg);
        registry.subscribe(IVeyroqRegistry.PlanTier.Enterprise, 1);

        (IVeyroqRegistry.PlanTier tier, uint256 expiresAt, bool isActive) = registry.getSubscription(newOrg);
        assertEq(uint256(tier), uint256(IVeyroqRegistry.PlanTier.Enterprise));
        assertEq(expiresAt, block.timestamp + 30 days);
        assertTrue(isActive);
        assertEq(usdc.balanceOf(treasury), treasuryBefore + enterpriseMonthly);
    }

    function test_Subscribe_Partner_USDC() public {
        address newFirm = address(0x40);
        usdc.mint(newFirm, 10_000 * 10 ** 6);
        vm.prank(newFirm);
        usdc.approve(address(registry), type(uint256).max);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 partnerMonthly = registry.partnerFee();

        vm.prank(newFirm);
        registry.subscribe(IVeyroqRegistry.PlanTier.Partner, 1);

        (IVeyroqRegistry.PlanTier tier, uint256 expiresAt, bool isActive) = registry.getSubscription(newFirm);
        assertEq(uint256(tier), uint256(IVeyroqRegistry.PlanTier.Partner));
        assertEq(expiresAt, block.timestamp + (1 * 30 days));
        assertTrue(isActive);
        assertEq(usdc.balanceOf(treasury), treasuryBefore + partnerMonthly);
    }

    function test_SelfCustodialUser_SubscribesAndCommitsDirectly() public {
        address privyWallet = address(0x89);
        usdc.mint(privyWallet, 1_000 * 10 ** 6);

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.startPrank(privyWallet);
        usdc.approve(address(registry), type(uint256).max);
        registry.subscribe(IVeyroqRegistry.PlanTier.Enterprise, 1);

        uint256 proofId = registry.commitAuditProof(privyWallet, keccak256("PRIVY_ROOT"), 100, 200, 4, bytes32(0));
        assertEq(proofId, 0);
        registry.authorizeAuditor(auditor, block.timestamp + 30 days, keccak256("SCOPE"));
        vm.stopPrank();

        (IVeyroqRegistry.PlanTier tier, uint256 expiresAt, bool isActive) = registry.getSubscription(privyWallet);
        assertEq(uint256(tier), uint256(IVeyroqRegistry.PlanTier.Enterprise));
        assertEq(expiresAt, block.timestamp + 30 days);
        assertTrue(isActive);
        assertTrue(registry.isAuditorAuthorized(privyWallet, auditor));
        assertEq(usdc.balanceOf(treasury), treasuryBefore + ENTERPRISE_FEE + PROTOCOL_FEE);

        IVeyroqRegistry.AuditCommitment memory c = registry.getAuditCommitment(privyWallet, 0);
        assertEq(c.submitter, privyWallet);
    }

    function test_RevertIf_DoubleSubscribeBefore30DaysExpire_And_RenewAfterOptOut() public {
        address newOrg = address(0x31);
        usdc.mint(newOrg, 10_000 * 10 ** 6);
        vm.startPrank(newOrg);
        usdc.approve(address(registry), type(uint256).max);

        registry.subscribe(IVeyroqRegistry.PlanTier.SingleOrg, 1);
        uint256 firstExpiry = block.timestamp + 30 days;

        // Attempting to subscribe again during the active 30-day window reverts on-chain
        vm.expectRevert("VeyroqRegistry: Active subscription in progress");
        registry.subscribe(IVeyroqRegistry.PlanTier.SingleOrg, 1);

        vm.expectRevert("VeyroqRegistry: Active subscription in progress");
        registry.subscribe(IVeyroqRegistry.PlanTier.Enterprise, 1);

        // Warp to 1 second before expiry: still active, still reverts
        vm.warp(firstExpiry - 1);
        vm.expectRevert("VeyroqRegistry: Active subscription in progress");
        registry.subscribe(IVeyroqRegistry.PlanTier.SingleOrg, 1);

        // Warp to exact 30-day completion: automatically opted out (PlanTier.Free, isActive == false)
        vm.warp(firstExpiry);
        (IVeyroqRegistry.PlanTier expiredTier, , bool expiredActive) = registry.getSubscription(newOrg);
        assertEq(uint256(expiredTier), uint256(IVeyroqRegistry.PlanTier.Free));
        assertFalse(expiredActive);

        // Manual renewal now succeeds for a fresh 30-day countdown
        registry.subscribe(IVeyroqRegistry.PlanTier.Enterprise, 1);
        (IVeyroqRegistry.PlanTier renewedTier, uint256 renewedExpiry, bool renewedActive) = registry.getSubscription(newOrg);
        vm.stopPrank();

        assertEq(uint256(renewedTier), uint256(IVeyroqRegistry.PlanTier.Enterprise));
        assertEq(renewedExpiry, block.timestamp + 30 days);
        assertTrue(renewedActive);
    }

    function test_Subscribe_NativeFee() public {
        // Deploy registry with address(0) for usdcToken (native coin payments)
        vm.prank(owner);
        VeyroqRegistry nativeRegistry = new VeyroqRegistry(address(0), treasury, 0, 0.01 ether, 0.1 ether, 0.2 ether);

        address subscriber = address(0x444);
        vm.deal(subscriber, 10 ether);

        uint256 fee = nativeRegistry.enterpriseFee(); // 1 month (30 days)
        vm.prank(subscriber);
        nativeRegistry.subscribe{value: fee}(IVeyroqRegistry.PlanTier.Enterprise, 1);

        (IVeyroqRegistry.PlanTier tier, uint256 expiresAt, bool isActive) = nativeRegistry.getSubscription(subscriber);
        assertEq(uint256(tier), uint256(IVeyroqRegistry.PlanTier.Enterprise));
        assertEq(expiresAt, block.timestamp + 30 days);
        assertTrue(isActive);
    }

    function test_RevertIf_Subscribe_ZeroMonths() public {
        address unsub = address(0x32);
        vm.prank(unsub);
        vm.expectRevert("VeyroqRegistry: Invalid duration");
        registry.subscribe(IVeyroqRegistry.PlanTier.Enterprise, 0);
    }

    function test_RevertIf_Subscribe_MultiMonthBlocked() public {
        address unsub = address(0x33);
        vm.prank(unsub);
        vm.expectRevert("VeyroqRegistry: Invalid duration");
        registry.subscribe(IVeyroqRegistry.PlanTier.Enterprise, 2);
    }

    function test_RevertIf_Subscribe_ValueSentForERC20() public {
        address unsub = address(0x34);
        vm.deal(unsub, 1 ether);
        vm.prank(unsub);
        vm.expectRevert("VeyroqRegistry: Value not accepted for ERC20 fee");
        registry.subscribe{value: 0.1 ether}(IVeyroqRegistry.PlanTier.Enterprise, 1);
    }

    function test_RevertIf_FreeTierCommitsProof() public {
        address freeOrg = address(0x50);
        usdc.mint(freeOrg, 1_000 * 10 ** 6);
        vm.startPrank(freeOrg);
        usdc.approve(address(registry), type(uint256).max);

        vm.expectRevert("VeyroqRegistry: Active paid subscription required");
        registry.commitAuditProof(freeOrg, keccak256("ROOT"), 100, 200, 5, bytes32(0));
        vm.stopPrank();
    }

    function test_RevertIf_FreeTierAuthorizesAuditor() public {
        address freeOrg = address(0x51);
        vm.prank(freeOrg);
        vm.expectRevert("VeyroqRegistry: Enterprise or Partner subscription required");
        registry.authorizeAuditor(auditor, block.timestamp + 30 days, bytes32(0));
    }

    function test_RevertIf_AuthorizeNonPartnerAuditor() public {
        address nonPartnerAuditor = address(0x52);
        vm.prank(organization);
        vm.expectRevert("VeyroqRegistry: Auditor must have active Partner subscription");
        registry.authorizeAuditor(nonPartnerAuditor, block.timestamp + 30 days, bytes32(0));
    }

    function test_RevertIf_ExpiredPartnerAuditorCommitsProof() public {
        // Authorize auditor for 60 days while both subscriptions are active
        vm.prank(organization);
        registry.authorizeAuditor(auditor, block.timestamp + 60 days, bytes32(0));

        // Fast-forward 31 days so auditor's 30-day Partner subscription expires while authorization is still valid
        vm.warp(block.timestamp + 31 days);

        // Organization manually renews its 30-day subscription, but auditor does NOT renew
        vm.prank(organization);
        registry.subscribe(IVeyroqRegistry.PlanTier.Enterprise, 1);

        vm.prank(auditor);
        vm.expectRevert("VeyroqRegistry: Submitting firm requires active Partner subscription");
        registry.commitAuditProof(organization, keccak256("ROOT"), 100, 200, 5, bytes32(0));
    }

    function test_Admin_SetTierFees() public {
        vm.prank(owner);
        registry.setTierFees(9 * 10 ** 6, 499 * 10 ** 6, 1499 * 10 ** 6);

        assertEq(registry.singleOrgFee(), 9 * 10 ** 6);
        assertEq(registry.enterpriseFee(), 499 * 10 ** 6);
        assertEq(registry.partnerFee(), 1499 * 10 ** 6);

        // Unauthorized caller reverts
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.setTierFees(1, 2, 3);
    }

    function test_Admin_MigrateSubscription() public {
        address cleanRecoveryWallet = address(0x70);
        usdc.mint(cleanRecoveryWallet, 1_000 * 10 ** 6);
        vm.prank(cleanRecoveryWallet);
        usdc.approve(address(registry), type(uint256).max);

        (, uint256 originalExpiry, ) = registry.getSubscription(organization);

        // Admin migrates subscription from compromised organization wallet to cleanRecoveryWallet
        vm.prank(owner);
        registry.adminMigrateSubscription(organization, cleanRecoveryWallet);

        // Old compromised wallet is immediately wiped
        (IVeyroqRegistry.PlanTier oldTier, uint256 oldExpiry, bool oldActive) = registry.getSubscription(organization);
        assertEq(uint256(oldTier), uint256(IVeyroqRegistry.PlanTier.Free));
        assertEq(oldExpiry, 0);
        assertFalse(oldActive);

        // Compromised wallet can no longer commit proofs
        vm.prank(organization);
        vm.expectRevert("VeyroqRegistry: Active paid subscription required");
        registry.commitAuditProof(organization, keccak256("ROOT"), 100, 200, 5, bytes32(0));

        // Clean recovery wallet now holds the exact remaining subscription and can commit proofs
        (IVeyroqRegistry.PlanTier newTier, uint256 newExpiry, bool newActive) = registry.getSubscription(cleanRecoveryWallet);
        assertEq(uint256(newTier), uint256(IVeyroqRegistry.PlanTier.Enterprise));
        assertEq(newExpiry, originalExpiry);
        assertTrue(newActive);

        vm.prank(cleanRecoveryWallet);
        uint256 proofId = registry.commitAuditProof(cleanRecoveryWallet, keccak256("RECOVERED_ROOT"), 100, 200, 5, bytes32(0));
        assertEq(proofId, 0);
    }

    function test_RevertIf_MigrateSubscription_InvalidOrUnauthorized() public {
        address cleanWallet = address(0x71);

        // Non-owner cannot call
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.adminMigrateSubscription(organization, cleanWallet);

        // Zero address checks
        vm.startPrank(owner);
        vm.expectRevert("VeyroqRegistry: Invalid wallet");
        registry.adminMigrateSubscription(address(0), cleanWallet);

        vm.expectRevert("VeyroqRegistry: Invalid wallet");
        registry.adminMigrateSubscription(organization, address(0));

        // Same wallet check
        vm.expectRevert("VeyroqRegistry: Same wallet");
        registry.adminMigrateSubscription(organization, organization);

        // No active subscription on source wallet
        vm.expectRevert("VeyroqRegistry: No active subscription to migrate");
        registry.adminMigrateSubscription(cleanWallet, address(0x72));

        // Target wallet already has an active subscription (e.g. auditor)
        vm.expectRevert("VeyroqRegistry: Target already subscribed");
        registry.adminMigrateSubscription(organization, auditor);
        vm.stopPrank();
    }

    function testFuzz_Subscription30DayLockAndRenewal(uint8 tierSeed, uint32 elapsedBeforeRetry) public {
        uint8 tierIdx = (tierSeed % 3) + 1; // 1 = SingleOrg, 2 = Enterprise, 3 = Partner
        IVeyroqRegistry.PlanTier chosenTier = IVeyroqRegistry.PlanTier(tierIdx);

        address fuzzedSubscriber = address(0x60);
        usdc.mint(fuzzedSubscriber, 50_000 * 10 ** 6);
        vm.startPrank(fuzzedSubscriber);
        usdc.approve(address(registry), type(uint256).max);
        registry.subscribe(chosenTier, 1);

        uint256 startTs = block.timestamp;
        (, uint256 expiresAt, bool isActive) = registry.getSubscription(fuzzedSubscriber);
        assertEq(expiresAt, startTs + 30 days);
        assertTrue(isActive);

        // Any time strictly before 30 days elapse must revert on duplicate subscription attempt
        uint256 insideWindow = startTs + (uint256(elapsedBeforeRetry) % 30 days);
        vm.warp(insideWindow);
        vm.expectRevert("VeyroqRegistry: Active subscription in progress");
        registry.subscribe(chosenTier, 1);

        // At 30 days elapsed, subscription opts out automatically and manual renewal succeeds
        vm.warp(startTs + 30 days);
        (, , bool activeAt30d) = registry.getSubscription(fuzzedSubscriber);
        assertFalse(activeAt30d);

        registry.subscribe(chosenTier, 1);
        (, uint256 newExpiresAt, bool activeAfterRenew) = registry.getSubscription(fuzzedSubscriber);
        assertEq(newExpiresAt, block.timestamp + 30 days);
        assertTrue(activeAfterRenew);
        vm.stopPrank();
    }

    // ─── On-Chain Hardening & Self-Custodial Access Tests ────────────────────

    function test_Owner_CanSelfSubscribe() public {
        usdc.mint(owner, 1_000 * 10 ** 6);
        vm.startPrank(owner);
        usdc.approve(address(registry), type(uint256).max);
        registry.subscribe(IVeyroqRegistry.PlanTier.Enterprise, 1);
        vm.stopPrank();

        (IVeyroqRegistry.PlanTier tier, , bool isActive) = registry.getSubscription(owner);
        assertEq(uint256(tier), uint256(IVeyroqRegistry.PlanTier.Enterprise));
        assertTrue(isActive);
    }

    function test_RevertIf_SingleOrgAuthorizesExternalAuditor() public {
        address singleOrg = address(0x53);
        usdc.mint(singleOrg, 100 * 10 ** 6);
        vm.startPrank(singleOrg);
        usdc.approve(address(registry), type(uint256).max);
        registry.subscribe(IVeyroqRegistry.PlanTier.SingleOrg, 1);

        // SingleOrg CAN commit its own audit proof
        uint256 proofId = registry.commitAuditProof(singleOrg, keccak256("SINGLE_ORG_ROOT"), 100, 200, 3, bytes32(0));
        assertEq(proofId, 0);

        // SingleOrg CANNOT delegate external Big-4 auditors on-chain
        vm.expectRevert("VeyroqRegistry: Enterprise or Partner subscription required");
        registry.authorizeAuditor(auditor, block.timestamp + 30 days, bytes32(0));
        vm.stopPrank();
    }

    function test_RevertIf_SelfAuthorizeAuditor() public {
        vm.prank(auditor);
        vm.expectRevert("VeyroqRegistry: Cannot self-authorize");
        registry.authorizeAuditor(auditor, block.timestamp + 30 days, bytes32(0));
    }

    function test_Ownable2Step_TwoStepOwnershipTransfer() public {
        vm.prank(owner);
        registry.transferOwnership(newOwnerCandidate);
        assertEq(registry.pendingOwner(), newOwnerCandidate);
        assertEq(registry.owner(), owner);

        vm.prank(newOwnerCandidate);
        registry.acceptOwnership();
        assertEq(registry.owner(), newOwnerCandidate);
    }
}
