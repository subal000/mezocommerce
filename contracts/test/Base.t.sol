// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MerchantPaymentProcessor} from "../src/MerchantPaymentProcessor.sol";
import {IMerchantPaymentProcessor as IMPP} from "../src/interfaces/IMerchantPaymentProcessor.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";

/// @notice EIP-712 helpers computed independently of the contract (domain + struct hash by hand).
abstract contract IntentSigning is Test {
    bytes32 internal constant INTENT_TYPEHASH = keccak256(
        "PaymentIntent(bytes32 paymentId,uint256 merchantId,address payout,address token,uint256 amount,address payer,uint64 expiresAt)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function _domainSeparator(address processor) internal view returns (bytes32) {
        return
            keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("MezoCommerce"), keccak256("1"), block.chainid, processor));
    }

    function _digest(address processor, IMPP.PaymentIntent memory i) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(INTENT_TYPEHASH, i.paymentId, i.merchantId, i.payout, i.token, i.amount, i.payer, i.expiresAt)
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(processor), structHash));
    }

    function _signFor(address processor, uint256 pk, IMPP.PaymentIntent memory i) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(processor, i));
        return abi.encodePacked(r, s, v);
    }

    function _permit(MockMUSD token, uint256 ownerPk, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address owner = vm.addr(ownerPk);
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, token.nonces(owner), deadline));
        (v, r, s) = vm.sign(ownerPk, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
    }
}

abstract contract BaseTest is IntentSigning {
    MerchantPaymentProcessor internal proc;
    MockMUSD internal musd;

    address internal admin = makeAddr("admin");
    address internal merchantOwner = makeAddr("merchantOwner");
    address internal payout = makeAddr("payout");
    address internal stranger = makeAddr("stranger");

    uint256 internal signerPk = 0xA11CE;
    address internal signer;
    uint256 internal payerPk = 0xB0B;
    address internal payer;

    uint256 internal mid; // merchant id
    uint256 internal constant AMOUNT = 25e18;
    uint256 internal constant T0 = 1_750_000_000;

    function setUp() public virtual {
        vm.warp(T0);
        signer = vm.addr(signerPk);
        payer = vm.addr(payerPk);
        vm.label(signer, "signer");
        vm.label(payer, "payer");

        musd = new MockMUSD();
        address[] memory tokens = new address[](1);
        tokens[0] = address(musd);
        proc = new MerchantPaymentProcessor(admin, tokens);

        vm.prank(merchantOwner);
        mid = proc.registerMerchant(payout, signer);

        musd.mint(payer, 1_000_000e18);
    }

    function _intent(bytes32 id) internal view returns (IMPP.PaymentIntent memory) {
        return _intent(id, AMOUNT);
    }

    function _intent(bytes32 id, uint256 amount) internal view returns (IMPP.PaymentIntent memory i) {
        i = IMPP.PaymentIntent({
            paymentId: id,
            merchantId: mid,
            payout: payout,
            token: address(musd),
            amount: amount,
            payer: address(0),
            expiresAt: uint64(block.timestamp + 30 minutes)
        });
    }

    function _sign(IMPP.PaymentIntent memory i) internal view returns (bytes memory) {
        return _signFor(address(proc), signerPk, i);
    }

    function _sign(uint256 pk, IMPP.PaymentIntent memory i) internal view returns (bytes memory) {
        return _signFor(address(proc), pk, i);
    }

    function _approve(address who, uint256 amount) internal {
        vm.prank(who);
        musd.approve(address(proc), amount);
    }

    /// @dev Approve exactly and pay as `payer`.
    function _pay(IMPP.PaymentIntent memory i) internal {
        _approve(payer, i.amount);
        bytes memory sig = _sign(i);
        vm.prank(payer);
        proc.pay(i, sig);
    }

    function _expectPayRevert(IMPP.PaymentIntent memory i, bytes memory sig, bytes4 err) internal {
        _approve(payer, i.amount);
        vm.expectRevert(err);
        vm.prank(payer);
        proc.pay(i, sig);
    }
}
