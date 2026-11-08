// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IVeyroqRegistry.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VeyroqRegistry
 * @notice Institutional Audit Registry & Proof Commitment Engine for Circle's Arc Privacy Sector.
 * Enables enterprises to register scoped auditor permissions, anchor Merkle completeness proofs,
 * and verify on-chain that decrypted tax/audit line items were not omitted or tampered with.
 */
contract VeyroqRegistry is IVeyroqRegistry, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Optional ERC-20 USDC token reference (can be address(0) for native gas USDC)
    IERC20 public usdcToken;
    address public treasury;

    // Protocol registration fee in native units (or USDC 6-decimal units)
    uint256 public protocolFee;

    // On-chain subscription tier fees (USDC 6-decimal units or native)
    uint256 public enterpriseFee;
    uint256 public partnerFee;

    // Mapping: Organization => Active Subscription
    mapping(address => Subscription) public subscriptions;

    // Mapping: Organization => (Auditor => Permission)
    mapping(address => mapping(address => AuditorPermission)) public auditorPermissions;

    // Mapping: Organization => Array of committed audit proofs
    mapping(address => AuditCommitment[]) private _auditHistory;

    /**
     * @param _usdcToken Address of the ERC-20 USDC contract on Arc (or address(0) for native msg.value)
     * @param _treasury Treasury address collecting Veyroq protocol audit anchoring fees
     * @param _protocolFee Initial protocol anchoring fee (per committed proof)
     * @param _enterpriseFee Initial monthly subscription fee for Enterprise Treasury tier
     * @param _partnerFee Initial monthly subscription fee for Audit Firm Partner tier
     */
    constructor(
        address _usdcToken,
        address _treasury,
        uint256 _protocolFee,
        uint256 _enterpriseFee,
        uint256 _partnerFee
    ) Ownable(msg.sender) {
        require(_treasury != address(0), "VeyroqRegistry: Invalid treasury");
        usdcToken = IERC20(_usdcToken);
        treasury = _treasury;
        protocolFee = _protocolFee;
        enterpriseFee = _enterpriseFee;
        partnerFee = _partnerFee;
    }

    /**
     * @notice Purchases or extends an on-chain tier subscription for an organization.
     * Strictly enforces Checks-Effects-Interactions (CEI).
     * @param tier PlanTier.Enterprise or PlanTier.Partner
     * @param months Duration in 30-day billing intervals (1 to 12 months)
     */
    function subscribe(
        PlanTier tier,
        uint256 months
    ) external payable override nonReentrant {
        // 1. CHECKS
        require(tier == PlanTier.Enterprise || tier == PlanTier.Partner, "VeyroqRegistry: Invalid tier");
        require(months > 0 && months <= 12, "VeyroqRegistry: Invalid duration");

        uint256 monthlyFee = (tier == PlanTier.Enterprise) ? enterpriseFee : partnerFee;
        uint256 totalFee = monthlyFee * months;

        // Payment validation
        if (address(usdcToken) != address(0)) {
            require(msg.value == 0, "VeyroqRegistry: Value not accepted for ERC20 fee");
        } else {
            require(msg.value == totalFee, "VeyroqRegistry: Incorrect native fee paid");
        }

        // 2. EFFECTS (Update state prior to external token transfers)
        uint256 currentExpiry = subscriptions[msg.sender].expiresAt;
        uint256 startPoint = (currentExpiry > block.timestamp) ? currentExpiry : block.timestamp;
        uint256 newExpiry = startPoint + (months * 30 days);

        subscriptions[msg.sender] = Subscription({
            tier: tier,
            expiresAt: newExpiry
        });

        emit Subscribed(msg.sender, tier, newExpiry, totalFee);

        // 3. INTERACTIONS (Token transfers or native fee forwarding)
        if (totalFee > 0) {
            if (address(usdcToken) != address(0)) {
                usdcToken.safeTransferFrom(msg.sender, treasury, totalFee);
            } else {
                (bool success, ) = treasury.call{value: totalFee}("");
                require(success, "VeyroqRegistry: Fee transfer failed");
            }
        }
    }

    /**
     * @notice Queries the active subscription status for an organization.
     */
    function getSubscription(
        address organization
    ) external view override returns (PlanTier tier, uint256 expiresAt, bool isActive) {
        Subscription memory sub = subscriptions[organization];
        bool active = sub.expiresAt >= block.timestamp;
        return (active ? sub.tier : PlanTier.Free, sub.expiresAt, active);
    }

    /**
     * @notice Grants an auditor permission to submit and certify proofs for the calling organization.
     * @param auditor The address of the accounting firm or auditor
     * @param validUntil Timestamp after which the authorization expires
     * @param scopeHash Hash of the agreed engagement letter or audit scope
     */
    function authorizeAuditor(
        address auditor,
        uint256 validUntil,
        bytes32 scopeHash
    ) external override {
        require(auditor != address(0), "VeyroqRegistry: Invalid auditor");
        require(validUntil > block.timestamp, "VeyroqRegistry: Expiry in past");

        auditorPermissions[msg.sender][auditor] = AuditorPermission({
            isAuthorized: true,
            validUntil: validUntil,
            scopeHash: scopeHash
        });

        emit AuditorAuthorized(msg.sender, auditor, validUntil, scopeHash);
    }

    /**
     * @notice Revokes an auditor's authorization immediately.
     */
    function revokeAuditor(address auditor) external override {
        require(auditor != address(0), "VeyroqRegistry: Invalid auditor");

        auditorPermissions[msg.sender][auditor].isAuthorized = false;

        emit AuditorRevoked(msg.sender, auditor);
    }

    /**
     * @notice Commits an audited Merkle root hash for an organization.
     * Must be called either by the organization itself or by an authorized auditor.
     * Strictly enforces Checks-Effects-Interactions (CEI).
     */
    function commitAuditProof(
        address organization,
        bytes32 auditRootHash,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 transactionCount,
        bytes32 metadataHash
    ) external payable override nonReentrant returns (uint256 proofId) {
        // 1. CHECKS
        require(organization != address(0), "VeyroqRegistry: Invalid organization");
        require(auditRootHash != bytes32(0), "VeyroqRegistry: Invalid root hash");
        require(periodEnd >= periodStart, "VeyroqRegistry: Invalid period range");
        require(transactionCount > 0, "VeyroqRegistry: Zero transactions");

        // Submitter authorization: must be organization itself or an authorized auditor
        if (msg.sender != organization) {
            AuditorPermission memory perm = auditorPermissions[organization][msg.sender];
            require(
                perm.isAuthorized && perm.validUntil >= block.timestamp,
                "VeyroqRegistry: Submitter unauthorized"
            );
        }

        // Validate value transfer semantics to prevent trapped native coins
        if (address(usdcToken) != address(0)) {
            require(msg.value == 0, "VeyroqRegistry: Value not accepted for ERC20 fee");
        } else {
            if (protocolFee > 0) {
                require(msg.value == protocolFee, "VeyroqRegistry: Incorrect native fee paid");
            } else {
                require(msg.value == 0, "VeyroqRegistry: Zero fee expected");
            }
        }

        // 2. EFFECTS (Update state prior to external token/coin transfers)
        AuditCommitment memory commitment = AuditCommitment({
            auditRootHash: auditRootHash,
            periodStart: periodStart,
            periodEnd: periodEnd,
            transactionCount: transactionCount,
            metadataHash: metadataHash,
            timestamp: block.timestamp,
            submitter: msg.sender
        });

        _auditHistory[organization].push(commitment);
        proofId = _auditHistory[organization].length - 1;

        emit AuditProofCommitted(
            organization,
            msg.sender,
            auditRootHash,
            periodStart,
            periodEnd,
            transactionCount,
            protocolFee
        );

        // 3. INTERACTIONS (Token transfers or native fee forwarding)
        if (protocolFee > 0) {
            if (address(usdcToken) != address(0)) {
                usdcToken.safeTransferFrom(msg.sender, treasury, protocolFee);
            } else {
                (bool success, ) = treasury.call{value: protocolFee}("");
                require(success, "VeyroqRegistry: Fee transfer failed");
            }
        }
    }

    /**
     * @notice Verifies whether a specific decrypted transaction leaf was included in a committed audit proof.
     * @param organization The audited organization address
     * @param proofId The index of the committed audit proof
     * @param leafHash The cryptographic hash of the decrypted transaction record
     * @param merkleProof The Merkle proof branch proving inclusion
     */
    function verifyTransactionInclusion(
        address organization,
        uint256 proofId,
        bytes32 leafHash,
        bytes32[] calldata merkleProof
    ) external view override returns (bool) {
        require(proofId < _auditHistory[organization].length, "VeyroqRegistry: Proof ID out of bounds");
        bytes32 root = _auditHistory[organization][proofId].auditRootHash;
        return MerkleProof.verify(merkleProof, root, leafHash);
    }

    /**
     * @notice Verifies batch line-item inclusions in a single on-chain call.
     */
    function verifyBatchInclusion(
        address organization,
        uint256 proofId,
        bytes32[] calldata leafHashes,
        bytes32[][] calldata merkleProofs
    ) external view override returns (bool[] memory results) {
        require(proofId < _auditHistory[organization].length, "VeyroqRegistry: Proof ID out of bounds");
        require(leafHashes.length == merkleProofs.length, "VeyroqRegistry: Length mismatch");

        bytes32 root = _auditHistory[organization][proofId].auditRootHash;
        results = new bool[](leafHashes.length);
        for (uint256 i = 0; i < leafHashes.length; i++) {
            results[i] = MerkleProof.verify(merkleProofs[i], root, leafHashes[i]);
        }
    }

    /**
     * @notice Checks if an auditor is currently authorized for an organization.
     */
    function isAuditorAuthorized(
        address organization,
        address auditor
    ) external view override returns (bool) {
        AuditorPermission memory perm = auditorPermissions[organization][auditor];
        return perm.isAuthorized && perm.validUntil >= block.timestamp;
    }

    /**
     * @notice Retrieves a specific audit commitment record.
     */
    function getAuditCommitment(
        address organization,
        uint256 proofId
    ) external view override returns (AuditCommitment memory) {
        require(proofId < _auditHistory[organization].length, "VeyroqRegistry: Proof ID out of bounds");
        return _auditHistory[organization][proofId];
    }

    /**
     * @notice Paginated retrieval of audit commitments for corporate treasury exports.
     */
    function getAuditCommitments(
        address organization,
        uint256 offset,
        uint256 limit
    ) external view override returns (AuditCommitment[] memory) {
        uint256 total = _auditHistory[organization].length;
        if (offset >= total) {
            return new AuditCommitment[](0);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 size = end - offset;
        AuditCommitment[] memory batch = new AuditCommitment[](size);
        for (uint256 i = 0; i < size; i++) {
            batch[i] = _auditHistory[organization][offset + i];
        }
        return batch;
    }

    /**
     * @notice Returns total number of audit commitments registered for an organization.
     */
    function getCommitmentCount(address organization) external view override returns (uint256) {
        return _auditHistory[organization].length;
    }

    // Admin configuration
    function setProtocolFee(uint256 newFee) external onlyOwner {
        protocolFee = newFee;
        emit FeeUpdated(newFee);
    }

    function setTierFees(uint256 newEnterpriseFee, uint256 newPartnerFee) external onlyOwner {
        enterpriseFee = newEnterpriseFee;
        partnerFee = newPartnerFee;
        emit TierFeesUpdated(newEnterpriseFee, newPartnerFee);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "VeyroqRegistry: Invalid treasury");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setUSDCToken(address newUsdc) external onlyOwner {
        usdcToken = IERC20(newUsdc);
        emit USDCTokenUpdated(newUsdc);
    }

    /**
     * @notice Emergency rescue for accidentally sent ERC-20 tokens.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "VeyroqRegistry: Invalid recipient");
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Emergency rescue for accidentally sent native gas coins.
     */
    function rescueNative(address payable to) external onlyOwner {
        require(to != address(0), "VeyroqRegistry: Invalid recipient");
        uint256 balance = address(this).balance;
        (bool success, ) = to.call{value: balance}("");
        require(success, "VeyroqRegistry: Rescue failed");
    }
}
