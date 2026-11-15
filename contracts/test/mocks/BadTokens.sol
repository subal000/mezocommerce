// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice transferFrom returns false without moving anything.
contract ReturnsFalseToken is ERC20 {
    constructor() ERC20("False", "FALSE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @notice Burns 1% of every transfer, so the recipient gets less than was sent.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Fee", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/// @notice On transferFrom, calls `target` with preset calldata first and bubbles any revert.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;

    constructor() ERC20("Reenter", "REENTER") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (target != address(0)) {
            (bool ok, bytes memory ret) = target.call(payload);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
        return super.transferFrom(from, to, value);
    }
}

/// @notice balanceOf / allowance revert; used to show checkPayment never reverts.
contract RevertingViewsToken is ERC20 {
    constructor() ERC20("Revert", "REVERT") {}

    function balanceOf(address) public pure override returns (uint256) {
        revert("nope");
    }

    function allowance(address, address) public pure override returns (uint256) {
        revert("nope");
    }
}
