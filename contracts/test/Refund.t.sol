// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {BaseTest} from "./Base.t.sol";
import {IMerchantPaymentProcessor as IMPP} from "../src/interfaces/IMerchantPaymentProcessor.sol";

contract RefundTest is BaseTest {
    bytes32 internal constant ID = keccak256("refund-order");

    function setUp() public override {
        super.setUp();
        _pay(_intent(ID));
        // merchant wallets approve the processor for refunds
        vm.prank(payout);
        musd.approve(address(proc), type(uint256).max);
        musd.mint(merchantOwner, 100e18);
        vm.prank(merchantOwner);
        musd.approve(address(proc), type(uint256).max);
    }

    function test_refund_partial_byPayout() public {
        uint256 payerBefore = musd.balanceOf(payer);
        vm.expectEmit(address(proc));
        emit IMPP.RefundCompleted(ID, mid, payer, payout, 10e18, 10e18);
        vm.prank(payout);
        proc.refund(mid, ID, 10e18);
        assertEq(musd.balanceOf(payer), payerBefore + 10e18);
        assertEq(musd.balanceOf(payout), AMOUNT - 10e18);
        assertEq(proc.payment(mid, ID).refunded, 10e18);
        assertEq(musd.balanceOf(address(proc)), 0);
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Paid), "state stays Paid");
    }

    function test_refund_full_inTwoSteps_byOwnerAndPayout() public {
        vm.prank(payout);
        proc.refund(mid, ID, 10e18);
        vm.expectEmit(address(proc));
        emit IMPP.RefundCompleted(ID, mid, payer, merchantOwner, AMOUNT - 10e18, AMOUNT);
        vm.prank(merchantOwner);
        proc.refund(mid, ID, AMOUNT - 10e18);
        assertEq(proc.payment(mid, ID).refunded, AMOUNT);

        vm.expectRevert(IMPP.RefundExceedsPayment.selector);
        vm.prank(payout);
        proc.refund(mid, ID, 1);
    }

    function test_refund_full_once() public {
        vm.prank(payout);
        proc.refund(mid, ID, AMOUNT);
        assertEq(proc.payment(mid, ID).refunded, AMOUNT);
    }

    function test_refund_overRefund_reverts() public {
        vm.expectRevert(IMPP.RefundExceedsPayment.selector);
        vm.prank(payout);
        proc.refund(mid, ID, AMOUNT + 1);
    }

    function test_refund_zero_reverts() public {
        vm.expectRevert(IMPP.InvalidAmount.selector);
        vm.prank(payout);
        proc.refund(mid, ID, 0);
    }

    function test_refund_wrongCaller_reverts() public {
        address[4] memory bad = [stranger, payer, signer, admin];
        for (uint256 k = 0; k < bad.length; ++k) {
            vm.expectRevert(IMPP.NotAuthorized.selector);
            vm.prank(bad[k]);
            proc.refund(mid, ID, 1e18);
        }
    }

    function test_refund_unpaidId_reverts() public {
        vm.expectRevert(IMPP.NotPaid.selector);
        vm.prank(payout);
        proc.refund(mid, keccak256("nope"), 1e18);

        bytes32 cancelled = keccak256("cancelled");
        vm.prank(merchantOwner);
        proc.cancelPayment(mid, cancelled);
        vm.expectRevert(IMPP.NotPaid.selector);
        vm.prank(merchantOwner);
        proc.refund(mid, cancelled, 1e18);
    }

    function test_refund_alwaysGoesToOriginalPayer() public {
        // Whoever refunds, tokens land at the recorded payer; there is no recipient parameter.
        uint256 before = musd.balanceOf(payer);
        vm.prank(merchantOwner);
        proc.refund(mid, ID, 3e18);
        assertEq(musd.balanceOf(payer), before + 3e18);
        assertEq(musd.balanceOf(merchantOwner), 100e18 - 3e18);
    }

    function test_refund_afterSetPayout_newPayoutAllowed_oldDenied() public {
        address newPayout = makeAddr("newPayout");
        vm.prank(merchantOwner);
        proc.setPayout(mid, newPayout);

        vm.expectRevert(IMPP.NotAuthorized.selector);
        vm.prank(payout);
        proc.refund(mid, ID, 1e18);

        musd.mint(newPayout, 1e18);
        vm.prank(newPayout);
        musd.approve(address(proc), 1e18);
        vm.prank(newPayout);
        proc.refund(mid, ID, 1e18);
        assertEq(proc.payment(mid, ID).refunded, 1e18);
    }

    function test_refund_otherMerchantOwner_reverts() public {
        vm.prank(stranger);
        proc.registerMerchant(stranger, address(0));
        vm.expectRevert(IMPP.NotAuthorized.selector);
        vm.prank(stranger);
        proc.refund(mid, ID, 1e18);
    }

    function test_refund_needsApprovalFromRefunder() public {
        vm.prank(payout);
        musd.approve(address(proc), 0);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(proc), 0, 1e18)
        );
        vm.prank(payout);
        proc.refund(mid, ID, 1e18);
        assertEq(proc.payment(mid, ID).refunded, 0);
    }

    function test_refund_whileMerchantInactive_ok() public {
        vm.prank(merchantOwner);
        proc.setMerchantActive(mid, false);
        vm.prank(payout);
        proc.refund(mid, ID, 1e18);
        assertEq(proc.payment(mid, ID).refunded, 1e18);
    }
}
