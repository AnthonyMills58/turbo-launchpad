// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TurboToken is ERC20, Ownable {
    uint256 public raiseTarget;
    address public creator;
    uint256 public totalRaised;
    bool public graduated;
    uint256 public creatorLockAmount;
    bool public creatorBought;

    mapping(address => uint256) public lockedBalances;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 raiseTarget_,
        address creator_
    ) ERC20(name_, symbol_) Ownable(creator_) {
        raiseTarget = raiseTarget_;
        creator = creator_;
    }

    modifier onlyCreator() {
        require(msg.sender == creator, "Not creator");
        _;
    }

    function getPrice(uint256 amount) public view returns (uint256) {
        // Linear bonding curve: price = basePrice + slope * totalSupply
        uint256 basePrice = 0.001 ether;
        uint256 slope = 0.0001 ether;
        uint256 totalPrice = 0;

        for (uint256 i = 0; i < amount; i++) {
            totalPrice += basePrice + slope * (totalSupply() + i);
        }

        return totalPrice;
    }

    function buy(uint256 amount) external payable {
        require(!graduated, "Already graduated");
        uint256 cost = getPrice(amount);
        require(msg.value >= cost, "Insufficient ETH sent");

        totalRaised += msg.value;
        _mint(msg.sender, amount);
    }

    function creatorBuy(uint256 amount) external payable onlyCreator {
        require(!creatorBought, "Creator already bought");
        uint256 cost = getPrice(amount);
        require(msg.value >= cost, "Insufficient ETH sent");

        totalRaised += msg.value;
        _mint(address(this), amount);
        lockedBalances[creator] = amount;
        creatorLockAmount = amount;
        creatorBought = true;
    }

    function graduate() external {
        require(!graduated, "Already graduated");
        require(totalRaised >= raiseTarget, "Raise target not met");
        graduated = true;
    }

    function unlockCreatorTokens() external onlyCreator {
        require(graduated, "Not graduated yet");
        require(lockedBalances[creator] > 0, "No locked tokens");

        uint256 amount = lockedBalances[creator];
        lockedBalances[creator] = 0;
        _transfer(address(this), creator, amount);
    }

    // Later: add withdraw() for creator to claim ETH
}
