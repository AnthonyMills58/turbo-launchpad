// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TurboToken is ERC20, Ownable {
    // ==== Configuration ====
    uint256 public immutable maxSupply;            // Already in token units (1e18 = 1 token)
    uint256 public raiseTarget;                    // Already in wei (1 ETH = 1e18 wei)
    address public platformFeeRecipient;
    address public creator;
    uint256 public constant LP_AND_AIRDROP_PERCENT = 20; // 20% reserved for LP and airdrops

    // ==== State ====
    uint256 public totalRaised;
    bool public graduated;
    uint256 public creatorLockAmount;

    mapping(address => uint256) public lockedBalances;

    // Airdrop allocations
    mapping(address => uint256) public airdropAllocations;
    mapping(address => bool) public airdropClaimed;

    // Bonding curve pricing parameters (scaled by 1e18)
    uint256 public basePrice;
    uint256 public slope;

    // ==== Constructor ====
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 raiseTarget_,         // Already in wei (frontend must scale from ETH)
        address creator_,
        uint256 maxSupply_,           // Already in token units (frontend must scale from token count)
        address platformFeeRecipient_
    ) ERC20(name_, symbol_) Ownable(creator_) {
        raiseTarget = raiseTarget_;
        creator = creator_;
        maxSupply = maxSupply_;
        platformFeeRecipient = platformFeeRecipient_;

        uint256 graduateSupply = maxSupply_ / 100; // 1% of total supply

        // Improved precision bonding curve setup
        basePrice = (raiseTarget_ * 1e18) / (graduateSupply * 2); // scale first, then divide
        slope = (basePrice * 1e18) / graduateSupply;              // scaled by 1e18
    }

    // ==== Modifiers ====
    modifier onlyCreator() {
        require(msg.sender == creator, "Not creator");
        _;
    }

    modifier onlyBeforeGraduate() {
        require(!graduated, "Already graduated");
        _;
    }

    // ==== Bonding Curve Pricing ====
    function getPrice(uint256 amount) public view returns (uint256) {
        uint256 currentSupply = totalSupply();

        uint256 part1 = (amount * basePrice);
        uint256 part2 = amount * currentSupply;
        uint256 part3 = (amount * (amount - 1)) / 2;
        uint256 part4 = slope * (part2 + part3);
        uint256 total = part1 + part4;
        return total;
    }

    function getCurrentPrice() public view returns (uint256) {
        return basePrice + (slope * totalSupply()) / 1e18;
    }

    // ==== Token Purchase Logic ====
    function buy(uint256 amount) external payable onlyBeforeGraduate {
        uint256 cost = getPrice(amount);
        require(msg.value >= cost, "Insufficient ETH sent");
        require(totalSupply() + amount <= maxSupplyForSale(), "Exceeds available supply");

        uint256 platformFee = (cost * 100) / 10000; // 1%
        totalRaised += (cost - platformFee);

        _mint(msg.sender, amount);
        payable(platformFeeRecipient).transfer(platformFee);

        if (msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }
    }

    function creatorBuy(uint256 amount) external payable onlyCreator onlyBeforeGraduate {
        uint256 cost = getPrice(amount);
        require(msg.value >= cost, "Insufficient ETH sent");
        require(totalSupply() + amount <= maxSupplyForSale(), "Exceeds available supply");
        require(lockedBalances[creator] + amount <= reservedForAirdrop(), "Exceeds lock allocation");

        uint256 platformFee = (cost * 100) / 10000; // 1%
        totalRaised += (cost - platformFee);

        _mint(address(this), amount);
        lockedBalances[creator] += amount;
        creatorLockAmount += amount;

        payable(platformFeeRecipient).transfer(platformFee);
        if (msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }
    }

    // ==== Graduation Logic ====
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

    // ==== Airdrop Logic ====
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

    // ==== View Helpers ====
    function maxSupplyForSale() public view returns (uint256) {
        return (maxSupply * (100 - LP_AND_AIRDROP_PERCENT)) / 100;
    }

    function reservedForAirdrop() public view returns (uint256) {
        return (maxSupply * LP_AND_AIRDROP_PERCENT) / 100;
    }

    function tokenInfo() external view returns (
        address _creator,
        address _platformFeeRecipient,
        uint256 _raiseTarget,
        uint256 _maxSupply,
        uint256 _basePrice,
        uint256 _slope,
        uint256 _totalRaised,
        bool _graduated,
        uint256 _creatorLockAmount
    ) {
        return (
            creator,
            platformFeeRecipient,
            raiseTarget,
            maxSupply,
            basePrice,
            slope,
            totalRaised,
            graduated,
            creatorLockAmount
        );
    }

    // ==== Platform + Creator Withdraw (post-graduation) ====
    function withdraw() external onlyCreator {
        require(address(this).balance > 0, "Nothing to withdraw");
        require(graduated, "Not graduated yet");

        uint256 platformCut = (address(this).balance * 200) / 10000; // 2%
        uint256 creatorCut = address(this).balance - platformCut;

        payable(platformFeeRecipient).transfer(platformCut);
        payable(creator).transfer(creatorCut);
    }

    // ==== Fallback ====
    receive() external payable {}
}













