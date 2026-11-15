// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {IMerchantPaymentProcessor as IMPP} from "../src/interfaces/IMerchantPaymentProcessor.sol";
import {RevertingViewsToken} from "./mocks/BadTokens.sol";

contract CheckPaymentTest is BaseTest {
    bytes32 internal constant ID = keccak256("check-order");

    IMPP.PaymentIntent internal i;
    bytes internal sig;
    address internal who;

    function setUp() public override {
        super.setUp();
        i = _intent(ID);
        sig = _sign(i);
        who = payer;
        _approve(payer, AMOUNT);
    }

    function _expect(IMPP.PayCheck want, string memory label) internal view {
        assertEq(uint8(proc.checkPayment(i, sig, who)), uint8(want), label);
    }

    function _resign() internal {
        sig = _sign(i);
    }

    /// One row per PayCheck value; each row starts from a clean snapshot of setUp.
    function test_checkPayment_table() public {
        uint256 snap = vm.snapshotState();

        _expect(IMPP.PayCheck.Ok, "ok");

        // Paused
        vm.prank(admin);
        proc.pause();
        _expect(IMPP.PayCheck.Paused, "paused");
        vm.revertToState(snap);

        // InvalidAmount
        i.amount = 0;
        _resign();
        _expect(IMPP.PayCheck.InvalidAmount, "zero amount");
        i.amount = uint256(type(uint128).max) + 1;
        _resign();
        _expect(IMPP.PayCheck.InvalidAmount, "amount > uint128");
        vm.revertToState(snap);
        i = _intent(ID);
        _resign();

        // UnsupportedToken
        i.token = makeAddr("notListed");
        _resign();
        _expect(IMPP.PayCheck.UnsupportedToken, "unsupported");
        i = _intent(ID);
        _resign();

        // UnknownMerchant
        i.merchantId = 77;
        _resign();
        _expect(IMPP.PayCheck.UnknownMerchant, "unknown merchant");
        i = _intent(ID);
        _resign();

        // MerchantInactive
        vm.prank(merchantOwner);
        proc.setMerchantActive(mid, false);
        _expect(IMPP.PayCheck.MerchantInactive, "inactive");
        vm.revertToState(snap);

        // PayoutMismatch
        vm.prank(merchantOwner);
        proc.setPayout(mid, makeAddr("np"));
        _expect(IMPP.PayCheck.PayoutMismatch, "payout mismatch");
        vm.revertToState(snap);

        // AlreadyPaid
        vm.prank(payer);
        proc.pay(i, sig);
        _expect(IMPP.PayCheck.AlreadyPaid, "already paid");
        vm.revertToState(snap);

        // Cancelled (own merchant) vs foreign cancel (still Ok)
        vm.prank(merchantOwner);
        proc.cancelPayment(mid, ID);
        _expect(IMPP.PayCheck.Cancelled, "cancelled");
        vm.revertToState(snap);
        vm.prank(stranger);
        uint256 other = proc.registerMerchant(stranger, address(0));
        vm.prank(stranger);
        proc.cancelPayment(other, ID);
        _expect(IMPP.PayCheck.Ok, "foreign cancel ignored");
        vm.revertToState(snap);

        // Expired boundary
        vm.warp(i.expiresAt);
        _expect(IMPP.PayCheck.Ok, "at expiresAt");
        vm.warp(uint256(i.expiresAt) + 1);
        _expect(IMPP.PayCheck.Expired, "expired");
        vm.revertToState(snap);

        // WrongPayer
        i.payer = payer;
        _resign();
        who = stranger;
        _expect(IMPP.PayCheck.WrongPayer, "wrong payer");
        who = payer;
        _expect(IMPP.PayCheck.Ok, "locked payer ok");
        i = _intent(ID);
        _resign();

        // BadSignature
        sig = _sign(0xBAD, i);
        _expect(IMPP.PayCheck.BadSignature, "non-signer");
        sig = "";
        _expect(IMPP.PayCheck.BadSignature, "empty sig");
        sig = hex"deadbeef";
        _expect(IMPP.PayCheck.BadSignature, "short sig");
        sig = new bytes(65);
        _expect(IMPP.PayCheck.BadSignature, "zero sig");
        _resign();
        vm.prank(merchantOwner);
        proc.setSigner(mid, signer, false);
        _expect(IMPP.PayCheck.BadSignature, "revoked signer");
        vm.revertToState(snap);

        // InsufficientBalance (stranger approved but holds nothing)
        who = stranger;
        vm.prank(stranger);
        musd.approve(address(proc), AMOUNT);
        _expect(IMPP.PayCheck.InsufficientBalance, "balance");
        vm.revertToState(snap);
        who = payer;

        // InsufficientAllowance
        _approve(payer, AMOUNT - 1);
        _expect(IMPP.PayCheck.InsufficientAllowance, "allowance");
        vm.revertToState(snap);
    }

    function test_checkPayment_priorityOrder() public {
        // Several failures at once: the earliest in the documented order wins.
        vm.prank(admin);
        proc.pause();
        i.amount = 0;
        i.merchantId = 77;
        vm.warp(uint256(i.expiresAt) + 1);
        sig = "";
        _expect(IMPP.PayCheck.Paused, "paused first");
        vm.prank(admin);
        proc.unpause();
        _expect(IMPP.PayCheck.InvalidAmount, "then amount");
        i.amount = AMOUNT;
        _expect(IMPP.PayCheck.UnknownMerchant, "then merchant");
        i.merchantId = mid;
        _expect(IMPP.PayCheck.Expired, "then expiry (before signature)");
        vm.warp(T0);
        i.payer = stranger;
        _expect(IMPP.PayCheck.WrongPayer, "then payer (before signature)");
        i.payer = address(0);
        _expect(IMPP.PayCheck.BadSignature, "then signature");
    }

    function test_checkPayment_neverRevertsOnHostileToken() public {
        RevertingViewsToken t = new RevertingViewsToken();
        address eoaToken = makeAddr("eoaToken");
        vm.startPrank(admin);
        proc.setTokenSupported(address(t), true);
        proc.setTokenSupported(eoaToken, true);
        vm.stopPrank();

        i.token = address(t);
        _resign();
        _expect(IMPP.PayCheck.InsufficientBalance, "reverting balanceOf reads as 0");
        i.token = eoaToken;
        _resign();
        _expect(IMPP.PayCheck.InsufficientBalance, "no-code token reads as 0");
    }

    function test_checkPayment_okImpliesPaySucceeds() public {
        _expect(IMPP.PayCheck.Ok, "ok");
        vm.prank(payer);
        proc.pay(i, sig);
        assertEq(musd.balanceOf(payout), AMOUNT);
    }

    function test_checkPayment_payerZeroForOpenIntent() public {
        // Preflight without a connected wallet: payerAddr = 0 has no balance.
        who = address(0);
        _expect(IMPP.PayCheck.InsufficientBalance, "no wallet");
    }
}
