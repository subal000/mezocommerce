// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {IMerchantPaymentProcessor as IMPP} from "../src/interfaces/IMerchantPaymentProcessor.sol";

contract CancelTest is BaseTest {
    bytes32 internal constant ID = keccak256("cancel-order");

    function test_cancel_byOwner() public {
        vm.expectEmit(address(proc));
        emit IMPP.PaymentCancelled(ID, mid, merchantOwner);
        vm.prank(merchantOwner);
        proc.cancelPayment(mid, ID);
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Cancelled));
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Cancelled));
    }

    function test_cancel_bySigner() public {
        vm.expectEmit(address(proc));
        emit IMPP.PaymentCancelled(ID, mid, signer);
        vm.prank(signer);
        proc.cancelPayment(mid, ID);
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Cancelled));
    }

    function test_cancel_revokedSigner_reverts() public {
        vm.prank(merchantOwner);
        proc.setSigner(mid, signer, false);
        vm.expectRevert(IMPP.NotAuthorized.selector);
        vm.prank(signer);
        proc.cancelPayment(mid, ID);
    }

    function test_cancel_stranger_reverts() public {
        vm.expectRevert(IMPP.NotAuthorized.selector);
        vm.prank(stranger);
        proc.cancelPayment(mid, ID);
    }

    function test_cancel_payoutWalletIsNotAuthorized() public {
        vm.expectRevert(IMPP.NotAuthorized.selector);
        vm.prank(payout);
        proc.cancelPayment(mid, ID);
    }

    function test_cancel_adminIsNotAuthorized() public {
        vm.expectRevert(IMPP.NotAuthorized.selector);
        vm.prank(admin);
        proc.cancelPayment(mid, ID);
    }

    function test_cancel_otherMerchantSignerForThisMerchant_reverts() public {
        uint256 otherPk = 0xD00D;
        vm.prank(stranger);
        proc.registerMerchant(stranger, vm.addr(otherPk));
        vm.expectRevert(IMPP.NotAuthorized.selector);
        vm.prank(vm.addr(otherPk));
        proc.cancelPayment(mid, ID);
    }

    function test_cancel_unknownMerchant_reverts() public {
        vm.expectRevert(IMPP.UnknownMerchant.selector);
        vm.prank(merchantOwner);
        proc.cancelPayment(42, ID);
    }

    function test_cancel_paid_reverts() public {
        _pay(_intent(ID));
        vm.expectRevert(IMPP.IntentAlreadyPaid.selector);
        vm.prank(merchantOwner);
        proc.cancelPayment(mid, ID);
    }

    function test_cancel_otherMerchant_doesNotTouchPaidId() public {
        _pay(_intent(ID));
        vm.prank(stranger);
        uint256 other = proc.registerMerchant(stranger, address(0));
        vm.prank(stranger);
        proc.cancelPayment(other, ID); // only cancels `other`'s own (unused) id
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Paid));
        assertEq(uint8(proc.intentState(other, ID)), uint8(IMPP.IntentState.Cancelled));
    }

    function test_cancel_twice_reverts() public {
        vm.prank(merchantOwner);
        proc.cancelPayment(mid, ID);
        vm.expectRevert(IMPP.IntentCancelled.selector);
        vm.prank(signer);
        proc.cancelPayment(mid, ID);
    }

    function test_cancel_afterForeignCancel_stillPossible() public {
        vm.prank(stranger);
        uint256 other = proc.registerMerchant(stranger, address(0));
        vm.prank(stranger);
        proc.cancelPayment(other, ID);
        vm.prank(merchantOwner);
        proc.cancelPayment(mid, ID); // own cancel is independent
        IMPP.PaymentIntent memory i = _intent(ID);
        _expectPayRevert(i, _sign(i), IMPP.IntentCancelled.selector);
    }

    function test_cancel_inactiveMerchant_ok() public {
        vm.prank(merchantOwner);
        proc.setMerchantActive(mid, false);
        vm.prank(merchantOwner);
        proc.cancelPayment(mid, ID);
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Cancelled));
    }
}
