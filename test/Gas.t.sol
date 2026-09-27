// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TakeProfitFixture} from "./TakeProfitHook.t.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {OrderIdLibrary} from "@openzeppelin/uniswap-hooks/general/LimitOrderHook.sol";

abstract contract GasFixture is TakeProfitFixture {
    using StateLibrary for IPoolManager;

    OrderIdLibrary.OrderId internal lastId;

    function orderCount() internal pure virtual returns (int24);

    function setUp() public override {
        super.setUp();
        int24 count = orderCount();
        if (count > 0) {
            swap(key, true, -1 ether, ZERO_BYTES);
            for (int24 i = 1; i <= count; i++) {
                int24 tick = START_TICK - 60 - i * 60;
                takeProfit.placeTakeProfit(key, tick, 1000 ether);
                lastId = takeProfit.getOrderId(key, tick, false);
            }
        }
        vm.deal(address(this), 10_000_000 ether);
    }

    // Order placement occurs in setUp's separate transaction: storage writes during
    // the measured swap have the gas cost of modifying committed positions.
    function _measure(int24 steps) internal returns (uint256 used) {
        bool populated = orderCount() > 0;
        int24 start = START_TICK - (populated ? int24(60) : int24(0));
        int24 target = start - steps * 60 - (populated ? int24(1) : int24(-1));
        SwapParams memory params = SwapParams(true, -int256(10_000_000 ether), TickMath.getSqrtPriceAtTick(target));
        vm.cool(address(hook));
        vm.cool(address(manager));
        vm.cool(address(token));
        vm.cool(address(swapRouter));
        uint256 beforeGas = gasleft();
        BalanceDelta delta =
            swapRouter.swap{value: 10_000_000 ether}(key, params, PoolSwapTest.TestSettings(false, false), ZERO_BYTES);
        used = beforeGas - gasleft();
        (uint160 price,,,) = manager.getSlot0(key.toId());
        assertEq(price, params.sqrtPriceLimitX96);
        if (populated) assertTrue(_filled(lastId));
        emit log_named_uint("Order ranges", populated ? uint24(steps) : 0);
        emit log_named_uint("Steps", uint24(steps));
        emit log_named_uint("Cold swap execution gas, before refunds", used);
        emit log_named_uint("ETH input wei", uint128(-delta.amount0()));
    }
}

contract Gas100EmptyTest is GasFixture {
    function orderCount() internal pure override returns (int24) {
        return 0;
    }

    function test_gas100EmptySteps() public {
        uint256 used = _measure(100);
        assertLt(used, 1_000_000);
    }
}

contract Gas2000EmptyTest is GasFixture {
    function orderCount() internal pure override returns (int24) {
        return 0;
    }

    function test_gas2000EmptySteps() public {
        uint256 used = _measure(2000);
        assertLt(used, 20_000_000);
    }
}

contract Gas100FilledTest is GasFixture {
    function orderCount() internal pure override returns (int24) {
        return 100;
    }

    function test_gas100FilledOrders() public {
        uint256 used = _measure(100);
        assertLt(used, 18_000_000);
    }
}

contract Gas140FilledTest is GasFixture {
    function orderCount() internal pure override returns (int24) {
        return 140;
    }

    function test_gas140FilledOrders() public {
        uint256 used = _measure(140);
        assertLt(used, 24_000_000);
    }
}

contract Gas150FilledTest is GasFixture {
    function orderCount() internal pure override returns (int24) {
        return 150;
    }

    function test_gas150FilledOrders() public {
        uint256 used = _measure(150);
        assertGt(used, 24_000_000);
        assertLt(used, 30_000_000);
    }
}

contract Gas200FilledTest is GasFixture {
    function orderCount() internal pure override returns (int24) {
        return 200;
    }

    function test_gas200FilledOrders() public {
        uint256 used = _measure(200);
        assertGt(used, 30_000_000);
    }
}
