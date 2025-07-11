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
    mapping(address => uint256) public airdropAllocations;
    mapping(address => bool) public airdropClaimed;
    address[] public airdropRecipients;

    // ==== Bonding curve parameters ====
    uint256 public basePrice;
    uint256 public slope;

    // ==== Events ====
    event FeeAttempt(address recipient, uint256 amount);

    // ==== Constructor ====
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

        // Calculate bonding curve
        uint256 baseRaiseTarget = 5 ether;
        // 0.005 USD in ETH (wei), assuming ETH = $2600 and maxSupply is 1000000000
        uint256 basePriceFloor = (5e15 * 1e27) / (2600 * maxSupply);
        // 0.4% of max supply (used as x value in slope calculation)
        uint256 graduateThreshold = 4 * maxSupply / 1000;
        // Price floor proportional to raise target
        uint256 priceFloor = ( raiseTarget * basePriceFloor ) / baseRaiseTarget;
        basePrice = 2e18 * raiseTarget / graduateThreshold - priceFloor;
        slope = 1e18 * (priceFloor - basePrice) / graduateThreshold;
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

    // ==== Decimal Helper ====
    function scaleAmount(uint256 amount) internal view returns (uint256) {
        return amount * 10 ** decimals();
    }

    // ==== Bonding Curve Pricing ====
    function getPrice(uint256 amount) public view returns (uint256) {
        uint256 currentSupply = totalSupply();
        uint256 c1 = basePrice + slope * (currentSupply + 1e18)/1e18;
        uint256 c2 = basePrice + slope * (currentSupply + scaleAmount(amount))/1e18;
        // Average price over the range
        uint256 avgPrice = (c1 + c2) / 2;
        uint256 total = amount * avgPrice;
        return total;
    }

    function getCurrentPrice() public view returns (uint256) {
        return basePrice + (slope * totalSupply()) / 1e18;
    }

    // ==== Token Purchase Logic ====
    function buy(uint256 amount) external payable onlyBeforeGraduate {
        uint256 cost = getPrice(amount);
        require(msg.value >= cost, "Insufficient ETH sent");
        require(totalSupply() + scaleAmount(amount) <= maxSupplyForSale(), "Exceeds available supply");

        uint256 platformFee = (cost * 100) / 10000;
        totalRaised += (cost - platformFee);

        _mint(msg.sender, scaleAmount(amount));

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
        require(totalSupply() + scaleAmount(amount) <= maxSupplyForSale(), "Exceeds available supply");
        require(lockedBalances[creator] + scaleAmount(amount) <= reservedForAirdrop(), "Exceeds lock allocation");

        uint256 platformFee = (cost * 100) / 10000;
        totalRaised += (cost - platformFee);

        _mint(address(this), scaleAmount(amount));
        lockedBalances[creator] += scaleAmount(amount);
        creatorLockAmount += scaleAmount(amount);

        emit FeeAttempt(platformFeeRecipient, platformFee);

        (bool success, ) = payable(platformFeeRecipient).call{value: platformFee}("");
        require(success, "Platform fee call failed");

        if (msg.value > cost) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - cost}("");
            require(refundSuccess, "Refund failed");
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
        creatorLockAmount = 0; // 👈 Reset the public variable!
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

        require(scaleAmount(totalToAllocate) <= reservedForAirdrop(), "Exceeds airdrop reserve");
    }

    function claimAirdrop() external {
        require(graduated, "Not graduated");
        require(!airdropClaimed[msg.sender], "Already claimed");

        uint256 amount = airdropAllocations[msg.sender];
        require(amount > 0, "No allocation");

        airdropClaimed[msg.sender] = true;
        _mint(msg.sender, scaleAmount(amount));
    }

    // ==== View Helper for Frontend ====
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

    // ==== Withdraw Logic ====
    function withdraw() external onlyCreator {
        require(address(this).balance > 0, "Nothing to withdraw");
        require(graduated, "Not graduated yet");

        uint256 platformCut = (address(this).balance * 200) / 10000;
        uint256 creatorCut = address(this).balance - platformCut;

        (bool sent, ) = payable(platformFeeRecipient).call{value: platformCut}("");
        require(sent, "Platform withdrawal failed");

        payable(creator).transfer(creatorCut);

        totalRaised = 0; // Reset after successful withdrawal
    }

    // ==== Fallback ====
    receive() external payable {}
}


















