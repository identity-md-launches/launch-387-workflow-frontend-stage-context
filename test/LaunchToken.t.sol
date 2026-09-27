// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";

contract LaunchTokenTest is Test {
    LaunchToken token;
    address constant ALICE = address(0xA11CE);

    function setUp() public {
        token = new LaunchToken();
    }

    function test_metadataAndSingleMintToDeployer() public view {
        assertEq(token.name(), "Takeprofit");
        assertEq(token.symbol(), "TKPF");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(this)), token.totalSupply());
    }

    function testFuzz_transfersConserveSupply(uint256 rawAmount) public {
        uint256 amount = bound(rawAmount, 0, token.totalSupply());
        assertTrue(token.transfer(ALICE, amount));
        assertEq(token.balanceOf(ALICE), amount);
        assertEq(token.balanceOf(address(this)), token.totalSupply() - amount);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
    }

    function test_transferFromApprovalAndFailures() public {
        vm.expectRevert();
        vm.prank(ALICE);
        token.transferFrom(address(this), ALICE, 1 ether);
        token.approve(ALICE, 2 ether);
        vm.prank(ALICE);
        assertTrue(token.transferFrom(address(this), ALICE, 1 ether));
        assertEq(token.allowance(address(this), ALICE), 1 ether);
        vm.expectRevert();
        vm.prank(ALICE);
        token.transfer(address(this), 2 ether);
        vm.expectRevert();
        token.transfer(address(0), 1);
    }

    function test_noAdminOrMintEvenForDeployer() public {
        string[10] memory signatures = [
            "mint(address,uint256)",
            "mint(uint256)",
            "mint()",
            "issue(uint256)",
            "setOwner(address)",
            "transferOwnership(address)",
            "upgradeTo(address)",
            "initialize(address)",
            "unpause()",
            "setMinter(address)"
        ];
        for (uint256 i; i < signatures.length; ++i) {
            bytes memory data = abi.encodeWithSignature(signatures[i], ALICE, type(uint128).max);
            (bool ownerOk,) = address(token).call(data);
            assertFalse(ownerOk);
            vm.prank(ALICE);
            (bool otherOk,) = address(token).call(data);
            assertFalse(otherOk);
        }
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(ALICE), 0);
    }

    function test_runtimeHasNoEscapeHatch() public view {
        bytes memory code = address(token).code;
        for (uint256 i; i < code.length; i++) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
            else assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff);
        }
    }
}
