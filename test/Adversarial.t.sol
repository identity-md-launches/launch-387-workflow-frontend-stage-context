// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TakeProfitFixture} from "./TakeProfitHook.t.sol";
import {TakeProfitHook} from "../src/TakeProfitHook.sol";
import {OrderIdLibrary} from "@openzeppelin/uniswap-hooks/general/LimitOrderHook.sol";

contract RejectEth {
    receive() external payable {
        revert("reject ETH");
    }
}

contract ReentrantOwner {
    TakeProfitHook public immutable hook;
    OrderIdLibrary.OrderId public id;
    bool public reentrySucceeded;
    uint256 public received;

    constructor(TakeProfitHook hook_) {
        hook = hook_;
    }

    function claim(OrderIdLibrary.OrderId id_) external {
        id = id_;
        hook.withdraw(id, address(this));
    }

    receive() external payable {
        received += msg.value;
        (reentrySucceeded,) = address(hook).call(abi.encodeCall(hook.withdraw, (id, address(this))));
    }
}

contract AdversarialTest is TakeProfitFixture {
    function test_rejectedEthPayoutRollsBackAndCanRetry() public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        _buyTo(ORDER_TICK - 1);
        uint256 claims = manager.balanceOf(address(hook), 0);
        RejectEth reject = new RejectEth();
        vm.expectRevert();
        vm.prank(ALICE);
        takeProfit.withdraw(id, address(reject));
        assertGt(takeProfit.getOrderLiquidity(id, ALICE), 0);
        assertEq(manager.balanceOf(address(hook), 0), claims);
        vm.prank(ALICE);
        takeProfit.withdraw(id, ALICE);
        assertEq(ALICE.balance, claims);
    }

    function test_rejectedCancellationCanRetryWithoutLosingPosition() public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        _buyTo(ORDER_TICK + 30);
        uint256 liquidity = takeProfit.getOrderLiquidity(id, ALICE);
        RejectEth reject = new RejectEth();
        vm.expectRevert();
        vm.prank(ALICE);
        takeProfit.cancelOrder(key, ORDER_TICK, false, address(reject));
        assertEq(takeProfit.getOrderLiquidity(id, ALICE), liquidity);
        vm.prank(ALICE);
        takeProfit.cancelOrder(key, ORDER_TICK, false, ALICE);
        assertGt(ALICE.balance, 0);
    }

    function test_reentrantOwnerCannotWithdrawTwice() public {
        _fundOwners();
        ReentrantOwner owner = new ReentrantOwner(takeProfit);
        token.transfer(address(owner), ORDER_AMOUNT);
        vm.prank(address(owner));
        token.approve(address(hook), ORDER_AMOUNT);
        OrderIdLibrary.OrderId id = _place(address(owner), ORDER_AMOUNT);
        _buyTo(ORDER_TICK - 1);
        (,,, uint256 proceeds,,) = takeProfit.getOrderInfo(id);
        owner.claim(id);
        assertFalse(owner.reentrySucceeded());
        assertEq(owner.received(), proceeds);
        assertEq(takeProfit.getOrderLiquidity(id, address(owner)), 0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
    }

    function test_hookRuntimeHasNoEscapeHatch() public view {
        bytes memory code = address(hook).code;
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; i++) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
            else assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff);
        }
    }

    function test_realCreate2DeploymentValidatesFlags() public {
        bytes memory code = abi.encodePacked(type(TakeProfitHook).creationCode, abi.encode(manager));
        bytes32 codeHash = keccak256(code);
        for (uint256 i; i < 200_000; i++) {
            bytes32 salt = bytes32(i);
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash)))));
            if (uint160(predicted) & 0x3FFF != 0x1040) continue;
            address deployed;
            assembly ("memory-safe") {
                deployed := create2(0, add(code, 32), mload(code), salt)
            }
            assertEq(deployed, predicted);
            assertEq(address(TakeProfitHook(deployed).poolManager()), address(manager));
            assertEq(flagsOf(TakeProfitHook(deployed).getHookPermissions()), 0x1040);
            return;
        }
        fail("salt not found");
    }
}
