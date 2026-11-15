// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MerchantPaymentProcessor} from "../src/MerchantPaymentProcessor.sol";

/// @notice Registers the broadcasting wallet as a merchant (owner = broadcaster). Helper for demos; the dashboard
///         normally sends this tx from the merchant's own wallet.
///
/// Env:
///   MERCHANT_PRIVATE_KEY  optional; else forge wallet flags (`--account <name> --sender <addr>`).
///   PROCESSOR_ADDRESS     optional, default read from deployments/<chainId>.json.
///   PAYOUT_ADDRESS        optional, default the merchant owner.
///   INITIAL_SIGNER        optional, default address(0). Normally the platform signer (INTENT_SIGNER_PRIVATE_KEY's address).
///
///   forge script script/RegisterMerchant.s.sol --rpc-url mezo_testnet --broadcast --legacy
contract RegisterMerchant is Script {
    function run() external returns (uint256 merchantId) {
        uint256 pk = vm.envOr("MERCHANT_PRIVATE_KEY", uint256(0));
        address merchantOwner = pk != 0 ? vm.addr(pk) : msg.sender;
        address processor = vm.envOr("PROCESSOR_ADDRESS", address(0));
        if (processor == address(0)) {
            string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
            processor = vm.parseJsonAddress(vm.readFile(path), ".processor");
        }
        address payout = vm.envOr("PAYOUT_ADDRESS", merchantOwner);
        address initialSigner = vm.envOr("INITIAL_SIGNER", address(0));
        // forge's built-in sender when neither a key nor --sender is given. Nobody holds its key.
        require(
            merchantOwner != 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38,
            "Set MERCHANT_PRIVATE_KEY or pass --sender (forge's default sender has no key)"
        );

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        merchantId = MerchantPaymentProcessor(processor).registerMerchant(payout, initialSigner);
        vm.stopBroadcast();

        console.log("merchantId", merchantId);
        console.log("owner     ", merchantOwner);
        console.log("payout    ", payout);
        console.log("signer    ", initialSigner);
    }
}
