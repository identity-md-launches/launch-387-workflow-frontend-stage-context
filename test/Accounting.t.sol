// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TakeProfitFixture} from "./TakeProfitHook.t.sol";
import {OrderIdLibrary} from "@openzeppelin/uniswap-hooks/general/LimitOrderHook.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

contract AccountingTest is TakeProfitFixture {
    function _reverseAboveOrder() internal {
        swapRouter.swap(
            key,
            SwapParams(false, -int256(30_000_000 ether), TickMath.getSqrtPriceAtTick(137_940)),
            PoolSwapTest.TestSettings(false, false),
            ZERO_BYTES
        );
    }

    function test_lastCancellationRedeemsPreviouslyCollectedFees() public {
        _fundOwners();
        _place(ALICE, ORDER_AMOUNT);
        OrderIdLibrary.OrderId id = _place(BOB, ORDER_AMOUNT);
        _buyTo(ORDER_TICK + 30);
        vm.prank(ALICE);
        takeProfit.cancelOrder(key, ORDER_TICK, false, ALICE);
        uint256 storedClaims = manager.balanceOf(address(hook), 0);
        assertGt(storedClaims, 0, "first cancellation collects fees for remaining owners");
        vm.prank(BOB);
        takeProfit.cancelOrder(key, ORDER_TICK, false, BOB);
        assertEq(manager.balanceOf(address(hook), 0), 0, "last cancellation must redeem stored claims");
        assertGt(BOB.balance, ALICE.balance, "remaining owner receives forfeited fees");
        (,,, uint256 total0, uint256 total1, uint128 liquidity) = takeProfit.getOrderInfo(id);
        assertEq(total0, 0);
        assertEq(total1, 0);
        assertEq(liquidity, 0);
    }

    function testFuzz_lateTinyJoinerCanWithdrawInEitherOrder(bool lateFirst) public {
        _fundOwners();
        _place(ALICE, ORDER_AMOUNT);
        OrderIdLibrary.OrderId id = _place(BOB, ORDER_AMOUNT);
        _buyTo(ORDER_TICK + 30);
        vm.prank(ALICE);
        takeProfit.cancelOrder(key, ORDER_TICK, false, ALICE);
        _reverseAboveOrder();
        _place(ALICE, 1 gwei);
        _buyTo(ORDER_TICK - 1);
        (,,, uint256 total0, uint256 total1,) = takeProfit.getOrderInfo(id);
        uint256 beforeAlice = ALICE.balance;
        address first = lateFirst ? ALICE : BOB;
        address second = lateFirst ? BOB : ALICE;
        vm.prank(first);
        (uint256 first0, uint256 first1) = takeProfit.withdraw(id, first);
        vm.prank(second);
        (uint256 second0, uint256 second1) = takeProfit.withdraw(id, second);
        assertEq(first0 + second0, total0);
        assertEq(first1 + second1, total1);
        assertGt(ALICE.balance, beforeAlice);
        assertLt(ALICE.balance - beforeAlice, 10_000, "tiny late joiner cannot capture old fees");
        assertEq(manager.balanceOf(address(hook), 0), 0);
        assertEq(manager.balanceOf(address(hook), uint160(address(token))), 0);
    }

    function testFuzz_repeatedTopupsAndCancelsConserveClaims(uint256 seed) public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        _place(BOB, ORDER_AMOUNT * 2);
        _place(address(this), ORDER_AMOUNT * 3);
        for (uint256 i; i < 3; ++i) {
            _buyTo(ORDER_TICK + 30);
            address cancelling = (seed >> i) & 1 == 0 ? ALICE : BOB;
            vm.prank(cancelling);
            takeProfit.cancelOrder(key, ORDER_TICK, false, cancelling);
            _reverseAboveOrder();
            _place(cancelling, ORDER_AMOUNT);
            // Repeated deposits by an existing owner must preserve earned fees.
            _place(address(this), ORDER_AMOUNT);
        }
        _buyTo(ORDER_TICK - 1);
        (,,, uint256 total0, uint256 total1,) = takeProfit.getOrderInfo(id);
        assertEq(manager.balanceOf(address(hook), 0), total0);
        assertEq(manager.balanceOf(address(hook), uint160(address(token))), total1);
        address[3] memory owners = [ALICE, BOB, address(this)];
        uint256 paid0;
        uint256 paid1;
        uint256 offset = seed % 3;
        for (uint256 i; i < 3; ++i) {
            address owner = owners[(i + offset) % 3];
            vm.prank(owner);
            (uint256 amount0, uint256 amount1) = takeProfit.withdraw(id, owner);
            paid0 += amount0;
            paid1 += amount1;
            assertGt(amount0, 0);
            assertEq(takeProfit.getOrderLiquidity(id, owner), 0);
        }
        assertEq(paid0, total0);
        assertEq(paid1, total1);
        assertEq(manager.balanceOf(address(hook), 0), 0);
        assertEq(manager.balanceOf(address(hook), uint160(address(token))), 0);
    }
}
