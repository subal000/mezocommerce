// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerchantPaymentProcessor} from "../src/MerchantPaymentProcessor.sol";
import {IMerchantPaymentProcessor as IMPP} from "../src/interfaces/IMerchantPaymentProcessor.sol";

/// Regression tests for the Pashov solidity-auditor scan (2026-11-12).
contract AuditFixesTest is BaseTest {
    bytes32 internal constant ID = keccak256("audit-order");
    uint256 internal constant ATTACKER_PK = 0xBAD;

    function _attackerMerchant() internal returns (uint256 amid, address attacker) {
        attacker = vm.addr(ATTACKER_PK);
        vm.prank(attacker);
        amid = proc.registerMerchant(attacker, attacker);
    }

    /// Finding 1: another merchant paying the same paymentId first must not block the real payment.
    function test_crossMerchantSquat_doesNotBlock() public {
        (uint256 amid, address attacker) = _attackerMerchant();
        IMPP.PaymentIntent memory squat = IMPP.PaymentIntent({
            paymentId: ID,
            merchantId: amid,
            payout: attacker,
            token: address(musd),
            amount: 1,
            payer: address(0),
            expiresAt: uint64(block.timestamp + 1 hours)
        });
        musd.mint(attacker, 1);
        vm.prank(attacker);
        musd.approve(address(proc), 1);
        bytes memory sqSig = _sign(ATTACKER_PK, squat);
        vm.prank(attacker);
        proc.pay(squat, sqSig);

        IMPP.PaymentIntent memory i = _intent(ID);
        assertEq(uint8(proc.checkPayment(i, _sign(i), payer)), uint8(IMPP.PayCheck.InsufficientAllowance));
        _pay(i);
        assertEq(musd.balanceOf(payout), AMOUNT);
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Paid));
        assertEq(proc.payment(mid, ID).amount, AMOUNT);
        assertEq(proc.payment(amid, ID).amount, 1);
    }

    function test_crossMerchantCancel_doesNotBlock() public {
        (uint256 amid, address attacker) = _attackerMerchant();
        vm.prank(attacker);
        proc.cancelPayment(amid, ID);
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.None));
        _pay(_intent(ID));
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Paid));
    }

    function test_refund_wrongMerchant_notPaid() public {
        _pay(_intent(ID));
        (uint256 amid, address attacker) = _attackerMerchant();
        vm.expectRevert(IMPP.NotPaid.selector);
        vm.prank(attacker);
        proc.refund(amid, ID, 1);
    }

    /// Lead: a supported token cannot be a payout.
    function test_tokenAsPayout_rejected() public {
        vm.expectRevert(MerchantPaymentProcessor.InvalidPayout.selector);
        vm.prank(stranger);
        proc.registerMerchant(address(musd), address(0));

        vm.expectRevert(MerchantPaymentProcessor.InvalidPayout.selector);
        vm.prank(merchantOwner);
        proc.setPayout(mid, address(musd));
    }

    function test_tokenAllowlistedAfterPayoutSet_payReverts() public {
        MockMUSD t2 = new MockMUSD();
        vm.prank(merchantOwner);
        proc.setPayout(mid, address(t2)); // not supported yet, so accepted
        vm.prank(admin);
        proc.setTokenSupported(address(t2), true);

        IMPP.PaymentIntent memory i = _intent(ID);
        i.payout = address(t2);
        i.token = address(t2);
        bytes memory sig = _sign(i);
        t2.mint(payer, AMOUNT);
        vm.prank(payer);
        t2.approve(address(proc), AMOUNT);
        assertEq(uint8(proc.checkPayment(i, sig, payer)), uint8(IMPP.PayCheck.PayoutMismatch));
        vm.expectRevert(MerchantPaymentProcessor.InvalidPayout.selector);
        vm.prank(payer);
        proc.pay(i, sig);
    }

    /// Lead: payWithPermit keeps a larger standing approval instead of overwriting it.
    function test_payWithPermit_keepsLargerAllowance() public {
        _approve(payer, 10 * AMOUNT);
        IMPP.PaymentIntent memory i = _intent(ID);
        bytes memory sig = _sign(i);
        vm.prank(payer);
        proc.payWithPermit(i, sig, block.timestamp, 0, bytes32(0), bytes32(0));
        assertEq(musd.allowance(payer, address(proc)), 9 * AMOUNT);
    }

    /// Lead: ownership cannot be renounced.
    function test_renounceOwnership_disabled() public {
        vm.expectRevert(MerchantPaymentProcessor.RenounceDisabled.selector);
        vm.prank(admin);
        proc.renounceOwnership();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        proc.renounceOwnership();
        assertEq(proc.owner(), admin);
    }
}
