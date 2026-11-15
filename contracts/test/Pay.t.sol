// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {BaseTest} from "./Base.t.sol";
import {MerchantPaymentProcessor} from "../src/MerchantPaymentProcessor.sol";
import {IMerchantPaymentProcessor as IMPP} from "../src/interfaces/IMerchantPaymentProcessor.sol";
import {ReturnsFalseToken, FeeOnTransferToken, ReentrantToken} from "./mocks/BadTokens.sol";

contract PayTest is BaseTest {
    bytes32 internal constant ID = keccak256("order-1");

    // ───────────── happy path ─────────────

    function test_pay_movesExactAmountToPayout() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        uint256 payerBefore = musd.balanceOf(payer);

        _approve(payer, i.amount);
        bytes memory sig = _sign(i);
        vm.expectEmit(address(proc));
        emit IMPP.PaymentCompleted(ID, mid, payer, payout, address(musd), AMOUNT, block.timestamp);
        vm.prank(payer);
        proc.pay(i, sig);

        assertEq(musd.balanceOf(payout), AMOUNT, "payout");
        assertEq(musd.balanceOf(payer), payerBefore - AMOUNT, "payer");
        assertEq(musd.balanceOf(address(proc)), 0, "processor holds nothing");
        assertEq(musd.allowance(payer, address(proc)), 0, "exact allowance consumed");
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Paid));

        IMPP.PaymentRecord memory r = proc.payment(mid, ID);
        assertEq(r.merchantId, mid);
        assertEq(r.payer, payer);
        assertEq(r.token, address(musd));
        assertEq(r.amount, AMOUNT);
        assertEq(r.refunded, 0);
        assertEq(r.paidAt, block.timestamp);
    }

    function test_hashIntent_matchesIndependentDigest() public view {
        IMPP.PaymentIntent memory i = _intent(ID);
        assertEq(proc.hashIntent(i), _digest(address(proc), i));
        assertEq(proc.INTENT_TYPEHASH(), INTENT_TYPEHASH);
    }

    function test_pay_lockedPayer_ok() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        i.payer = payer;
        _pay(i);
        assertEq(musd.balanceOf(payout), AMOUNT);
    }

    function test_pay_anyoneCanPayOpenIntent() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        musd.mint(stranger, AMOUNT);
        _approve(stranger, AMOUNT);
        bytes memory sig = _sign(i);
        vm.prank(stranger);
        proc.pay(i, sig);
        assertEq(proc.payment(mid, ID).payer, stranger);
    }

    // ───────────── uniqueness ─────────────

    function test_pay_duplicateId_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        _pay(i);
        _expectPayRevert(i, _sign(i), IMPP.IntentAlreadyPaid.selector);
    }

    function test_pay_sameIdDifferentAmount_reverts() public {
        _pay(_intent(ID));
        IMPP.PaymentIntent memory j = _intent(ID, 1e18);
        _expectPayRevert(j, _sign(j), IMPP.IntentAlreadyPaid.selector);
    }

    function test_pay_cancelledId_reverts() public {
        vm.prank(merchantOwner);
        proc.cancelPayment(mid, ID);
        IMPP.PaymentIntent memory i = _intent(ID);
        _expectPayRevert(i, _sign(i), IMPP.IntentCancelled.selector);
    }

    function test_pay_cancelByOtherMerchant_doesNotBlock() public {
        // Griefing attempt: an unrelated merchant cancels a public paymentId of merchant `mid`.
        vm.prank(stranger);
        uint256 other = proc.registerMerchant(stranger, address(0));
        vm.prank(stranger);
        proc.cancelPayment(other, ID);
        assertEq(uint8(proc.intentState(other, ID)), uint8(IMPP.IntentState.Cancelled));
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.None), "other merchant's cancel is invisible");

        _pay(_intent(ID));
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Paid));
        assertEq(musd.balanceOf(payout), AMOUNT);
    }

    // ───────────── token / amount ─────────────

    function test_pay_unsupportedToken_reverts() public {
        ReturnsFalseToken t = new ReturnsFalseToken();
        IMPP.PaymentIntent memory i = _intent(ID);
        i.token = address(t);
        _expectPayRevert(i, _sign(i), IMPP.UnsupportedToken.selector);
    }

    function test_pay_tokenDelisted_reverts() public {
        vm.prank(admin);
        proc.setTokenSupported(address(musd), false);
        IMPP.PaymentIntent memory i = _intent(ID);
        _expectPayRevert(i, _sign(i), IMPP.UnsupportedToken.selector);
    }

    function test_pay_zeroAmount_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID, 0);
        _expectPayRevert(i, _sign(i), IMPP.InvalidAmount.selector);
    }

    function test_pay_amountAboveUint128_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID, uint256(type(uint128).max) + 1);
        _expectPayRevert(i, _sign(i), IMPP.InvalidAmount.selector);
    }

    // ───────────── tampering ─────────────

    function test_pay_tamperedAmount_badSignature() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        bytes memory sig = _sign(i);
        i.amount = 1e18;
        _expectPayRevert(i, sig, IMPP.BadSignature.selector);
    }

    function test_pay_tamperedFields_badSignature() public {
        IMPP.PaymentIntent memory base = _intent(ID);
        bytes memory sig = _sign(base);

        IMPP.PaymentIntent memory i = _intent(ID);
        i.paymentId = keccak256("other");
        _expectPayRevert(i, sig, IMPP.BadSignature.selector);

        i = _intent(ID);
        i.expiresAt += 1 days;
        _expectPayRevert(i, sig, IMPP.BadSignature.selector);

        i = _intent(ID);
        i.payer = payer; // locking to a payer that wasn't signed
        _expectPayRevert(i, sig, IMPP.BadSignature.selector);

        // merchantId substitution: another merchant with the same payout but where `signer` is not a signer
        vm.prank(stranger);
        uint256 other = proc.registerMerchant(payout, address(0));
        i = _intent(ID);
        i.merchantId = other;
        _expectPayRevert(i, sig, IMPP.BadSignature.selector);
    }

    // ───────────── merchant state ─────────────

    function test_pay_payoutMismatchAfterSetPayout_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        bytes memory sig = _sign(i);
        vm.prank(merchantOwner);
        proc.setPayout(mid, makeAddr("newPayout"));
        _expectPayRevert(i, sig, IMPP.PayoutMismatch.selector);
    }

    function test_pay_signedWrongPayout_reverts() public {
        // A compromised signer cannot redirect funds: payout must equal the merchant's on-chain payout.
        IMPP.PaymentIntent memory i = _intent(ID);
        i.payout = stranger;
        _expectPayRevert(i, _sign(i), IMPP.PayoutMismatch.selector);
    }

    function test_pay_merchantInactive_reverts() public {
        vm.prank(merchantOwner);
        proc.setMerchantActive(mid, false);
        IMPP.PaymentIntent memory i = _intent(ID);
        _expectPayRevert(i, _sign(i), IMPP.MerchantInactive.selector);

        vm.prank(merchantOwner);
        proc.setMerchantActive(mid, true);
        _pay(i);
    }

    function test_pay_unknownMerchant_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        i.merchantId = 999;
        _expectPayRevert(i, _sign(i), IMPP.UnknownMerchant.selector);
        i.merchantId = 0; // ids start at 1
        _expectPayRevert(i, _sign(i), IMPP.UnknownMerchant.selector);
    }

    // ───────────── expiry ─────────────

    function test_pay_atExpiresAt_ok() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        vm.warp(i.expiresAt);
        _pay(i);
    }

    function test_pay_oneSecondAfterExpiry_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        vm.warp(uint256(i.expiresAt) + 1);
        _expectPayRevert(i, _sign(i), IMPP.IntentExpired.selector);
    }

    // ───────────── payer lock ─────────────

    function test_pay_wrongPayer_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        i.payer = stranger;
        _expectPayRevert(i, _sign(i), IMPP.WrongPayer.selector);
    }

    // ───────────── signatures ─────────────

    function test_pay_nonSigner_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        _expectPayRevert(i, _sign(0xBAD, i), IMPP.BadSignature.selector);
    }

    function test_pay_merchantOwnerKeyIsNotASignerByDefault() public {
        (address owner2, uint256 owner2Pk) = makeAddrAndKey("owner2");
        vm.prank(owner2);
        uint256 m2 = proc.registerMerchant(payout, address(0));
        IMPP.PaymentIntent memory i = _intent(ID);
        i.merchantId = m2;
        _expectPayRevert(i, _sign(owner2Pk, i), IMPP.BadSignature.selector);
    }

    function test_pay_revokedSigner_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        bytes memory sig = _sign(i);
        vm.prank(merchantOwner);
        proc.setSigner(mid, signer, false);
        _expectPayRevert(i, sig, IMPP.BadSignature.selector);
    }

    function test_pay_addedSigner_ok() public {
        uint256 pk2 = 0xC0FFEE;
        vm.prank(merchantOwner);
        proc.setSigner(mid, vm.addr(pk2), true);
        IMPP.PaymentIntent memory i = _intent(ID);
        _approve(payer, i.amount);
        bytes memory sig = _sign(pk2, i);
        vm.prank(payer);
        proc.pay(i, sig);
    }

    function test_pay_otherMerchantsSigner_reverts() public {
        uint256 otherPk = 0xD00D;
        vm.prank(stranger);
        proc.registerMerchant(stranger, vm.addr(otherPk));
        IMPP.PaymentIntent memory i = _intent(ID); // merchant `mid`
        _expectPayRevert(i, _sign(otherPk, i), IMPP.BadSignature.selector);
    }

    function test_pay_malformedSignatures_revert() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, _digest(address(proc), i));

        _expectPayRevert(i, "", IMPP.BadSignature.selector);
        _expectPayRevert(i, abi.encodePacked(r, s), IMPP.BadSignature.selector); // 64 bytes (EIP-2098 not accepted)
        _expectPayRevert(i, abi.encodePacked(r, s, v, uint8(0)), IMPP.BadSignature.selector); // 66 bytes
        _expectPayRevert(i, abi.encodePacked(r, s, uint8(29)), IMPP.BadSignature.selector); // bad v

        // Malleable twin (high s): same signer, must be rejected.
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 sHigh = bytes32(n - uint256(s));
        uint8 vFlip = v == 27 ? 28 : 27;
        _expectPayRevert(i, abi.encodePacked(r, sHigh, vFlip), IMPP.BadSignature.selector);

        // The canonical one still works.
        _pay(i);
    }

    function test_pay_crossContractReplay_reverts() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(musd);
        MerchantPaymentProcessor proc2 = new MerchantPaymentProcessor(admin, tokens);
        vm.prank(merchantOwner);
        uint256 mid2 = proc2.registerMerchant(payout, signer);
        assertEq(mid2, mid); // identical merchant id, payout and signer on the second deployment

        IMPP.PaymentIntent memory i = _intent(ID);
        bytes memory sig = _sign(i); // signed for `proc`
        vm.prank(payer);
        musd.approve(address(proc2), i.amount);
        vm.expectRevert(IMPP.BadSignature.selector);
        vm.prank(payer);
        proc2.pay(i, sig);
    }

    function test_pay_crossChainReplay_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        bytes memory sig = _sign(i);
        vm.chainId(1);
        _expectPayRevert(i, sig, IMPP.BadSignature.selector);
    }

    // ───────────── funds ─────────────

    function test_pay_insufficientBalance_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        vm.prank(stranger);
        musd.approve(address(proc), i.amount);
        bytes memory sig = _sign(i);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, stranger, 0, i.amount));
        vm.prank(stranger);
        proc.pay(i, sig);
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.None), "state rolled back");
    }

    function test_pay_insufficientAllowance_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        _approve(payer, i.amount - 1);
        bytes memory sig = _sign(i);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(proc), i.amount - 1, i.amount
            )
        );
        vm.prank(payer);
        proc.pay(i, sig);
    }

    function test_pay_returnsFalseToken_reverts() public {
        ReturnsFalseToken t = new ReturnsFalseToken();
        vm.prank(admin);
        proc.setTokenSupported(address(t), true);
        t.mint(payer, AMOUNT);
        vm.prank(payer);
        t.approve(address(proc), AMOUNT);

        IMPP.PaymentIntent memory i = _intent(ID);
        i.token = address(t);
        bytes memory sig = _sign(i);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(t)));
        vm.prank(payer);
        proc.pay(i, sig);
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.None));
    }

    /// Fee-on-transfer tokens are not supported in production (MUSD only). This documents the semantics if one were:
    /// the payer is debited exactly `amount` and the event reports `amount`; the payout gets what the token delivers.
    function test_pay_feeOnTransfer_exactDebitSemantics() public {
        FeeOnTransferToken t = new FeeOnTransferToken();
        vm.prank(admin);
        proc.setTokenSupported(address(t), true);
        t.mint(payer, 100e18);
        vm.prank(payer);
        t.approve(address(proc), 100e18);

        IMPP.PaymentIntent memory i = _intent(ID, 100e18);
        i.token = address(t);
        bytes memory sig = _sign(i);
        vm.expectEmit(address(proc));
        emit IMPP.PaymentCompleted(ID, mid, payer, payout, address(t), 100e18, block.timestamp);
        vm.prank(payer);
        proc.pay(i, sig);

        assertEq(t.balanceOf(payer), 0, "payer debited exactly amount");
        assertEq(t.balanceOf(payout), 99e18, "payout receives net of token fee");
        assertEq(t.balanceOf(address(proc)), 0);
    }

    // ───────────── reentrancy ─────────────

    function test_pay_reentrancyIntoPay_blocked() public {
        ReentrantToken t = new ReentrantToken();
        vm.prank(admin);
        proc.setTokenSupported(address(t), true);
        t.mint(payer, 10 * AMOUNT);
        vm.prank(payer);
        t.approve(address(proc), type(uint256).max);

        IMPP.PaymentIntent memory inner = _intent(keccak256("inner"));
        inner.token = address(t);
        t.arm(address(proc), abi.encodeCall(proc.pay, (inner, _sign(inner))));

        IMPP.PaymentIntent memory outer = _intent(ID);
        outer.token = address(t);
        bytes memory sig = _sign(outer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(payer);
        proc.pay(outer, sig);
    }

    function test_refund_reentrancyIntoRefund_blocked() public {
        ReentrantToken t = new ReentrantToken();
        vm.prank(admin);
        proc.setTokenSupported(address(t), true);
        t.mint(payer, AMOUNT);
        vm.prank(payer);
        t.approve(address(proc), AMOUNT);
        IMPP.PaymentIntent memory i = _intent(ID);
        i.token = address(t);
        bytes memory sig = _sign(i);
        vm.prank(payer);
        proc.pay(i, sig);

        vm.prank(payout);
        t.approve(address(proc), type(uint256).max);
        t.arm(address(proc), abi.encodeCall(proc.refund, (mid, ID, 1)));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(payout);
        proc.refund(mid, ID, 1);
        assertEq(proc.payment(mid, ID).refunded, 0);
    }

    // ───────────── pause ─────────────

    function test_pause_blocksPayButNotRefundOrCancel() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        _pay(i);

        vm.prank(admin);
        proc.pause();

        IMPP.PaymentIntent memory j = _intent(keccak256("order-2"));
        _expectPayRevert(j, _sign(j), Pausable.EnforcedPause.selector);

        bytes memory sigJ = _sign(j);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(payer);
        proc.payWithPermit(j, sigJ, block.timestamp, 0, bytes32(0), bytes32(0));

        // refund still works
        vm.prank(payout);
        musd.approve(address(proc), 5e18);
        vm.prank(payout);
        proc.refund(mid, ID, 5e18);
        assertEq(proc.payment(mid, ID).refunded, 5e18);

        // cancel still works
        vm.prank(merchantOwner);
        proc.cancelPayment(mid, j.paymentId);
        assertEq(uint8(proc.intentState(mid, j.paymentId)), uint8(IMPP.IntentState.Cancelled));

        vm.prank(admin);
        proc.unpause();
        IMPP.PaymentIntent memory k = _intent(keccak256("order-3"));
        _pay(k);
    }
}
