// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IntentSigning} from "../Base.t.sol";
import {MerchantPaymentProcessor} from "../../src/MerchantPaymentProcessor.sol";
import {IMerchantPaymentProcessor as IMPP} from "../../src/interfaces/IMerchantPaymentProcessor.sol";
import {MockMUSD} from "../mocks/MockMUSD.sol";

/// @notice Random sequences of pay / payWithPermit / cancel / refund / setPayout / pause against one merchant.
contract Handler is IntentSigning {
    MerchantPaymentProcessor public immutable proc;
    MockMUSD public immutable musd;
    uint256 public immutable mid;
    uint256 internal immutable signerPk;
    address internal immutable owner;
    address internal immutable admin;

    address[3] internal payers;
    uint256[3] internal payerPks = [uint256(0x1001), 0x1002, 0x1003];
    address[2] internal payouts;

    bytes32[] public paidIds;
    mapping(bytes32 => uint256) public ghostPaid;
    uint256 public ghostSumPaid;
    uint256 public ghostSumRefunded;

    constructor(
        MerchantPaymentProcessor proc_,
        MockMUSD musd_,
        uint256 mid_,
        uint256 signerPk_,
        address owner_,
        address admin_
    ) {
        proc = proc_;
        musd = musd_;
        mid = mid_;
        signerPk = signerPk_;
        owner = owner_;
        admin = admin_;
        for (uint256 k = 0; k < 3; ++k) {
            payers[k] = vm.addr(payerPks[k]);
        }
        payouts[0] = proc_.merchant(mid_).payout;
        payouts[1] = makeAddr("payout-b");
    }

    function _id(uint256 seed) internal pure returns (bytes32) {
        return keccak256(abi.encode("id", seed % 16)); // small pool => collisions exercise duplicates
    }

    function pay(uint256 seed, uint256 amount, uint256 payerIdx, bool usePermit) external {
        amount = bound(amount, 1, 1_000_000e18);
        uint256 k = payerIdx % 3;
        address p = payers[k];
        IMPP.PaymentIntent memory i = IMPP.PaymentIntent({
            paymentId: _id(seed),
            merchantId: mid,
            payout: proc.merchant(mid).payout,
            token: address(musd),
            amount: amount,
            payer: address(0),
            expiresAt: uint64(block.timestamp + 1 hours)
        });
        bytes memory sig = _signFor(address(proc), signerPk, i);
        musd.mint(p, amount);
        bool ok;
        if (usePermit) {
            (uint8 v, bytes32 r, bytes32 s) = _permit(musd, payerPks[k], address(proc), amount, block.timestamp);
            vm.prank(p);
            (ok,) = address(proc).call(abi.encodeCall(proc.payWithPermit, (i, sig, block.timestamp, v, r, s)));
        } else {
            vm.prank(p);
            musd.approve(address(proc), amount);
            vm.prank(p);
            (ok,) = address(proc).call(abi.encodeCall(proc.pay, (i, sig)));
            vm.prank(p);
            musd.approve(address(proc), 0);
        }
        if (ok) {
            paidIds.push(i.paymentId);
            ghostPaid[i.paymentId] = amount;
            ghostSumPaid += amount;
        }
    }

    function cancel(uint256 seed) external {
        vm.prank(owner);
        (bool ok,) = address(proc).call(abi.encodeCall(proc.cancelPayment, (mid, _id(seed))));
        ok;
    }

    function refund(uint256 idx, uint256 amount, bool fromOwner) external {
        if (paidIds.length == 0) return;
        bytes32 id = paidIds[idx % paidIds.length];
        amount = bound(amount, 0, ghostPaid[id] + 1);
        address from = fromOwner ? owner : proc.merchant(mid).payout;
        musd.mint(from, amount);
        vm.prank(from);
        musd.approve(address(proc), amount);
        vm.prank(from);
        (bool ok,) = address(proc).call(abi.encodeCall(proc.refund, (mid, id, amount)));
        if (ok) ghostSumRefunded += amount;
        vm.prank(from);
        musd.approve(address(proc), 0);
    }

    function switchPayout(uint256 which) external {
        vm.prank(owner);
        proc.setPayout(mid, payouts[which % 2]);
    }

    function togglePause(bool p) external {
        vm.prank(admin);
        if (p) {
            try proc.pause() {} catch {}
        } else {
            try proc.unpause() {} catch {}
        }
    }

    function paidCount() external view returns (uint256) {
        return paidIds.length;
    }
}

contract InvariantTest is Test {
    MerchantPaymentProcessor internal proc;
    MockMUSD internal musd;
    Handler internal handler;

    function setUp() public {
        vm.warp(1_750_000_000);
        musd = new MockMUSD();
        address[] memory tokens = new address[](1);
        tokens[0] = address(musd);
        address admin = makeAddr("admin");
        address owner = makeAddr("owner");
        proc = new MerchantPaymentProcessor(admin, tokens);
        uint256 signerPk = 0xA11CE;
        vm.prank(owner);
        uint256 mid = proc.registerMerchant(makeAddr("payout-a"), vm.addr(signerPk));
        handler = new Handler(proc, musd, mid, signerPk, owner, admin);
        targetContract(address(handler));
    }

    /// Sanity: the handler's pay / permit / refund paths really succeed (not silently reverting).
    function test_handlerPathsSucceed() public {
        handler.pay(1, 10e18, 0, false);
        handler.pay(2, 5e18, 1, true);
        handler.refund(0, 3e18, false);
        handler.refund(1, 5e18, true);
        assertEq(handler.paidCount(), 2);
        assertEq(handler.ghostSumPaid(), 15e18);
        assertEq(handler.ghostSumRefunded(), 8e18);
    }

    function invariant_processorNeverHoldsTokens() public view {
        assertEq(musd.balanceOf(address(proc)), 0);
    }

    function invariant_refundsNeverExceedPayments() public view {
        uint256 n = handler.paidCount();
        uint256 sumRefunded;
        for (uint256 k = 0; k < n; ++k) {
            bytes32 id = handler.paidIds(k);
            IMPP.PaymentRecord memory r = proc.payment(handler.mid(), id);
            assertLe(r.refunded, r.amount, "per-payment refund cap");
            assertEq(r.amount, handler.ghostPaid(id), "record amount == paid amount");
            assertEq(uint8(proc.intentState(handler.mid(), id)), uint8(IMPP.IntentState.Paid));
            sumRefunded += r.refunded;
        }
        assertEq(sumRefunded, handler.ghostSumRefunded());
        assertLe(handler.ghostSumRefunded(), handler.ghostSumPaid());
    }
}
