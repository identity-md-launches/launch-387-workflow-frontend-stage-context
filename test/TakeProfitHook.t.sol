// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHookTest} from "./BaseHookTest.sol";
import {TakeProfitHook} from "../src/TakeProfitHook.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {LimitOrderHook, OrderIdLibrary} from "@openzeppelin/uniswap-hooks/general/LimitOrderHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

abstract contract TakeProfitFixture is BaseHookTest {
    using StateLibrary for IPoolManager;

    TakeProfitHook internal takeProfit;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    int24 internal constant ORDER_TICK = 137_760;
    uint256 internal constant ORDER_AMOUNT = 10_000 ether;

    function setUp() public virtual override {
        super.setUp();
        takeProfit = TakeProfitHook(address(hook));
        token.approve(address(takeProfit), type(uint256).max);
    }

    function _fundOwners() internal {
        swap(key, true, -1 ether, ZERO_BYTES);
        token.transfer(ALICE, 200_000 ether);
        token.transfer(BOB, 200_000 ether);
        vm.prank(ALICE);
        token.approve(address(takeProfit), type(uint256).max);
        vm.prank(BOB);
        token.approve(address(takeProfit), type(uint256).max);
    }

    function _place(address owner, uint256 amount) internal returns (OrderIdLibrary.OrderId id) {
        vm.prank(owner);
        takeProfit.placeTakeProfit(key, ORDER_TICK, amount);
        return takeProfit.getOrderId(key, ORDER_TICK, false);
    }

    function _buyTo(int24 tick) internal returns (BalanceDelta delta) {
        delta = swapRouter.swap{value: 900 ether}(
            key,
            SwapParams(true, -int256(900 ether), TickMath.getSqrtPriceAtTick(tick)),
            PoolSwapTest.TestSettings(false, false),
            ZERO_BYTES
        );
        (uint160 sqrtPrice,,,) = manager.getSlot0(key.toId());
        assertEq(sqrtPrice, TickMath.getSqrtPriceAtTick(tick), "swap reaches requested price");
    }

    function _filled(OrderIdLibrary.OrderId id) internal view returns (bool filled) {
        (filled,,,,,) = takeProfit.getOrderInfo(id);
    }
}

contract TakeProfitHookTest is TakeProfitFixture {
    using StateLibrary for IPoolManager;

    function test_launchPoolFirstBuyAndSell() public {
        assertEq(address(manager).balance, 0);
        assertLt(token.totalSupply() - token.balanceOf(address(manager)), 1 gwei);
        BalanceDelta bought = swap(key, true, -1 ether, ZERO_BYTES);
        assertEq(bought.amount0(), -1 ether);
        assertGt(bought.amount1(), 0);
        assertEq(address(manager).balance, 1 ether);
        BalanceDelta sold = swap(key, false, -int256(int128(bought.amount1())), ZERO_BYTES);
        assertGt(sold.amount0(), 0);
        assertLt(sold.amount0(), 1 ether);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
    }

    function test_permissionsAndManager() public view {
        assertEq(flagsOf(hook.getHookPermissions()), 0x1040);
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, 0x1040);
        assertEq(address(hook.poolManager()), address(manager));
        assertEq(takeProfit.getTickLowerLast(key.toId()), START_TICK);
        assertLt(address(hook).code.length, 24_577);
    }

    function test_callbacksAndUnlockRefuseExternalCallers() public {
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterInitialize(address(this), key, SQRT_PRICE_1_1, 0);
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), key, SWAP_PARAMS, BalanceDeltaLibrary.ZERO_DELTA, ZERO_BYTES);
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        takeProfit.unlockCallback(ZERO_BYTES);
    }

    function test_constructorRejectsWrongAddressFlags() public {
        vm.expectRevert();
        new TakeProfitHook(manager);
    }

    function test_validOrderUsesTokensOnlyAndBothEntryPointsShareId() public {
        _fundOwners();
        uint256 beforeTokens = token.balanceOf(ALICE);
        uint256 beforeEth = ALICE.balance;
        uint128 liquidity = takeProfit.liquidityForAmount(ORDER_TICK, ORDER_AMOUNT);
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        assertGt(OrderIdLibrary.OrderId.unwrap(id), 0);
        assertEq(takeProfit.getOrderLiquidity(id, ALICE), liquidity);
        assertApproxEqAbs(beforeTokens - token.balanceOf(ALICE), ORDER_AMOUNT, 1000);
        assertLe(beforeTokens - token.balanceOf(ALICE), ORDER_AMOUNT);
        assertEq(ALICE.balance, beforeEth);
        vm.prank(BOB);
        takeProfit.placeOrder(key, ORDER_TICK, false, liquidity);
        assertEq(takeProfit.getOrderLiquidity(id, BOB), liquidity);
        assertEq(
            OrderIdLibrary.OrderId.unwrap(takeProfit.getOrderId(key, ORDER_TICK, false)),
            OrderIdLibrary.OrderId.unwrap(id)
        );
    }

    function test_invalidTicksAndAmounts() public {
        _fundOwners();
        vm.expectRevert(LimitOrderHook.InRange.selector);
        takeProfit.placeTakeProfit(key, 137_940, ORDER_AMOUNT);
        vm.expectRevert(LimitOrderHook.CrossedRange.selector);
        takeProfit.placeTakeProfit(key, 138_000, ORDER_AMOUNT);
        vm.expectRevert(TakeProfitHook.InvalidTick.selector);
        takeProfit.placeTakeProfit(key, ORDER_TICK + 1, ORDER_AMOUNT);
        vm.expectRevert(TakeProfitHook.InvalidTick.selector);
        takeProfit.liquidityForAmount(-887_280, ORDER_AMOUNT);
        vm.expectRevert(TakeProfitHook.InvalidTick.selector);
        takeProfit.liquidityForAmount(887_220, ORDER_AMOUNT);
        vm.expectRevert(LimitOrderHook.ZeroLiquidity.selector);
        takeProfit.placeTakeProfit(key, ORDER_TICK, 0);
        vm.expectRevert(LimitOrderHook.ZeroLiquidity.selector);
        takeProfit.placeOrder(key, ORDER_TICK, false, 0);
        vm.expectRevert(TakeProfitHook.InvalidTick.selector);
        takeProfit.placeOrder(key, ORDER_TICK + 1, false, 1);
    }

    function test_ethSideRefusedEvenWithHookBalance() public {
        vm.deal(address(hook), 100 ether);
        vm.expectRevert(TakeProfitHook.EthSideOrder.selector);
        takeProfit.placeOrder(key, START_TICK + 60, true, 1 ether);
        assertEq(address(hook).balance, 100 ether);
    }

    function test_poolRestrictionsAndUninitializedPool() public {
        PoolKey memory other = key;
        other.currency0 = Currency.wrap(address(1));
        vm.expectRevert(TakeProfitHook.NativePoolRequired.selector);
        takeProfit.placeTakeProfit(other, ORDER_TICK, ORDER_AMOUNT);
        vm.expectRevert(TakeProfitHook.NativePoolRequired.selector);
        takeProfit.placeOrder(other, ORDER_TICK, false, 1 ether);
        other = key;
        other.tickSpacing = 10;
        vm.expectRevert(TakeProfitHook.InvalidPool.selector);
        takeProfit.placeTakeProfit(other, ORDER_TICK, ORDER_AMOUNT);
        other = key;
        other.hooks = IHooks(address(0));
        vm.expectRevert(TakeProfitHook.InvalidPool.selector);
        takeProfit.placeOrder(other, ORDER_TICK, false, 1 ether);
        other = key;
        other.fee = 500;
        vm.expectRevert(TakeProfitHook.PoolNotInitialized.selector);
        takeProfit.placeTakeProfit(other, ORDER_TICK, ORDER_AMOUNT);
    }

    function test_bookkeepingOnErc20PoolAndPoolIsolation() public {
        (Currency a, Currency b) = deployMintAndApprove2Currencies();
        (PoolKey memory other,) = initPoolAndAddLiquidity(a, b, IHooks(address(hook)), 3000, SQRT_PRICE_1_1);
        assertEq(takeProfit.getTickLowerLast(other.toId()), 0);
        swap(other, true, -0.001 ether, ZERO_BYTES);
        assertEq(takeProfit.getTickLowerLast(key.toId()), START_TICK);
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        swapRouter.swap(
            other,
            SwapParams(true, -int256(0.01 ether), TickMath.getSqrtPriceAtTick(-60)),
            PoolSwapTest.TestSettings(false, false),
            ZERO_BYTES
        );
        assertFalse(_filled(id));
        vm.expectRevert(TakeProfitHook.NativePoolRequired.selector);
        takeProfit.placeTakeProfit(other, -240, ORDER_AMOUNT);
    }

    function test_negativeTickRoundingAndLowerBoundary() public {
        _fundOwners();
        PoolKey memory other = key;
        other.fee = 500;
        manager.initialize(other, TickMath.getSqrtPriceAtTick(-1));
        assertEq(takeProfit.getTickLowerLast(other.toId()), -60);
        vm.expectRevert(LimitOrderHook.InRange.selector);
        takeProfit.placeTakeProfit(other, -60, 1 ether);
        takeProfit.placeTakeProfit(other, -120, 1 ether);
        assertGt(OrderIdLibrary.OrderId.unwrap(takeProfit.getOrderId(other, -120, false)), 0);
        assertGt(takeProfit.liquidityForAmount(-887_220, 1), 0);
    }

    function test_missingApprovalRollsBackOrder() public {
        _fundOwners();
        vm.prank(ALICE);
        token.approve(address(hook), 0);
        vm.expectRevert();
        vm.prank(ALICE);
        takeProfit.placeTakeProfit(key, ORDER_TICK, ORDER_AMOUNT);
        assertEq(OrderIdLibrary.OrderId.unwrap(takeProfit.getOrderId(key, ORDER_TICK, false)), 0);
    }

    function test_partialCrossDoesNotFillOrAllowWithdraw() public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        _buyTo(ORDER_TICK + 30);
        assertFalse(_filled(id));
        assertGt(takeProfit.getOrderLiquidity(id, ALICE), 0);
        vm.expectRevert(LimitOrderHook.NotFilled.selector);
        vm.prank(ALICE);
        takeProfit.withdraw(id, ALICE);
        _buyTo(ORDER_TICK + 1);
        assertFalse(_filled(id));
        _buyTo(ORDER_TICK - 1);
        assertTrue(_filled(id));
    }

    function test_fullCrossPaysExpectedEthAndDoubleWithdrawReverts() public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        uint128 liquidity = uint128(takeProfit.getOrderLiquidity(id, ALICE));
        uint256 expectedPrincipal = SqrtPriceMath.getAmount0Delta(
            TickMath.getSqrtPriceAtTick(ORDER_TICK), TickMath.getSqrtPriceAtTick(ORDER_TICK + 60), liquidity, false
        );
        _buyTo(ORDER_TICK - 1);
        assertTrue(_filled(id));
        (,,, uint256 total0, uint256 total1,) = takeProfit.getOrderInfo(id);
        assertEq(total1, 0);
        assertGe(total0, expectedPrincipal);
        assertApproxEqRel(total0, expectedPrincipal, 0.004e18);
        assertEq(manager.balanceOf(address(hook), 0), total0);
        assertEq(address(hook).balance, 0, "proceeds are claims, not hook ETH");
        vm.prank(ALICE);
        (uint256 received0, uint256 received1) = takeProfit.withdraw(id, ALICE);
        assertEq(ALICE.balance, total0);
        assertEq(received0, total0);
        assertEq(received1, 0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
        vm.expectRevert(LimitOrderHook.ZeroLiquidity.selector);
        vm.prank(ALICE);
        takeProfit.withdraw(id, ALICE);
    }

    function testFuzz_twoOwnersPaidProRata(uint96 rawAmount, bool bobFirst) public {
        _fundOwners();
        uint256 amount = bound(uint256(rawAmount), 1 ether, 50_000 ether);
        OrderIdLibrary.OrderId id = _place(ALICE, amount);
        _place(BOB, amount * 3);
        uint256 aliceLiquidity = takeProfit.getOrderLiquidity(id, ALICE);
        uint256 bobLiquidity = takeProfit.getOrderLiquidity(id, BOB);
        _buyTo(ORDER_TICK - 1);
        (,,, uint256 total0,,) = takeProfit.getOrderInfo(id);
        address first = bobFirst ? BOB : ALICE;
        address second = bobFirst ? ALICE : BOB;
        vm.prank(first);
        takeProfit.withdraw(id, first);
        vm.prank(second);
        takeProfit.withdraw(id, second);
        assertApproxEqAbs(ALICE.balance, total0 * aliceLiquidity / (aliceLiquidity + bobLiquidity), 2);
        assertEq(ALICE.balance + BOB.balance, total0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
    }

    function test_cancelBeforeCrossAndDoubleCancelReverts() public {
        _fundOwners();
        uint256 beforeTokens = token.balanceOf(ALICE);
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        vm.prank(ALICE);
        takeProfit.cancelOrder(key, ORDER_TICK, false, ALICE);
        assertApproxEqAbs(token.balanceOf(ALICE), beforeTokens, 1);
        assertEq(ALICE.balance, 0);
        assertEq(takeProfit.getOrderLiquidity(id, ALICE), 0);
        assertEq(OrderIdLibrary.OrderId.unwrap(takeProfit.getOrderId(key, ORDER_TICK, false)), 0);
        vm.expectRevert(LimitOrderHook.ZeroLiquidity.selector);
        vm.prank(ALICE);
        takeProfit.cancelOrder(key, ORDER_TICK, false, ALICE);
    }

    function test_cancelAfterPartialCrossReturnsBothCurrencies() public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        uint256 beforeTokens = token.balanceOf(ALICE);
        _buyTo(ORDER_TICK + 30);
        vm.prank(ALICE);
        takeProfit.cancelOrder(key, ORDER_TICK, false, ALICE);
        assertGt(ALICE.balance, 0);
        assertGt(token.balanceOf(ALICE), beforeTokens);
        assertLt(token.balanceOf(ALICE) - beforeTokens, ORDER_AMOUNT);
        assertFalse(_filled(id));
        assertEq(takeProfit.getOrderLiquidity(id, ALICE), 0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
    }

    function test_nonOwnerCannotCancelOrWithdraw() public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        vm.expectRevert(LimitOrderHook.ZeroLiquidity.selector);
        vm.prank(BOB);
        takeProfit.cancelOrder(key, ORDER_TICK, false, BOB);
        _buyTo(ORDER_TICK - 1);
        vm.expectRevert(LimitOrderHook.ZeroLiquidity.selector);
        vm.prank(BOB);
        takeProfit.withdraw(id, BOB);
    }

    function test_newOrderAfterFillGetsNewIdAndSwapBackCannotReopenFill() public {
        _fundOwners();
        OrderIdLibrary.OrderId oldId = _place(ALICE, ORDER_AMOUNT);
        _buyTo(ORDER_TICK - 1);
        (,,, uint256 proceeds,,) = takeProfit.getOrderInfo(oldId);
        swapRouter.swap(
            key,
            SwapParams(false, -int256(30_000_000 ether), TickMath.getSqrtPriceAtTick(137_940)),
            PoolSwapTest.TestSettings(false, false),
            ZERO_BYTES
        );
        OrderIdLibrary.OrderId newId = _place(ALICE, ORDER_AMOUNT);
        assertGt(OrderIdLibrary.OrderId.unwrap(newId), OrderIdLibrary.OrderId.unwrap(oldId));
        assertFalse(_filled(newId));
        vm.prank(ALICE);
        takeProfit.withdraw(oldId, ALICE);
        assertEq(ALICE.balance, proceeds);
    }

    function test_lifecycleEventsExposeOrderOwnershipAndStatus() public {
        _fundOwners();
        uint128 liquidity = takeProfit.liquidityForAmount(ORDER_TICK, ORDER_AMOUNT);
        OrderIdLibrary.OrderId id = OrderIdLibrary.OrderId.wrap(1);
        vm.expectEmit(true, true, false, true, address(hook));
        emit LimitOrderHook.Place(ALICE, id, key, ORDER_TICK, false, liquidity);
        _place(ALICE, ORDER_AMOUNT);
        vm.expectEmit(true, false, false, true, address(hook));
        emit LimitOrderHook.Fill(id, key, ORDER_TICK, false);
        _buyTo(ORDER_TICK - 1);
        vm.expectEmit(true, true, false, true, address(hook));
        emit LimitOrderHook.Withdraw(ALICE, id, liquidity);
        vm.prank(ALICE);
        takeProfit.withdraw(id, ALICE);
    }

    function test_cancellationEventExposesOwnerAndLiquidity() public {
        _fundOwners();
        OrderIdLibrary.OrderId id = _place(ALICE, ORDER_AMOUNT);
        uint128 liquidity = uint128(takeProfit.getOrderLiquidity(id, ALICE));
        vm.expectEmit(true, true, false, true, address(hook));
        emit LimitOrderHook.Cancel(ALICE, id, key, ORDER_TICK, false, liquidity);
        vm.prank(ALICE);
        takeProfit.cancelOrder(key, ORDER_TICK, false, ALICE);
    }

    function test_gasBuyCrossing100Steps() public {
        uint256 beforeGas = gasleft();
        BalanceDelta delta = _buyTo(START_TICK - 6000 + 1);
        uint256 used = beforeGas - gasleft();
        assertEq(takeProfit.getTickLowerLast(key.toId()), START_TICK - 6000);
        assertLt(used, 2_000_000);
        emit log_named_uint("100-step buy execution gas (no orders)", used);
        emit log_named_uint("100-step buy ETH wei", uint128(-delta.amount0()));
    }
}
