// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MerchantPaymentProcessor} from "../src/MerchantPaymentProcessor.sol";
import {MockMUSD} from "../test/mocks/MockMUSD.sol";

/// @notice Deploys MerchantPaymentProcessor with MUSD supported and writes deployments/<chainId>.json.
///
/// Env (contracts/.env):
///   DEPLOYER_PRIVATE_KEY  optional. If unset, the script broadcasts with the forge wallet flags
///                         (e.g. `--account deployer --sender 0x...`).
///   OWNER_ADDRESS         optional, default deployer. Ownable2Step admin (token allowlist + pause only).
///   MUSD_ADDRESS          optional on Mezo testnet (default 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503); required
///                         on any other chain.
///   DEPLOY_MOCK_MUSD      optional, local anvil only (chainid 31337): deploy MockMUSD and mint 1,000,000 to deployer.
///
/// Mezo testnet (see docs/notes-contracts.md):
///   forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --legacy --slow
///   node script/record-deployment.mjs 31611
contract Deploy is Script {
    address internal constant MUSD_TESTNET = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    uint256 internal constant MEZO_TESTNET = 31611;
    /// @dev forge's built-in sender when neither a key nor --sender is given. Nobody holds its key.
    address internal constant FORGE_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run() external {
        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        address deployer = pk != 0 ? vm.addr(pk) : msg.sender;
        address owner = vm.envOr("OWNER_ADDRESS", deployer);
        address musd = vm.envOr("MUSD_ADDRESS", address(0));
        bool mockMusd = vm.envOr("DEPLOY_MOCK_MUSD", false);
        require(
            owner != FORGE_DEFAULT_SENDER && deployer != FORGE_DEFAULT_SENDER,
            "Set DEPLOYER_PRIVATE_KEY or pass --sender (forge's default sender has no key)"
        );
        if (musd == address(0) && !mockMusd) {
            // The built-in MUSD address is only known to be MUSD on Mezo testnet.
            require(block.chainid == MEZO_TESTNET, "Set MUSD_ADDRESS for chains other than Mezo testnet");
            musd = MUSD_TESTNET;
        }
        uint256 deployBlock = block.number;

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();

        if (mockMusd) {
            require(block.chainid == 31337, "DEPLOY_MOCK_MUSD is for local anvil only");
            MockMUSD m = new MockMUSD();
            m.mint(deployer, 1_000_000e18);
            musd = address(m);
        } else {
            require(musd.code.length > 0, "MUSD_ADDRESS has no code on this chain");
        }

        address[] memory tokens = new address[](1);
        tokens[0] = musd;
        MerchantPaymentProcessor processor = new MerchantPaymentProcessor(owner, tokens);

        vm.stopBroadcast();

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "processor", address(processor));
        vm.serializeAddress(k, "musd", musd);
        vm.serializeAddress(k, "owner", owner);
        vm.serializeAddress(k, "deployer", deployer);
        // Approximate (block at simulation time); record-deployment.mjs replaces it with the receipt block + txHash.
        string memory json = vm.serializeUint(k, "deployBlock", deployBlock);

        vm.createDir(string.concat(vm.projectRoot(), "/deployments"), true);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console.log("processor", address(processor));
        console.log("musd     ", musd);
        console.log("owner    ", owner);
        console.log("written  ", path);
    }
}
