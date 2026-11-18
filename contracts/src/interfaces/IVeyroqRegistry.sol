// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IVeyroqRegistry
 * @notice Interface for Veyroq's Institutional Audit Registry on Arc.
 * Anchors cryptographic Merkle completeness proofs and manages scoped auditor authorizations.
 */
interface IVeyroqRegistry {
    enum PlanTier { Free, SingleOrg, Enterprise, Partner }

    struct AuditorPermission {
        bool isAuthorized;
        uint256 validUntil;
        bytes32 scopeHash; // Hash of the agreed audit engagement scope
    }

    struct Subscription {
        PlanTier tier;
        uint256 expiresAt;
    }

    struct AuditCommitment {
        bytes32 auditRootHash;     // Merkle Root of all decrypted transactions in the period
        uint256 periodStart;       // Unix timestamp of period start
        uint256 periodEnd;         // Unix timestamp of period end
        uint256 transactionCount;  // Total verified transactions in the audit
        bytes32 metadataHash;      // IPFS/Arweave or SHA-256 hash of auditor certification metadata
        uint256 timestamp;         // Block timestamp of commitment
        address submitter;         // Auditor or organization that committed the proof
    }

    // Events
    event AuditorAuthorized(
        address indexed organization,
        address indexed auditor,
        uint256 validUntil,
        bytes32 scopeHash
    );

    event AuditorRevoked(
        address indexed organization,
        address indexed auditor
    );

    event AuditProofCommitted(
        address indexed organization,
        address indexed submitter,
        bytes32 indexed auditRootHash,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 transactionCount,
        uint256 feePaid
    );

    event TreasuryUpdated(address indexed newTreasury);
    event FeeUpdated(uint256 newFee);
    event USDCTokenUpdated(address indexed newUsdc);
    event Subscribed(
        address indexed organization,
        PlanTier tier,
        uint256 expiresAt,
        uint256 feePaid
    );
    event TierFeesUpdated(uint256 newSingleOrgFee, uint256 newEnterpriseFee, uint256 newPartnerFee);
    event SubscriptionMigrated(
        address indexed oldWallet,
        address indexed newWallet,
        PlanTier tier,
        uint256 expiresAt
    );

    // Core Functions
    function subscribe(PlanTier tier, uint256 months) external payable;
    function getSubscription(address organization) external view returns (PlanTier tier, uint256 expiresAt, bool isActive);
    function adminMigrateSubscription(address oldWallet, address newWallet) external;
    function authorizeAuditor(address auditor, uint256 validUntil, bytes32 scopeHash) external;
    function revokeAuditor(address auditor) external;
    function commitAuditProof(
        address organization,
        bytes32 auditRootHash,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 transactionCount,
        bytes32 metadataHash
    ) external payable returns (uint256 proofId);

    function verifyTransactionInclusion(
        address organization,
        uint256 proofId,
        bytes32 leafHash,
        bytes32[] calldata merkleProof
    ) external view returns (bool);

    function verifyBatchInclusion(
        address organization,
        uint256 proofId,
        bytes32[] calldata leafHashes,
        bytes32[][] calldata merkleProofs
    ) external view returns (bool[] memory results);

    function isAuditorAuthorized(address organization, address auditor) external view returns (bool);
    function getAuditCommitment(address organization, uint256 proofId) external view returns (AuditCommitment memory);
    function getAuditCommitments(address organization, uint256 offset, uint256 limit) external view returns (AuditCommitment[] memory);
    function getCommitmentCount(address organization) external view returns (uint256);
}
