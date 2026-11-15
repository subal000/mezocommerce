// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMerchantPaymentProcessor} from "./interfaces/IMerchantPaymentProcessor.sol";

/// @title MerchantPaymentProcessor (MezoCommerce)
/// @notice Non-custodial checkout for MUSD on Mezo. A customer submits an intent signed (EIP-712) by one of the
///         merchant's allowed signers; the contract checks it and moves exactly `intent.amount` from the customer
///         straight to the merchant's payout address. It never holds tokens and has no withdrawal function.
/// @dev NOT AUDITED. See docs/notes-contracts.md for the threat list.
///
///      All intent state (paid, cancelled, payment record) is keyed by (merchantId, paymentId). registerMerchant is
///      open to anyone and paymentIds are public (checkout links, mempool), so a global key would let any registered
///      merchant pay or cancel another merchant's paymentId first and block the real customer.
contract MerchantPaymentProcessor is IMerchantPaymentProcessor, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice Payout cannot be this contract or a supported token (funds sent there could not be recovered).
    error InvalidPayout();
    /// @notice Ownership cannot be renounced: pause and the token allowlist must stay reachable.
    error RenounceDisabled();

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "PaymentIntent(bytes32 paymentId,uint256 merchantId,address payout,address token,uint256 amount,address payer,uint64 expiresAt)"
    );

    uint256 private _merchantCount;
    mapping(uint256 merchantId => Merchant) private _merchants;
    mapping(uint256 merchantId => mapping(address signer => bool)) private _signers;
    mapping(address token => bool) private _supportedTokens;
    mapping(uint256 merchantId => mapping(bytes32 paymentId => IntentState)) private _states;
    mapping(uint256 merchantId => mapping(bytes32 paymentId => PaymentRecord)) private _payments;

    /// @param initialOwner Admin (Ownable2Step). Can only toggle tokens and pause new payments.
    /// @param supportedTokens Tokens accepted from day one (MUSD).
    constructor(address initialOwner, address[] memory supportedTokens)
        Ownable(initialOwner)
        EIP712("MezoCommerce", "1")
    {
        for (uint256 i = 0; i < supportedTokens.length; ++i) {
            _setTokenSupported(supportedTokens[i], true);
        }
    }

    // ───────────── merchant management ─────────────

    modifier onlyMerchantOwner(uint256 merchantId) {
        address o = _merchants[merchantId].owner;
        if (o == address(0)) revert UnknownMerchant();
        if (o != msg.sender) revert NotMerchantOwner();
        _;
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function registerMerchant(address payout, address initialSigner) external returns (uint256 merchantId) {
        _checkPayout(payout);
        merchantId = ++_merchantCount;
        _merchants[merchantId] = Merchant({owner: msg.sender, payout: payout, active: true});
        emit MerchantRegistered(merchantId, msg.sender, payout);
        if (initialSigner != address(0)) {
            _signers[merchantId][initialSigner] = true;
            emit SignerUpdated(merchantId, initialSigner, true);
        }
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function setPayout(uint256 merchantId, address payout) external onlyMerchantOwner(merchantId) {
        _checkPayout(payout);
        _merchants[merchantId].payout = payout;
        emit PayoutUpdated(merchantId, payout);
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function setSigner(uint256 merchantId, address signer, bool allowed) external onlyMerchantOwner(merchantId) {
        if (signer == address(0)) revert ZeroAddress();
        _signers[merchantId][signer] = allowed;
        emit SignerUpdated(merchantId, signer, allowed);
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function setMerchantActive(uint256 merchantId, bool active) external onlyMerchantOwner(merchantId) {
        _merchants[merchantId].active = active;
        emit MerchantStatusUpdated(merchantId, active);
    }

    // ───────────── payments ─────────────

    /// @inheritdoc IMerchantPaymentProcessor
    function pay(PaymentIntent calldata intent, bytes calldata signature) external nonReentrant whenNotPaused {
        _pay(intent, signature);
    }

    /// @inheritdoc IMerchantPaymentProcessor
    /// @dev The permit is for exactly `intent.amount`. If someone front-runs the permit (it is public in the mempool),
    ///      the call here fails, is ignored, and the allowance the front-runner already set is used. The permit is
    ///      skipped when the payer's allowance already covers the amount, so a larger standing approval is kept.
    function payWithPermit(
        PaymentIntent calldata intent,
        bytes calldata signature,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        // Only call into allowlisted tokens; an unsupported token falls through to _pay's UnsupportedToken.
        if (
            _supportedTokens[intent.token]
                && _readUint(intent.token, abi.encodeCall(IERC20.allowance, (msg.sender, address(this))))
                    < intent.amount
        ) {
            try IERC20Permit(intent.token).permit(msg.sender, address(this), intent.amount, permitDeadline, v, r, s) {}
                catch {}
        }
        _pay(intent, signature);
    }

    /// @inheritdoc IMerchantPaymentProcessor
    /// @dev Allowed while paused. Scoped to `merchantId` (see contract notes).
    function cancelPayment(uint256 merchantId, bytes32 paymentId) external {
        Merchant storage m = _merchants[merchantId];
        if (m.owner == address(0)) revert UnknownMerchant();
        if (msg.sender != m.owner && !_signers[merchantId][msg.sender]) revert NotAuthorized();
        IntentState st = _states[merchantId][paymentId];
        if (st == IntentState.Paid) revert IntentAlreadyPaid();
        if (st == IntentState.Cancelled) revert IntentCancelled();

        _states[merchantId][paymentId] = IntentState.Cancelled;
        emit PaymentCancelled(paymentId, merchantId, msg.sender);
    }

    /// @inheritdoc IMerchantPaymentProcessor
    /// @dev Allowed while paused. Tokens go from msg.sender to the recorded payer; nothing passes through here.
    function refund(uint256 merchantId, bytes32 paymentId, uint256 amount) external nonReentrant {
        if (_states[merchantId][paymentId] != IntentState.Paid) revert NotPaid();
        PaymentRecord storage rec = _payments[merchantId][paymentId];
        Merchant storage m = _merchants[merchantId];
        if (msg.sender != m.owner && msg.sender != m.payout) revert NotAuthorized();
        if (amount == 0) revert InvalidAmount();
        uint256 total = uint256(rec.refunded) + amount;
        if (total > rec.amount) revert RefundExceedsPayment();

        // forge-lint: disable-next-line(unsafe-typecast)
        rec.refunded = uint128(total); // safe: total <= rec.amount <= uint128 max
        IERC20(rec.token).safeTransferFrom(msg.sender, rec.payer, amount);
        emit RefundCompleted(paymentId, merchantId, rec.payer, msg.sender, amount, total);
    }

    // ───────────── admin ─────────────

    /// @inheritdoc IMerchantPaymentProcessor
    function setTokenSupported(address token, bool supported) external onlyOwner {
        _setTokenSupported(token, supported);
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function pause() external onlyOwner {
        _pause();
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Disabled. Without an owner, pause and the token allowlist could never be used again.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ───────────── views ─────────────

    /// @inheritdoc IMerchantPaymentProcessor
    function merchant(uint256 merchantId) external view returns (Merchant memory) {
        return _merchants[merchantId];
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function merchantCount() external view returns (uint256) {
        return _merchantCount;
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function isSigner(uint256 merchantId, address signer) public view returns (bool) {
        return _signers[merchantId][signer];
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function isTokenSupported(address token) external view returns (bool) {
        return _supportedTokens[token];
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function intentState(uint256 merchantId, bytes32 paymentId) external view returns (IntentState) {
        return _states[merchantId][paymentId];
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function payment(uint256 merchantId, bytes32 paymentId) external view returns (PaymentRecord memory) {
        return _payments[merchantId][paymentId];
    }

    /// @inheritdoc IMerchantPaymentProcessor
    function hashIntent(PaymentIntent calldata intent) public view returns (bytes32) {
        // All fields are static, so abi.encode(struct) == abi.encode(field1, ..., field7).
        return _hashTypedDataV4(keccak256(abi.encode(INTENT_TYPEHASH, intent)));
    }

    /// @inheritdoc IMerchantPaymentProcessor
    /// @dev Checks run in this order and the first failure is returned: Paused, InvalidAmount, UnsupportedToken,
    ///      UnknownMerchant, MerchantInactive, PayoutMismatch, AlreadyPaid, Cancelled, Expired, WrongPayer,
    ///      BadSignature, InsufficientBalance, InsufficientAllowance. The allowance check does not know about permit:
    ///      a checkout that will use `payWithPermit` should treat InsufficientAllowance as Ok.
    function checkPayment(PaymentIntent calldata intent, bytes calldata signature, address payerAddr)
        external
        view
        returns (PayCheck)
    {
        if (paused()) return PayCheck.Paused;
        if (intent.amount == 0 || intent.amount > type(uint128).max) return PayCheck.InvalidAmount;
        if (!_supportedTokens[intent.token]) return PayCheck.UnsupportedToken;
        Merchant storage m = _merchants[intent.merchantId];
        if (m.owner == address(0)) return PayCheck.UnknownMerchant;
        if (!m.active) return PayCheck.MerchantInactive;
        if (intent.payout != m.payout || intent.payout == intent.token) return PayCheck.PayoutMismatch;
        IntentState st = _states[intent.merchantId][intent.paymentId];
        if (st == IntentState.Paid) return PayCheck.AlreadyPaid;
        if (st == IntentState.Cancelled) return PayCheck.Cancelled;
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > intent.expiresAt) return PayCheck.Expired;
        if (intent.payer != address(0) && intent.payer != payerAddr) return PayCheck.WrongPayer;
        if (!_validSignature(intent, signature)) return PayCheck.BadSignature;
        if (_readUint(intent.token, abi.encodeCall(IERC20.balanceOf, (payerAddr))) < intent.amount) {
            return PayCheck.InsufficientBalance;
        }
        if (_readUint(intent.token, abi.encodeCall(IERC20.allowance, (payerAddr, address(this)))) < intent.amount) {
            return PayCheck.InsufficientAllowance;
        }
        return PayCheck.Ok;
    }

    // ───────────── internals ─────────────

    /// @dev All checks, then effects (state + record), then the single external transfer.
    function _pay(PaymentIntent calldata intent, bytes calldata signature) private {
        if (intent.amount == 0 || intent.amount > type(uint128).max) revert InvalidAmount();
        if (!_supportedTokens[intent.token]) revert UnsupportedToken();
        Merchant storage m = _merchants[intent.merchantId];
        if (m.owner == address(0)) revert UnknownMerchant();
        if (!m.active) revert MerchantInactive();
        if (intent.payout != m.payout) revert PayoutMismatch();
        // A token added to the allowlist after the payout was set: never send a token to its own contract.
        if (intent.payout == intent.token) revert InvalidPayout();
        IntentState st = _states[intent.merchantId][intent.paymentId];
        if (st == IntentState.Paid) revert IntentAlreadyPaid();
        if (st == IntentState.Cancelled) revert IntentCancelled();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > intent.expiresAt) revert IntentExpired(); // seconds-level skew is acceptable
        if (intent.payer != address(0) && intent.payer != msg.sender) revert WrongPayer();
        if (!_validSignature(intent, signature)) revert BadSignature();

        _states[intent.merchantId][intent.paymentId] = IntentState.Paid;
        _payments[intent.merchantId][intent.paymentId] = PaymentRecord({
            merchantId: intent.merchantId,
            payer: msg.sender,
            token: intent.token,
            amount: uint128(intent.amount), // bounded above
            refunded: 0,
            paidAt: uint64(block.timestamp)
        });

        IERC20(intent.token).safeTransferFrom(msg.sender, intent.payout, intent.amount);
        emit PaymentCompleted(
            intent.paymentId, intent.merchantId, msg.sender, intent.payout, intent.token, intent.amount, block.timestamp
        );
    }

    /// @dev ECDSA.tryRecover rejects malformed lengths, high-s (malleable) and invalid v; any failure is "bad".
    ///      address(0) can never be a signer (setSigner rejects it), so a zero recovery fails the isSigner check.
    function _validSignature(PaymentIntent calldata intent, bytes calldata signature) private view returns (bool) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashIntent(intent), signature);
        return err == ECDSA.RecoverError.NoError && _signers[intent.merchantId][signer];
    }

    /// @dev Static call that never reverts; a failed or short return reads as 0.
    function _readUint(address token, bytes memory data) private view returns (uint256 v) {
        (bool ok, bytes memory ret) = token.staticcall(data);
        if (ok && ret.length >= 32) v = abi.decode(ret, (uint256));
    }

    function _checkPayout(address payout) private view {
        if (payout == address(0)) revert ZeroAddress();
        if (payout == address(this) || _supportedTokens[payout]) revert InvalidPayout();
    }

    function _setTokenSupported(address token, bool supported) private {
        if (token == address(0)) revert ZeroAddress();
        _supportedTokens[token] = supported;
        emit TokenSupportUpdated(token, supported);
    }
}
