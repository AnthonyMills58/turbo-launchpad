// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TurboToken is ERC20, Ownable {
    // ==== Configuration ====
    uint256 public immutable maxSupply;
    uint256 public raiseTarget;
    address public platformFeeRecipient;
    address public creator;
    uint256 public constant LP_AND_AIRDROP_PERCENT = 20;

    // ==== State ====
    uint256 public totalRaised;
    bool public graduated;
    uint256 public creatorLockAmount;

    mapping(address => uint256) public lockedBalances;

    // ==== Airdrop allocations ====
    mapping(address => uint256) public airdropAllocations; // amounts are now 1e18-scaled
    mapping(address => bool) public airdropClaimed;
    address[] public airdropRecipients;

    // ==== Bonding curve parameters ====
    uint256 public basePrice;
    uint256 public slope;

    // ==== Events ====
    event FeeAttempt(address recipient, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 raiseTarget_,
        address creator_,
        uint256 maxSupply_,
        address platformFeeRecipient_
    ) ERC20(name_, symbol_) Ownable(creator_) {
        raiseTarget = raiseTarget_;
        creator = creator_;
        maxSupply = maxSupply_;
        platformFeeRecipient = platformFeeRecipient_;

        // Bonding curve assumptions
        uint256 graduateSupply = (maxSupply_ * 80) / 100; // 80% of max supply
        uint256 c = 1249; // Graduation price = c × base price

        // Calculate basePrice and slope
        basePrice = (2 * raiseTarget_ * 1e18) / (graduateSupply * (1 + c));
        slope = ((c - 1) * basePrice * 1e18) / graduateSupply;
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
       
        uint256 c1 = getCurrentPrice();
        uint256 c2 = c1 + (slope * amount) / 1e18;

        uint256 avgPrice = (c1 + c2) / 2;
        uint256 total = (amount * avgPrice) / 1e18;

        return total;
    }

    function getSellPrice(uint256 amount) public view returns (uint256) {
        uint256 currentSupply = totalSupply();
        require(amount <= currentSupply, "Amount exceeds supply");

        uint256 c1 = getCurrentPrice(); 
        uint256 c2 = c1 - (slope * amount) / 1e18; 

        uint256 avgPrice = (c1 + c2) / 2;
        uint256 total = (amount * avgPrice) / 1e18;

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

        uint256 platformFee = (cost * 100) / 10000;
        totalRaised += (cost - platformFee);

        _mint(msg.sender, amount);

        emit FeeAttempt(platformFeeRecipient, platformFee);
        (bool sent, ) = payable(platformFeeRecipient).call{value: platformFee}("");
        require(sent, "Platform fee transfer failed");

        if (msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }
    }

    function creatorBuy(uint256 amount) external payable onlyCreator onlyBeforeGraduate {
        uint256 cost = getPrice(amount);
        require(msg.value >= cost, "Insufficient ETH sent");
        require(totalSupply() + amount <= maxSupplyForSale(), "Exceeds available supply");
        require(lockedBalances[creator] + amount <= reservedForAirdrop(), "Exceeds lock allocation");

        uint256 platformFee = (cost * 100) / 10000;
        totalRaised += (cost - platformFee);

        _mint(address(this), amount);
        lockedBalances[creator] += amount;
        creatorLockAmount += amount;

        emit FeeAttempt(platformFeeRecipient, platformFee);

        (bool success, ) = payable(platformFeeRecipient).call{value: platformFee}("");
        require(success, "Platform fee call failed");

        if (msg.value > cost) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - cost}("");
            require(refundSuccess, "Refund failed");
        }
    }


    function sell(uint256 amount) external onlyBeforeGraduate {
        require(amount > 0, "Amount must be greater than zero");
        require(balanceOf(msg.sender) >= amount, "Insufficient token balance");

        uint256 refund = getSellPrice(amount);
        require(address(this).balance >= refund, "Contract has insufficient ETH");

        // === Apply 1.5% sell fee (150 bps) ===
        uint256 platformFee = (refund * 150) / 10000;
        uint256 payout = refund - platformFee;

        // === Burn sold tokens ===
        _burn(msg.sender, amount);

        // === Payout ETH to seller ===
        (bool sentUser, ) = payable(msg.sender).call{value: payout}("");
        require(sentUser, "ETH payout failed");

        // ✅ Lower totalRaised (excluding platform fee)
        require(totalRaised >= payout, "totalRaised underflow");
        totalRaised -= payout;

        // === Send fee to platform ===
        emit FeeAttempt(platformFeeRecipient, platformFee);
        (bool sentFee, ) = payable(platformFeeRecipient).call{value: platformFee}("");
        require(sentFee, "Platform fee transfer failed");
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
        creatorLockAmount = 0;
        _transfer(address(this), creator, amount);
    }

    // ==== Airdrop Logic ====
    function setAirdropAllocations(address[] calldata recipients, uint256[] calldata amounts) external onlyCreator {
        require(!graduated, "Already graduated");
        require(recipients.length == amounts.length, "Length mismatch");

        uint256 totalToAllocate = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            address addr = recipients[i];
            uint256 amt = amounts[i];

            if (airdropAllocations[addr] == 0 && amt > 0) {
                airdropRecipients.push(addr);
            }

            airdropAllocations[addr] = amt;
            totalToAllocate += amt;
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

    // ==== View Helpers for Frontend ====
    function getAirdropAllocations() external view returns (address[] memory, uint256[] memory) {
        uint256 len = airdropRecipients.length;
        address[] memory recipients = new address[](len);
        uint256[] memory amounts = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            recipients[i] = airdropRecipients[i];
            amounts[i] = airdropAllocations[recipients[i]];
        }

        return (recipients, amounts);
    }

    function airdropFinalized() external view returns (bool) {
        return airdropRecipients.length > 0;
    }

    function unclaimedAirdropAmount() public view returns (uint256 total) {
        for (uint256 i = 0; i < airdropRecipients.length; i++) {
            address user = airdropRecipients[i];
            if (!airdropClaimed[user]) {
                total += airdropAllocations[user];
            }
        }
    }   

    function maxSupplyForSale() public view returns (uint256) {
        return maxSupply - unclaimedAirdropAmount();
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

    // ==== Withdraw Logic ====
    function withdraw() external onlyCreator {
        require(address(this).balance > 0, "Nothing to withdraw");
        require(graduated, "Not graduated yet");

        uint256 platformCut = (address(this).balance * 200) / 10000;
        uint256 creatorCut = address(this).balance - platformCut;

        (bool sent, ) = payable(platformFeeRecipient).call{value: platformCut}("");
        require(sent, "Platform withdrawal failed");

        payable(creator).transfer(creatorCut);
        
    }

    receive() external payable {}
}


















