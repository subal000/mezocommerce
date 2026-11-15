// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BaseTest} from "./Base.t.sol";
import {MerchantPaymentProcessor} from "../src/MerchantPaymentProcessor.sol";
import {IMerchantPaymentProcessor as IMPP} from "../src/interfaces/IMerchantPaymentProcessor.sol";

contract AdminTest is BaseTest {
    // ───────────── constructor ─────────────

    function test_constructor_state() public view {
        assertEq(proc.owner(), admin);
        assertTrue(proc.isTokenSupported(address(musd)));
        assertFalse(proc.paused());
        assertEq(proc.merchantCount(), 1);
    }

    function test_constructor_zeroOwner_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new MerchantPaymentProcessor(address(0), new address[](0));
    }

    function test_constructor_zeroToken_reverts() public {
        vm.expectRevert(IMPP.ZeroAddress.selector);
        new MerchantPaymentProcessor(admin, new address[](1));
    }

    // ───────────── admin access ─────────────

    function test_admin_onlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.startPrank(stranger);
        vm.expectRevert(err);
        proc.setTokenSupported(address(musd), false);
        vm.expectRevert(err);
        proc.pause();
        vm.expectRevert(err);
        proc.unpause();
        vm.expectRevert(err);
        proc.transferOwnership(stranger);
        vm.stopPrank();
    }

    function test_setTokenSupported() public {
        address t = makeAddr("token");
        vm.expectEmit(address(proc));
        emit IMPP.TokenSupportUpdated(t, true);
        vm.prank(admin);
        proc.setTokenSupported(t, true);
        assertTrue(proc.isTokenSupported(t));

        vm.expectRevert(IMPP.ZeroAddress.selector);
        vm.prank(admin);
        proc.setTokenSupported(address(0), true);
    }

    function test_adminCannotManageMerchants() public {
        vm.startPrank(admin);
        vm.expectRevert(IMPP.NotMerchantOwner.selector);
        proc.setPayout(mid, admin);
        vm.expectRevert(IMPP.NotMerchantOwner.selector);
        proc.setSigner(mid, admin, true);
        vm.expectRevert(IMPP.NotMerchantOwner.selector);
        proc.setMerchantActive(mid, false);
        vm.stopPrank();
    }

    function test_ownable2Step() public {
        address next = makeAddr("next");
        vm.prank(admin);
        proc.transferOwnership(next);
        assertEq(proc.owner(), admin, "not yet transferred");
        assertEq(proc.pendingOwner(), next);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        proc.acceptOwnership();

        vm.prank(next);
        proc.acceptOwnership();
        assertEq(proc.owner(), next);
        assertEq(proc.pendingOwner(), address(0));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        vm.prank(admin);
        proc.pause();
        vm.prank(next);
        proc.pause();
        assertTrue(proc.paused());
    }

    // ───────────── merchant management ─────────────

    function test_register_idsStartAtOneAndIncrement() public {
        assertEq(mid, 1);
        vm.expectEmit(address(proc));
        emit IMPP.MerchantRegistered(2, stranger, stranger);
        vm.prank(stranger);
        uint256 id2 = proc.registerMerchant(stranger, address(0));
        assertEq(id2, 2);
        assertEq(proc.merchantCount(), 2);

        IMPP.Merchant memory m = proc.merchant(id2);
        assertEq(m.owner, stranger);
        assertEq(m.payout, stranger);
        assertTrue(m.active);
        assertFalse(proc.isSigner(id2, address(0)));
    }

    function test_register_withSigner_emits() public {
        address s = makeAddr("s");
        vm.expectEmit(address(proc));
        emit IMPP.MerchantRegistered(2, stranger, payout);
        vm.expectEmit(address(proc));
        emit IMPP.SignerUpdated(2, s, true);
        vm.prank(stranger);
        proc.registerMerchant(payout, s);
        assertTrue(proc.isSigner(2, s));
        assertFalse(proc.isSigner(1, s));
    }

    function test_register_badPayout_reverts() public {
        vm.expectRevert(IMPP.ZeroAddress.selector);
        proc.registerMerchant(address(0), address(0));
        vm.expectRevert(MerchantPaymentProcessor.InvalidPayout.selector);
        proc.registerMerchant(address(proc), address(0));
    }

    function test_register_allowedWhilePaused() public {
        vm.prank(admin);
        proc.pause();
        vm.prank(stranger);
        assertEq(proc.registerMerchant(stranger, address(0)), 2);
    }

    function test_setPayout() public {
        address np = makeAddr("np");
        vm.expectEmit(address(proc));
        emit IMPP.PayoutUpdated(mid, np);
        vm.prank(merchantOwner);
        proc.setPayout(mid, np);
        assertEq(proc.merchant(mid).payout, np);

        vm.startPrank(merchantOwner);
        vm.expectRevert(IMPP.ZeroAddress.selector);
        proc.setPayout(mid, address(0));
        vm.expectRevert(MerchantPaymentProcessor.InvalidPayout.selector);
        proc.setPayout(mid, address(proc));
        vm.stopPrank();
    }

    function test_setSigner() public {
        address s = makeAddr("s");
        vm.expectEmit(address(proc));
        emit IMPP.SignerUpdated(mid, s, true);
        vm.prank(merchantOwner);
        proc.setSigner(mid, s, true);
        assertTrue(proc.isSigner(mid, s));

        vm.prank(merchantOwner);
        proc.setSigner(mid, s, false);
        assertFalse(proc.isSigner(mid, s));

        vm.expectRevert(IMPP.ZeroAddress.selector);
        vm.prank(merchantOwner);
        proc.setSigner(mid, address(0), true);
    }

    function test_setMerchantActive() public {
        vm.expectEmit(address(proc));
        emit IMPP.MerchantStatusUpdated(mid, false);
        vm.prank(merchantOwner);
        proc.setMerchantActive(mid, false);
        assertFalse(proc.merchant(mid).active);
    }

    function test_merchantManagement_unauthorized() public {
        address[3] memory bad = [stranger, payout, signer];
        for (uint256 k = 0; k < bad.length; ++k) {
            vm.startPrank(bad[k]);
            vm.expectRevert(IMPP.NotMerchantOwner.selector);
            proc.setPayout(mid, bad[k]);
            vm.expectRevert(IMPP.NotMerchantOwner.selector);
            proc.setSigner(mid, bad[k], true);
            vm.expectRevert(IMPP.NotMerchantOwner.selector);
            proc.setMerchantActive(mid, false);
            vm.stopPrank();
        }
    }

    function test_merchantManagement_unknownMerchant() public {
        vm.startPrank(merchantOwner);
        vm.expectRevert(IMPP.UnknownMerchant.selector);
        proc.setPayout(7, payout);
        vm.expectRevert(IMPP.UnknownMerchant.selector);
        proc.setSigner(0, signer, true);
        vm.expectRevert(IMPP.UnknownMerchant.selector);
        proc.setMerchantActive(7, true);
        vm.stopPrank();
    }
}
