// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {BaseTest} from "./Base.t.sol";
import {IMerchantPaymentProcessor as IMPP} from "../src/interfaces/IMerchantPaymentProcessor.sol";
import {FeeOnTransferToken} from "./mocks/BadTokens.sol";

contract PermitTest is BaseTest {
    bytes32 internal constant ID = keccak256("permit-order");

    function test_payWithPermit_noPriorApproval() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(musd, payerPk, address(proc), i.amount, deadline);
        bytes memory sig = _sign(i);

        vm.expectEmit(address(proc));
        emit IMPP.PaymentCompleted(ID, mid, payer, payout, address(musd), AMOUNT, block.timestamp);
        vm.prank(payer);
        proc.payWithPermit(i, sig, deadline, v, r, s);

        assertEq(musd.balanceOf(payout), AMOUNT);
        assertEq(musd.allowance(payer, address(proc)), 0, "exact-amount permit fully consumed");
        assertEq(musd.nonces(payer), 1);
        assertEq(musd.balanceOf(address(proc)), 0);
    }

    function test_payWithPermit_frontRunPermit_stillSucceeds() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(musd, payerPk, address(proc), i.amount, deadline);
        bytes memory sig = _sign(i);

        // Attacker copies the permit from the mempool and submits it first.
        vm.prank(stranger);
        musd.permit(payer, address(proc), i.amount, deadline, v, r, s);

        vm.prank(payer);
        proc.payWithPermit(i, sig, deadline, v, r, s); // permit call fails (nonce used) and is ignored
        assertEq(musd.balanceOf(payout), AMOUNT);
    }

    function test_payWithPermit_badPermit_fallsBackToApproval() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        _approve(payer, i.amount);
        bytes memory sig = _sign(i);
        vm.prank(payer);
        proc.payWithPermit(i, sig, block.timestamp, 27, bytes32(uint256(1)), bytes32(uint256(2)));
        assertEq(musd.balanceOf(payout), AMOUNT);
    }

    function test_payWithPermit_expiredPermitNoApproval_reverts() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _permit(musd, payerPk, address(proc), i.amount, deadline);
        bytes memory sig = _sign(i);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(proc), 0, i.amount)
        );
        vm.prank(payer);
        proc.payWithPermit(i, sig, deadline, v, r, s);
    }

    function test_payWithPermit_permitForOtherSender_doesNotHelp() public {
        // A permit signed by `payer` cannot be used by someone else: the permit owner is msg.sender.
        IMPP.PaymentIntent memory i = _intent(ID);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(musd, payerPk, address(proc), i.amount, deadline);
        bytes memory sig = _sign(i);
        musd.mint(stranger, AMOUNT);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(proc), 0, i.amount)
        );
        vm.prank(stranger);
        proc.payWithPermit(i, sig, deadline, v, r, s);
    }

    function test_payWithPermit_tokenWithoutPermit_usesApproval() public {
        FeeOnTransferToken t = new FeeOnTransferToken(); // no permit() function
        vm.prank(admin);
        proc.setTokenSupported(address(t), true);
        t.mint(payer, AMOUNT);
        vm.prank(payer);
        t.approve(address(proc), AMOUNT);
        IMPP.PaymentIntent memory i = _intent(ID);
        i.token = address(t);
        bytes memory sig = _sign(i);
        vm.prank(payer);
        proc.payWithPermit(i, sig, block.timestamp, 0, 0, 0);
        assertEq(uint8(proc.intentState(mid, ID)), uint8(IMPP.IntentState.Paid));
    }

    function test_payWithPermit_runsAllIntentChecks() public {
        IMPP.PaymentIntent memory i = _intent(ID);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(musd, payerPk, address(proc), i.amount, deadline);
        bytes memory sig = _sign(0xBAD, i);
        vm.expectRevert(IMPP.BadSignature.selector);
        vm.prank(payer);
        proc.payWithPermit(i, sig, deadline, v, r, s);
        assertEq(musd.nonces(payer), 0, "permit rolled back with the revert");
    }
}
