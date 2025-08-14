// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// --- Minimal UniswapV2 / GTE interfaces ---
interface IUniswapV2Router02 {
    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity);

    function factory() external view returns (address);
    function WETH() external view returns (address);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

contract TurboToken is ERC20, Ownable, ReentrancyGuard {
    // ==== Percent caps (basis points) ====
    uint256 public constant MAX_AIRDROP_BPS      = 1000; // 10%
    uint256 public constant MAX_CREATOR_LOCK_BPS = 2000; // 20%
    uint256 public constant MAX_SALE_BPS         = 7000; // 70%

    // ==== Configuration ====
    uint256 public immutable maxSupply;
    uint256 public raiseTarget;
    address public platformFeeRecipient;
    address public creator;
    address public immutable dexRouter; // UniswapV2/GTE router

    // ==== State ====
    // totalRaised: gross on buys (cost), fee-neutral on sells (minus full refund). Fees tracked separately in feesAccruedWei.
    uint256 public totalRaised;
    uint256 public feesAccruedWei;  // platform fees (buy+sell) accrued & frozen until graduation
    bool public graduated;
    uint256 public creatorLockAmount;

    mapping(address => uint256) public lockedBalances;

    // NEW — cooldown / early-unlock
    uint64 public creatorUnlockTime;                 // absolute timestamp when early unlock is allowed
    uint32 public minTokenAgeForUnlockSeconds;       // for UI/analytics

    // ==== Airdrop allocations ====
    mapping(address => uint256) public airdropAllocations; // 1e18-scaled amounts
    mapping(address => bool) public airdropClaimed;
    address[] public airdropRecipients;

    // ==== Bonding curve parameters ====
    uint256 public basePrice; // in wei per token (1e18-scaled)
    uint256 public slope;     // in wei per token^2 (scaled with 1e18)

    // ==== Events ====
    event FeesTransferred(address indexed to, uint256 amount);
    event Graduated(address indexed by, uint256 ethAddedToLP, uint256 tokensAddedToLP);
    event PoolCreated(address indexed pair, uint256 liquidity);
    event LPSplit(address indexed pair, uint256 creatorLP, uint256 platformLP);
     // NEW — event (nice for UI/sync)
    event CreatorUnlocked(uint256 amount);

    // ==== Internal helpers ====
    function _divUp(uint256 a, uint256 b) internal pure returns (uint256) {
        // ceil(a / b)
        return (a + b - 1) / b;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 raiseTarget_,
        address creator_,
        uint256 maxSupply_,
        address platformFeeRecipient_,
        address dexRouter_,
        uint16  minUnlockDays_              // NEW: UI passes days (e.g., 2, 3, 7...)

    ) ERC20(name_, symbol_) Ownable(creator_) {
        require(creator_ != address(0), "creator=0");
        require(platformFeeRecipient_ != address(0), "platform=0");
        require(dexRouter_ != address(0), "router=0");

        // NEW: bounds (tune as you like)
        require(minUnlockDays_ >= 2 && minUnlockDays_ <= 30, "bad minUnlockDays");

        raiseTarget = raiseTarget_;
        creator = creator_;
        maxSupply = maxSupply_;
        platformFeeRecipient = platformFeeRecipient_;
        dexRouter = dexRouter_;

         // NEW: store seconds + compute absolute unlock time
        uint32 seconds_ = uint32(minUnlockDays_) * uint32(1 days);
        minTokenAgeForUnlockSeconds = seconds_;
        creatorUnlockTime = uint64(block.timestamp) + seconds_;

        // Bonding curve assumptions with 70% sale cap
        uint256 graduateSupply = (maxSupply_ * MAX_SALE_BPS) / 10000; // 70% of max supply
        uint256 c = 1249; // Graduation price = c × base price

        // === Ceil rounding to guarantee integral to graduateSupply >= raiseTarget ===
        // For linear curve: Integral(S) = S * (P0 + P_S)/2, with P_S = P0 * c.
        // Solve P0 s.t. Integral(graduateSupply) >= raiseTarget.
        basePrice = _divUp(2 * raiseTarget_ * 1e18, graduateSupply * (1 + c));
        slope     = _divUp((c - 1) * basePrice * 1e18, graduateSupply);
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

    // ==== Supply caps helpers ====
    function maxAirdropSupply() public view returns (uint256) {
        return (maxSupply * MAX_AIRDROP_BPS) / 10000;
    }

    function maxCreatorLock() public view returns (uint256) {
        return (maxSupply * MAX_CREATOR_LOCK_BPS) / 10000;
    }

    function maxSaleSupply() public view returns (uint256) {
        return (maxSupply * MAX_SALE_BPS) / 10000;
    }

    // Back-compat helper name kept (now equals 10% cap)
    function reservedForAirdrop() public view returns (uint256) {
        return maxAirdropSupply();
    }

    // Amount of tokens reserved for (unclaimed) airdrops
    function unclaimedAirdropAmount() public view returns (uint256 total) {
        for (uint256 i = 0; i < airdropRecipients.length; i++) {
            address user = airdropRecipients[i];
            if (!airdropClaimed[user]) {
                total += airdropAllocations[user];
            }
        }
    }

    // Total currently allocated for airdrops (claimed or not)
    function totalAirdropAllocated() public view returns (uint256 total) {
        for (uint256 i = 0; i < airdropRecipients.length; i++) {
            address user = airdropRecipients[i];
            total += airdropAllocations[user];
        }
    }

    // Remaining tokens that can be minted for LP at graduation (excludes airdrop allocations)
    function remainingForLP() public view returns (uint256) {
        uint256 supply = totalSupply(); // pre-grad: only sale & creator lock minted
        uint256 airdropUnclaimed = unclaimedAirdropAmount();
        if (maxSupply <= supply + airdropUnclaimed) return 0;
        return maxSupply - supply - airdropUnclaimed;
    }

    // ==== Bonding Curve Pricing ====
    function getCurrentPrice() public view returns (uint256) {
        return basePrice + (slope * totalSupply()) / 1e18;
    }

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

    // ==== Token Purchase Logic (fees accrued & frozen until graduation) ====
    function buy(uint256 amount) external payable onlyBeforeGraduate nonReentrant {
        require(amount > 0, "amount=0");
        require(msg.sender != creator, "CREATOR_MUST_USE_BUYLOCK"); // NEW
        uint256 cost = getPrice(amount);
        require(msg.value >= cost, "Insufficient ETH sent");

        // Enforce 70% sale cap (public buys + creator lock, net of sells/burns)
        require(totalSupply() + amount <= maxSaleSupply(), "Exceeds sale cap (70%)");

        // 1% buy fee
        uint256 platformFee = (cost * 100) / 10000;

        // gross on buys
        totalRaised += cost;
        feesAccruedWei += platformFee;

        _mint(msg.sender, amount);

        // Refund dust if any
        if (msg.value > cost) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value - cost}("");
            require(ok, "Refund failed");
        }

        _maybeGraduateAndCreatePool();
    }

    function creatorBuy(uint256 amount) external payable onlyCreator onlyBeforeGraduate nonReentrant {
        require(amount > 0, "amount=0");
        uint256 cost = getPrice(amount);
        require(msg.value >= cost, "Insufficient ETH sent");

        // Enforce overall sale cap (70%)
        require(totalSupply() + amount <= maxSaleSupply(), "Exceeds sale cap (70%)");
        // Enforce creator lock cap (20%)
        require(lockedBalances[creator] + amount <= maxCreatorLock(), "Exceeds creator lock cap (20%)");

        // 1% buy fee
        uint256 platformFee = (cost * 100) / 10000;

        // gross on buys
        totalRaised += cost;
        feesAccruedWei += platformFee;

        // Lock by minting to contract
        _mint(address(this), amount);
        lockedBalances[creator] += amount;
        creatorLockAmount += amount;

        // Refund dust if any
        if (msg.value > cost) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value - cost}("");
            require(ok, "Refund failed");
        }

        _maybeGraduateAndCreatePool();
    }

    function sell(uint256 amount) external onlyBeforeGraduate nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(balanceOf(msg.sender) >= amount, "Insufficient token balance");

        uint256 refund = getSellPrice(amount);
        require(address(this).balance >= refund, "Contract has insufficient ETH");

        // 1.5% sell fee
        uint256 platformFee = (refund * 150) / 10000;
        uint256 payout = refund - platformFee;

        // Burn sold tokens (reduces totalSupply, freeing capacity under the 70% cap)
        _burn(msg.sender, amount);

        // Payout ETH to seller
        (bool sentUser, ) = payable(msg.sender).call{value: payout}("");
        require(sentUser, "ETH payout failed");

        // fee-neutral for totalRaised on sells: subtract the full refund
        require(totalRaised >= refund, "totalRaised underflow");
        totalRaised -= refund;

        // Accrue the sell fee (stays frozen until graduation)
        feesAccruedWei += platformFee;
    }

    // ==== Graduation (auto, buyer-pays) ====
    function _maybeGraduateAndCreatePool() internal {
        if (!graduated && totalRaised >= raiseTarget) {
            _graduateAndCreatePool();
        }
    }

    /// @notice Public fallback: can be called by anyone (e.g., from your /api/sync) if target reached.
    function finalizeIfReady() external nonReentrant {
        require(!graduated, "Already graduated");
        require(totalRaised >= raiseTarget, "Target not reached");
        _graduateAndCreatePool();
    }

    function _graduateAndCreatePool() internal {
        require(!graduated, "Already graduated");

        // Determine LP token side (exclude airdrops)
        uint256 tokensForLP = remainingForLP();
        graduated = true;

        // --- 1) Transfer all accrued fees to the platform wallet ---
        uint256 fees = feesAccruedWei;
        if (fees > 0) {
            feesAccruedWei = 0;
            (bool feeOk, ) = payable(platformFeeRecipient).call{value: fees}("");
            require(feeOk, "Fee transfer failed");
            emit FeesTransferred(platformFeeRecipient, fees);
        }

        // --- 2) Mint remaining supply for LP (excluding airdrops) ---
        if (tokensForLP > 0) {
            _mint(address(this), tokensForLP);
            _approve(address(this), dexRouter, tokensForLP);
        }

        // --- 3) Add all remaining ETH as liquidity; receive LP to contract, then split 70/30 ---
        uint256 ethBal = address(this).balance; // after fee transfer
        uint256 liquidity = 0;
        address pair = address(0);

        if (ethBal > 0 && tokensForLP > 0) {
            IUniswapV2Router02 router = IUniswapV2Router02(dexRouter);
            ( , , liquidity) = router.addLiquidityETH{value: ethBal}(
                address(this),
                tokensForLP,
                0, // amountTokenMin
                0, // amountETHMin
                address(this), // receive LP here
                block.timestamp + 15 minutes
            );

            // Discover pair (for event/use by indexers)
            address factory = router.factory();
            pair = IUniswapV2Factory(factory).getPair(address(this), router.WETH());
            require(pair != address(0), "Pair not created");
            emit PoolCreated(pair, liquidity);

            // Split LP: 70% creator, 30% platform
            uint256 creatorLP  = (liquidity * 7000) / 10000;
            uint256 platformLP = liquidity - creatorLP;
            IERC20(pair).transfer(creator, creatorLP);
            IERC20(pair).transfer(platformFeeRecipient, platformLP);
            emit LPSplit(pair, creatorLP, platformLP);
        }

        emit Graduated(msg.sender, ethBal, tokensForLP);
        // No ETH left; no withdraw path — liquidity is now represented by LP tokens split 70/30.
    }

    // Kept for compatibility: manual "graduate" now performs the full finalize (guards included).
    function graduate() external nonReentrant {
        require(!graduated, "Already graduated");
        require(totalRaised >= raiseTarget, "Raise target not met");
        _graduateAndCreatePool();
    }

    // ==== Unlock (post-graduation) ====
   function unlockCreatorTokens() external onlyCreator nonReentrant { // MOD: added nonReentrant
        require(lockedBalances[creator] > 0, "No locked tokens");

        // NEW: allow either post-graduation or after cooldown age
        require(
            graduated || block.timestamp >= creatorUnlockTime,
            "Lock active"
        );

        uint256 amount = lockedBalances[creator];

        // effects
        lockedBalances[creator] = 0;
        // safer accounting than hard-zeroing:
        if (creatorLockAmount >= amount) {
            creatorLockAmount -= amount;
        } else {
            creatorLockAmount = 0;
        }

        // interactions
        _transfer(address(this), creator, amount);
        emit CreatorUnlocked(amount); // NEW
    }


    // ==== Airdrop Logic ====
    function setAirdropAllocations(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyCreator {
        require(!graduated, "Already graduated");
        require(recipients.length == amounts.length, "Length mismatch");

        // Apply updates
        for (uint256 i = 0; i < recipients.length; i++) {
            address addr = recipients[i];
            uint256 amt = amounts[i];

            if (airdropAllocations[addr] == 0 && amt > 0) {
                airdropRecipients.push(addr);
            }
            airdropAllocations[addr] = amt;
        }

        // Enforce global 10% cap across all allocations
        require(totalAirdropAllocated() <= maxAirdropSupply(), "Exceeds airdrop 10% cap");
    }

    function claimAirdrop() external {
        require(graduated, "Not graduated");
        require(!airdropClaimed[msg.sender], "Already claimed");

        uint256 amount = airdropAllocations[msg.sender];
        require(amount > 0, "No allocation");

        airdropClaimed[msg.sender] = true;
        _mint(msg.sender, amount);
    }

    // ==== View Helpers for Frontend / Sync ====
    function getAirdropAllocations()
        external
        view
        returns (address[] memory, uint256[] memory)
    {
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

    function tokenInfo()
        external
        view
        returns (
            address _creator,
            address _platformFeeRecipient,
            uint256 _raiseTarget,
            uint256 _maxSupply,
            uint256 _basePrice,
            uint256 _slope,
            uint256 _totalRaised,
            bool _graduated,
            uint256 _creatorLockAmount
        )
    {
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

    // ==== Withdraw Logic (disabled) ====
    function withdraw() external pure {
        revert("Withdraw disabled: ETH used for LP at graduation");
    }

    receive() external payable {}
}























