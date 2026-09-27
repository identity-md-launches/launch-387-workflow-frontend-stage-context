// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TakeProfitFixture} from "./TakeProfitHook.t.sol";
import {RejectEth} from "./Adversarial.t.sol";
import {LimitOrderHook, OrderIdLibrary} from "@openzeppelin/uniswap-hooks/general/LimitOrderHook.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

contract ReviewRegressionTest is TakeProfitFixture {
    using StateLibrary for IPoolManager;

    // The call itself is capped: unbounded Foundry transaction gas cannot hide the regression.
    function _boundedSwap(bool buy, uint256 amount, uint160 limit) internal returns (BalanceDelta delta) {
        vm.cool(address(hook));
        vm.cool(address(manager));
        vm.cool(address(token));
        vm.cool(address(swapRouter));
        uint256 startGas = gasleft();
        delta = swapRouter.swap{value: buy ? amount : 0, gas: 2_000_000}(
            key, SwapParams(buy, -int256(amount), limit), PoolSwapTest.TestSettings(false, false), ZERO_BYTES
        );
        emit log_named_uint(buy ? "Bounded buy execution gas" : "Bounded sell execution gas", startGas - gasleft());
    }

    function test_freeSellAcrossEntireEmptyGapCannotDisableFirstBuy() public {
        uint256 tokensBefore = token.balanceOf(address(this));
        uint256 ethBefore = address(this).balance;
        BalanceDelta sold = _boundedSwap(false, 1, TickMath.MAX_SQRT_PRICE - 1);
        assertEq(sold.amount0(), 0);
        assertEq(sold.amount1(), 0);
        assertEq(token.balanceOf(address(this)), tokensBefore);
        assertEq(address(this).balance, ethBefore);
        (, int24 tick,,) = manager.getSlot0(key.toId());
        assertEq(tick, 887_271);
        assertEq(takeProfit.getTickLowerLast(key.toId()), 887_220);
        BalanceDelta bought = _boundedSwap(true, 1 ether, TickMath.MIN_SQRT_PRICE + 1);
        assertEq(bought.amount0(), -1 ether);
        assertGt(bought.amount1(), 0);
        assertEq(address(manager).balance, 1 ether);
    }

    function test_splitFreeSellsAndRepeatedAttackRemainBounded() public {
        _boundedSwap(false, 1, TickMath.getSqrtPriceAtTick(400_020));
        _boundedSwap(false, 1, TickMath.MAX_SQRT_PRICE - 1);
        BalanceDelta first = _boundedSwap(true, 0.01 ether, TickMath.MIN_SQRT_PRICE + 1);
        assertGt(first.amount1(), 0);
        deal(address(token), address(this), 2_000_000 ether);
        BalanceDelta sold = _boundedSwap(false, 2_000_000 ether, TickMath.MAX_SQRT_PRICE - 1);
        assertGt(sold.amount0(), 0);
        assertEq(takeProfit.getTickLowerLast(key.toId()), 887_220);
        BalanceDelta second = _boundedSwap(true, 0.01 ether, TickMath.MIN_SQRT_PRICE + 1);
        assertGt(second.amount1(), 0);
    }

    function test_emptyGapAfterFundedSellStillAllowsOrderFill() public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        deal(address(token), address(this), 2_000_000 ether);
        BalanceDelta sold = _boundedSwap(false, 2_000_000 ether, TickMath.MAX_SQRT_PRICE - 1);
        assertGt(sold.amount0(), 0.99 ether);
        assertEq(takeProfit.getTickLowerLast(key.toId()), 887_220);
        _boundedSwap(true, 900 ether, TickMath.getSqrtPriceAtTick(ORDER_TICK));
        assertTrue(_filled(id));
        vm.prank(ALICE);
        takeProfit.withdraw(id, ALICE);
        assertGt(ALICE.balance, 0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
    }

    function test_exactLowerBoundaryFillsAndReversalCannotUndoProceeds() public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        _buyTo(ORDER_TICK + 1);
        assertFalse(_filled(id));
        vm.expectEmit(true, false, false, true, address(hook));
        emit LimitOrderHook.Fill(id, key, ORDER_TICK, false);
        _buyTo(ORDER_TICK);
        (, int24 tick,,) = manager.getSlot0(key.toId());
        assertEq(tick, ORDER_TICK - 1);
        assertEq(takeProfit.getTickLowerLast(key.toId()), ORDER_TICK - 60);
        assertTrue(_filled(id));
        (uint128 liquidity,,) = manager.getPositionInfo(key.toId(), address(hook), ORDER_TICK, ORDER_TICK + 60, 0);
        assertEq(liquidity, 0);
        (,,, uint256 proceeds, uint256 tokens,) = takeProfit.getOrderInfo(id);
        assertGt(proceeds, 0.01 ether);
        assertEq(tokens, 0);
        _reverse();
        vm.prank(ALICE);
        takeProfit.withdraw(id, ALICE);
        assertEq(ALICE.balance, proceeds);
        vm.expectRevert(LimitOrderHook.ZeroLiquidity.selector);
        vm.prank(ALICE);
        takeProfit.withdraw(id, ALICE);
    }

    function test_bitmapHandlesNegativeWordsAdjacentOrdersAndExactBoundaries() public {
        // Exercise bit 0 and bit 255, negative word positions, empty words, and a cached
        // bit whose tick is cleared by filling the adjacent order earlier in the same loop.
        PoolKey memory other = key;
        other.fee = 500;
        manager.initialize(other, TickMath.getSqrtPriceAtTick(120));
        deal(address(token), address(this), 10_000_000 ether);
        modifyLiquidityRouter.modifyLiquidity(
            other, ModifyLiquidityParams(-60_000, 120, 1_000_000 ether, 0), ZERO_BYTES
        );
        int24[7] memory ticks = [int24(60), 0, -60, -15_360, -15_420, -30_720, -30_780];
        OrderIdLibrary.OrderId[7] memory ids;
        for (uint256 i; i < ticks.length; ++i) {
            takeProfit.placeTakeProfit(other, ticks[i], 1 ether);
            ids[i] = takeProfit.getOrderId(other, ticks[i], false);
        }
        vm.deal(address(this), 100_000_000 ether);
        swapRouter.swap{value: 90_000_000 ether}(
            other,
            SwapParams(true, -int256(90_000_000 ether), TickMath.getSqrtPriceAtTick(-30_720)),
            PoolSwapTest.TestSettings(false, false),
            ZERO_BYTES
        );
        for (uint256 i; i < ticks.length - 1; ++i) {
            assertTrue(_filled(ids[i]));
            (uint128 liquidity,,) = manager.getPositionInfo(other.toId(), address(hook), ticks[i], ticks[i] + 60, 0);
            assertEq(liquidity, 0);
            takeProfit.withdraw(ids[i], address(this));
        }
        assertFalse(_filled(ids[6]), "range at upper boundary is not filled");
        assertGt(takeProfit.getOrderLiquidity(ids[6], address(this)), 0);
        assertEq(takeProfit.getTickLowerLast(other.toId()), -30_780);
        assertEq(takeProfit.getTickLowerLast(key.toId()), START_TICK, "pool cursors are isolated");
        assertEq(manager.balanceOf(address(hook), 0), 0);
    }

    function test_emptyPoolCanTraverseEntireTickDomainWithinGasLimit() public {
        PoolKey memory other = key;
        other.fee = 500;
        manager.initialize(other, TickMath.MAX_SQRT_PRICE - 1);
        BalanceDelta delta = swapRouter.swap{value: 1, gas: 2_000_000}(
            other,
            SwapParams(true, -1, TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false),
            ZERO_BYTES
        );
        assertEq(delta.amount0(), 0);
        assertEq(delta.amount1(), 0);
        assertEq(takeProfit.getTickLowerLast(other.toId()), -887_280);
        assertEq(takeProfit.getTickLowerLast(key.toId()), START_TICK);
    }

    function test_cancellationPaysHistoricalAndFreshFeesAndRejectedRecipientCanRetry() public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        _place(BOB, ORDER_AMOUNT);
        _buyTo(ORDER_TICK + 30);
        _reverse();
        // The top-up checkpoints the old 1:1 split; subsequent fees accrue in a 2:1 split.
        _place(ALICE, ORDER_AMOUNT);
        (,,, uint256 stored0, uint256 stored1,) = takeProfit.getOrderInfo(id);
        _buyTo(ORDER_TICK + 30);
        _reverse();
        (uint256 totalFees0, uint256 totalFees1) = _totalFees(id);
        assertGt(totalFees0, stored0);
        assertGt(totalFees1, stored1);
        uint256 expectedAlice0 = stored0 / 2 + (totalFees0 - stored0) * 2 / 3;
        uint256 expectedAlice1 = stored1 / 2 + (totalFees1 - stored1) * 2 / 3;
        uint256 ownerLiquidity = takeProfit.getOrderLiquidity(id, ALICE);
        RejectEth reject = new RejectEth();
        vm.expectRevert();
        vm.prank(ALICE);
        takeProfit.cancelOrder(key, ORDER_TICK, false, address(reject));
        assertEq(takeProfit.getOrderLiquidity(id, ALICE), ownerLiquidity);
        assertEq(manager.balanceOf(address(hook), 0), stored0);
        assertEq(manager.balanceOf(address(hook), uint160(address(token))), stored1);
        address recipient = address(0xCAFE);
        vm.prank(ALICE);
        takeProfit.cancelOrder(key, ORDER_TICK, false, recipient);
        assertApproxEqAbs(recipient.balance, expectedAlice0, 3);
        assertApproxEqAbs(token.balanceOf(recipient), _tokenPrincipal(uint128(ownerLiquidity)) + expectedAlice1, 3);
        vm.prank(BOB);
        takeProfit.cancelOrder(key, ORDER_TICK, false, BOB);
        assertEq(recipient.balance + BOB.balance, totalFees0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
        assertEq(manager.balanceOf(address(hook), uint160(address(token))), 0);
    }

    function _reverse() internal {
        swapRouter.swap(
            key,
            SwapParams(false, -int256(30_000_000 ether), TickMath.getSqrtPriceAtTick(137_900)),
            PoolSwapTest.TestSettings(false, false),
            ZERO_BYTES
        );
    }

    function _tokenPrincipal(uint128 liquidity) internal pure returns (uint256) {
        return SqrtPriceMath.getAmount1Delta(
            TickMath.getSqrtPriceAtTick(ORDER_TICK), TickMath.getSqrtPriceAtTick(ORDER_TICK + 60), liquidity, false
        );
    }

    function _joinWithDust() internal {
        vm.prank(BOB);
        takeProfit.placeOrder(key, ORDER_TICK, false, 1);
    }

    function _totalFees(OrderIdLibrary.OrderId id) internal view returns (uint256 fee0, uint256 fee1) {
        (,,, fee0, fee1,) = takeProfit.getOrderInfo(id);
        (uint128 liquidity, uint256 last0, uint256 last1) =
            manager.getPositionInfo(key.toId(), address(hook), ORDER_TICK, ORDER_TICK + 60, 0);
        (uint256 growth0, uint256 growth1) = manager.getFeeGrowthInside(key.toId(), ORDER_TICK, ORDER_TICK + 60);
        fee0 += FullMath.mulDiv(growth0 - last0, liquidity, 1 << 128);
        fee1 += FullMath.mulDiv(growth1 - last1, liquidity, 1 << 128);
    }

    function testFuzz_dustJoinerCannotCaptureCancellingOwnerFees(bool lateJoin, bool aliceFirst) public {
        _fundOwners();
        uint256 aliceTokens = token.balanceOf(ALICE);
        uint256 bobTokens = token.balanceOf(BOB);
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        if (!lateJoin) _joinWithDust();
        for (uint256 i; i < 5; ++i) {
            _buyTo(ORDER_TICK + 30);
            _reverse();
        }
        if (lateJoin) _joinWithDust();
        assertEq(takeProfit.getOrderLiquidity(id, BOB), 1);
        (uint256 fees0, uint256 fees1) = _totalFees(id);
        assertGt(fees0, 70_000_000_000_000);
        address first = aliceFirst ? ALICE : BOB;
        address second = aliceFirst ? BOB : ALICE;
        vm.prank(first);
        takeProfit.cancelOrder(key, ORDER_TICK, false, first);
        vm.prank(second);
        takeProfit.cancelOrder(key, ORDER_TICK, false, second);
        assertApproxEqAbs(ALICE.balance, fees0, 5, "earned ETH stays with Alice");
        assertApproxEqAbs(token.balanceOf(ALICE), aliceTokens + fees1, 5, "earned TKPF stays with Alice");
        assertLe(BOB.balance, 5, "dust joiner can receive only rounding dust");
        assertLe(token.balanceOf(BOB), bobTokens + 5);
        assertEq(ALICE.balance + BOB.balance, fees0, "all ETH fees are paid");
        assertEq(manager.balanceOf(address(hook), 0), 0);
        assertEq(manager.balanceOf(address(hook), uint160(address(token))), 0);
        (,,, uint256 total0, uint256 total1, uint128 liquidity) = takeProfit.getOrderInfo(id);
        assertEq(total0, 0);
        assertEq(total1, 0);
        assertEq(liquidity, 0);
    }
}
