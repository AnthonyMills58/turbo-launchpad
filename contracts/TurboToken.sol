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

    uint256 public immutable maxSupply;
    uint256 public constant LP_AND_AIRDROP_PERCENT = 20; // 20% rezerwa

    mapping(address => uint256) public lockedBalances;

    // Airdrop logic
    mapping(address => uint256) public airdropAllocations;
    mapping(address => bool) public airdropClaimed;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 raiseTarget_,
        address creator_,
        uint256 maxSupply_ // e.g., 1_000_000_000 ether
    ) ERC20(name_, symbol_) Ownable(creator_) {
        raiseTarget = raiseTarget_;
        creator = creator_;
        maxSupply = maxSupply_;
    }

    modifier onlyCreator() {
        require(msg.sender == creator, "Not creator");
        _;
    }

    modifier onlyBeforeGraduate() {
        require(!graduated, "Already graduated");
        _;
    }

    function getPrice(uint256 amount) public view returns (uint256) {
        uint256 basePrice = 0.001 ether;
        uint256 slope = 0.0001 ether;
        uint256 totalPrice = 0;

        for (uint256 i = 0; i < amount; i++) {
            totalPrice += basePrice + slope * (totalSupply() + i);
        }

        return totalPrice;
    }

    function buy(uint256 amount) external payable onlyBeforeGraduate {
        uint256 cost = getPrice(amount);
        require(msg.value >= cost, "Insufficient ETH sent");
        require(totalSupply() + amount <= maxSupplyForSale(), "Exceeds available supply");

        totalRaised += msg.value;
        _mint(msg.sender, amount);
    }

    function creatorBuy(uint256 amount) external payable onlyCreator onlyBeforeGraduate {
        require(!creatorBought, "Creator already bought");
        uint256 cost = getPrice(amount);
        require(msg.value >= cost, "Insufficient ETH sent");
        require(totalSupply() + amount <= maxSupplyForSale(), "Exceeds available supply");

        totalRaised += msg.value;
        _mint(address(this), amount);
        lockedBalances[creator] = amount;
        creatorLockAmount = amount;
        creatorBought = true;
    }

    function graduate() external {
        require(!graduated, "Already graduated");
        require(totalRaised >= raiseTarget, "Raise target not met");
        require(totalSupply() <= maxSupplyForSale(), "Must reserve LP/airdrop");

        graduated = true;
    }

    function unlockCreatorTokens() external onlyCreator {
        require(graduated, "Not graduated yet");
        require(lockedBalances[creator] > 0, "No locked tokens");

        uint256 amount = lockedBalances[creator];
        lockedBalances[creator] = 0;
        _transfer(address(this), creator, amount);
    }

    // ===== Airdrop Logic =====

    function setAirdropAllocations(address[] calldata recipients, uint256[] calldata amounts) external onlyCreator {
        require(!graduated, "Already graduated");
        require(recipients.length == amounts.length, "Length mismatch");

        uint256 totalToAllocate = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            airdropAllocations[recipients[i]] = amounts[i];
            totalToAllocate += amounts[i];
        }

        require(totalToAllocate <= reservedForAirdrop(), "Exceeds airdrop reserve");
    }

    function claimAirdrop() external {
        require(graduated, "Not graduated");
        require(!airdropClaimed[msg.sender], "Already claimed");

        uint256 amount = airdropAllocations[msg.sender];
        require(amount > 0, "No allocation");

        airdropClaimed[msg.sender] = true;
        _mint(msg.sender, amount);
    }

    // ===== View Helpers =====

    function maxSupplyForSale() public view returns (uint256) {
        return (maxSupply * (100 - LP_AND_AIRDROP_PERCENT)) / 100;
    }

    function reservedForAirdrop() public view returns (uint256) {
        return (maxSupply * LP_AND_AIRDROP_PERCENT) / 100;
    }

    // ===== [Optional] Creator Withdraw (ETH raised) =====

    function withdraw() external onlyCreator {
        require(address(this).balance > 0, "Nothing to withdraw");
        payable(creator).transfer(address(this).balance);
    }

    // ===== Fallback =====

    receive() external payable {}
}




