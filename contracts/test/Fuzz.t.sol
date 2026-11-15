// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {IMerchantPaymentProcessor as IMPP} from "../src/interfaces/IMerchantPaymentProcessor.sol";

contract FuzzTest is BaseTest {
    function testFuzz_pay_exactAmount(bytes32 id, uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);
        musd.mint(payer, amount);
        uint256 payerBefore = musd.balanceOf(payer);
        IMPP.PaymentIntent memory i = _intent(id, amount);
        _pay(i);
        assertEq(musd.balanceOf(payout), amount);
        assertEq(musd.balanceOf(payer), payerBefore - amount);
        assertEq(musd.balanceOf(address(proc)), 0);
        assertEq(proc.payment(mid, id).amount, amount);
    }

    function testFuzz_pay_amountAboveUint128_reverts(uint256 amount) public {
        amount = bound(amount, uint256(type(uint128).max) + 1, type(uint256).max);
        IMPP.PaymentIntent memory i = _intent(keccak256("big"), amount);
        _expectPayRevert(i, _sign(i), IMPP.InvalidAmount.selector);
    }

    function testFuzz_pay_expiry(uint64 expiresAt, uint64 nowTs) public {
        expiresAt = uint64(bound(expiresAt, T0, type(uint64).max - 1));
        nowTs = uint64(bound(nowTs, T0, type(uint64).max));
        IMPP.PaymentIntent memory i = _intent(keccak256("exp"));
        i.expiresAt = expiresAt;
        vm.warp(nowTs);
        bytes memory sig = _sign(i);
        _approve(payer, i.amount);
        bool shouldPass = nowTs <= expiresAt;
        assertEq(uint8(proc.checkPayment(i, sig, payer)), uint8(shouldPass ? IMPP.PayCheck.Ok : IMPP.PayCheck.Expired));
        if (!shouldPass) vm.expectRevert(IMPP.IntentExpired.selector);
        vm.prank(payer);
        proc.pay(i, sig);
    }

    function testFuzz_refund_neverExceedsPayment(uint256 amount, uint256 r1, uint256 r2) public {
        amount = bound(amount, 1, 1_000_000e18);
        r1 = bound(r1, 1, 2 * amount);
        r2 = bound(r2, 1, 2 * amount);
        bytes32 id = keccak256("fuzz-refund");
        _pay(_intent(id, amount));
        musd.mint(payout, 4 * amount);
        vm.prank(payout);
        musd.approve(address(proc), type(uint256).max);

        uint256 total;
        uint256[2] memory rs = [r1, r2];
        for (uint256 k = 0; k < 2; ++k) {
            if (total + rs[k] > amount) {
                vm.expectRevert(IMPP.RefundExceedsPayment.selector);
            } else {
                total += rs[k];
            }
            vm.prank(payout);
            proc.refund(mid, id, rs[k]);
        }
        assertEq(proc.payment(mid, id).refunded, total);
        assertLe(proc.payment(mid, id).refunded, proc.payment(mid, id).amount);
    }

    function testFuzz_wrongSigner_alwaysBad(uint256 pk) public {
        pk = bound(pk, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(vm.addr(pk) != signer);
        IMPP.PaymentIntent memory i = _intent(keccak256("sig"));
        _expectPayRevert(i, _sign(pk, i), IMPP.BadSignature.selector);
    }
}
