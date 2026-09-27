// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LimitOrderHook} from "@openzeppelin/uniswap-hooks/general/LimitOrderHook.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/// @notice Sell currency1 for native ETH using pooled one-tick-range limit orders.
/// @dev Inherits only afterInitialize and afterSwap (0x1040), validated by BaseHook's constructor.
///      Pool bookkeeping remains permissionless; order entry requires a native-ETH/ ERC20 pool.
contract TakeProfitHook is LimitOrderHook {
    using StateLibrary for IPoolManager;

    int24 public constant TICK_SPACING = 60;

    error NativePoolRequired();
    error EthSideOrder();
    error InvalidPool();
    error InvalidTick();
    error PoolNotInitialized();

    constructor(IPoolManager manager) BaseHook(manager) {}

    /// @notice Place a sell order with at most `amount` token wei; approve this hook first.
    /// @dev Liquidity rounds down. The manager rounds the token debit up, never above `amount`.
    function placeTakeProfit(PoolKey calldata key, int24 tick, uint256 amount) external {
        placeOrder(key, tick, false, liquidityForAmount(tick, amount));
    }

    /// @notice The inherited liquidity-denominated entry point has exactly the same restrictions.
    function placeOrder(PoolKey calldata key, int24 tick, bool zeroForOne, uint128 liquidity) public override {
        if (!key.currency0.isAddressZero()) revert NativePoolRequired();
        if (zeroForOne) revert EthSideOrder();
        if (address(key.hooks) != address(this) || key.tickSpacing != TICK_SPACING) revert InvalidPool();
        _validateTick(tick);
        (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(key.toId());
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();
        int24 currentRange = _getTickLower(currentTick, TICK_SPACING);
        if (tick == currentRange) revert InRange();
        if (tick > currentRange) revert CrossedRange();
        super.placeOrder(key, tick, false, liquidity);
    }

    /// @notice Token-only liquidity for [tick, tick + 60]; does not check a pool's current price.
    function liquidityForAmount(int24 tick, uint256 amount) public pure returns (uint128 liquidity) {
        _validateTick(tick);
        liquidity = LiquidityAmounts.getLiquidityForAmount1(
            TickMath.getSqrtPriceAtTick(tick), TickMath.getSqrtPriceAtTick(tick + TICK_SPACING), amount
        );
        if (liquidity == 0) revert ZeroLiquidity();
    }

    /// @dev Protect against the base's cached tick lag after a same-range swap/reversal. Never
    ///      remove an order while its principal still contains the token being sold.
    function _fillOrder(PoolKey calldata key, int24 tickLower, bool zeroForOne) internal override {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
        if (zeroForOne || sqrtPriceX96 > TickMath.getSqrtPriceAtTick(tickLower)) return;
        super._fillOrder(key, tickLower, false);
    }

    function _validateTick(int24 tick) private pure {
        if (
            tick % TICK_SPACING != 0 || tick < TickMath.minUsableTick(TICK_SPACING)
                || tick > TickMath.maxUsableTick(TICK_SPACING) - TICK_SPACING
        ) revert InvalidTick();
    }
}
