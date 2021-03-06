// Example to supply ETH as collateral and borrow DAI
const Web3 = require('web3');
const web3 = new Web3('http://127.0.0.1:8545');
const {
  cEthAddress,
  cEthAbi,
  comptrollerAddress,
  comptrollerAbi,
  priceOracleAddress,
  priceOracleAbi,
  daiAddress,
  daiAbi,
  cDaiAddress,
  cDaiAbi
} = require('../contracts.json');

// Your Ethereum wallet private key
const privateKey = 'b8c1b5c1d81f9475fdf2e334517d29f733bdfa40682207571b12fc1142cbf329';

// Add your Ethereum wallet to the Web3 object
web3.eth.accounts.wallet.add('0x' + privateKey);
const myWalletAddress = web3.eth.accounts.wallet[0].address;

// Main Net Contract for cETH (the collateral-supply process is different for cERC20 tokens)
const cEth = new web3.eth.Contract(cEthAbi, cEthAddress);

// Main Net Contract for Compound's Comptroller
const comptroller = new web3.eth.Contract(comptrollerAbi, comptrollerAddress);

// Main Net Contract for Compound's Price Oracle
const priceOracle = new web3.eth.Contract(priceOracleAbi, priceOracleAddress);

// Main net address of DAI contract
// https://etherscan.io/address/0x6b175474e89094c44da98b954eedeac495271d0f
const dai = new web3.eth.Contract(daiAbi, daiAddress);

// Main Net Contract for cDAI (https://compound.finance/developers#networks)
const cDai = new web3.eth.Contract(cDaiAbi, cDaiAddress);

const logBalances = () => {
  return new Promise(async (resolve, reject) => {
    let myWalletEthBalance = +web3.utils.fromWei(await web3.eth.getBalance(myWalletAddress));
    let myWalletCEthBalance = await cEth.methods.balanceOf(myWalletAddress).call() / 1e8;
    let myWalletDaiBalance = +await dai.methods.balanceOf(myWalletAddress).call() / 1e18;

    console.log("My Wallet's  ETH Balance:", myWalletEthBalance);
    console.log("My Wallet's cETH Balance:", myWalletCEthBalance);
    console.log("My Wallet's  DAI Balance:", myWalletDaiBalance);

    resolve();
  });
};

const main = async () => {
  await logBalances();

  const ethToSupplyAsCollateral = '1';

  console.log('\nSupplying ETH to Compound as collateral (you will get cETH in return)...\n');
  let mint = await cEth.methods.mint().send({
    from: myWalletAddress,
    gasLimit: web3.utils.toHex(150000),      // posted at compound.finance/developers#gas-costs
    gasPrice: web3.utils.toHex(20000000000), // use ethgasstation.info (mainnet only)
    value: web3.utils.toHex(web3.utils.toWei(ethToSupplyAsCollateral, 'ether'))
  });

  await logBalances();

  console.log('\nEntering market (via Comptroller contract) for ETH (as collateral)...');
  let markets = [cEthAddress]; // This is the cToken contract(s) for your collateral
  let enterMarkets = await comptroller.methods.enterMarkets(markets).send({
    from: myWalletAddress,
    gasLimit: web3.utils.toHex(150000),      // posted at compound.finance/developers#gas-costs
    gasPrice: web3.utils.toHex(20000000000), // use ethgasstation.info (mainnet only)
  });

  console.log('Calculating your liquid assets in Compound...');
  let {1:liquidity} = await comptroller.methods.getAccountLiquidity(myWalletAddress).call();
  liquidity = web3.utils.fromWei(liquidity).toString();

  console.log("Fetching cETH collateral factor...");
  let {1:collateralFactor} = await comptroller.methods.markets(cEthAddress).call();
  collateralFactor = (collateralFactor / 1e18) * 100; // Convert to percent

  console.log('Fetching DAI price from the price oracle...');
  let daiPriceInEth = await priceOracle.methods.getUnderlyingPrice(cDaiAddress).call();
  daiPriceInEth = daiPriceInEth / 1e18;

  console.log('Fetching borrow rate per block for DAI borrowing...');
  let borrowRate = await cDai.methods.borrowRatePerBlock().call();
  borrowRate = borrowRate / 1e18;

  console.log(`\nYou have ${liquidity} of LIQUID assets (worth of ETH) pooled in Compound.`);
  console.log(`You can borrow up to ${collateralFactor}% of your TOTAL assets supplied to Compound as DAI.`);
  console.log(`1 DAI == ${daiPriceInEth.toFixed(6)} ETH`);
  console.log(`You can borrow up to ${liquidity/daiPriceInEth} DAI from Compound.`);
  console.log(`NEVER borrow near the maximum amount because your account will be instantly liquidated.`);
  console.log(`\nYour borrowed amount INCREASES (${borrowRate} * borrowed amount) DAI per block.\nThis is based on the current borrow rate.\n`);

  const daiToBorrow = 50;
  console.log(`Now attempting to borrow ${daiToBorrow} DAI...`);
  await cDai.methods.borrow(web3.utils.toWei(daiToBorrow.toString(), 'ether')).send({
    from: myWalletAddress,
    gasLimit: web3.utils.toHex(600000),      // posted at compound.finance/developers#gas-costs
    gasPrice: web3.utils.toHex(20000000000), // use ethgasstation.info (mainnet only)
  });

  await logBalances();

  console.log('\nFetching DAI borrow balance from cDAI contract...');
  let balance = await cDai.methods.borrowBalanceCurrent(myWalletAddress).call();
  balance = balance / 1e18; // because DAI is a 1e18 scaled token.
  console.log(`Borrow balance is ${balance} DAI`);

  console.log(`\nThis part is when you do something with those borrowed assets!\n`);

  console.log(`Now repaying the borrow...`);
  console.log('Approving DAI to be transferred from your wallet to the cDAI contract...');
  const daiToRepay = daiToBorrow;
  await dai.methods.approve(cDaiAddress, web3.utils.toWei(daiToRepay.toString(), 'ether')).send({
    from: myWalletAddress,
    gasLimit: web3.utils.toHex(100000),     // posted at compound.finance/developers#gas-costs
    gasPrice: web3.utils.toHex(20000000000), // use ethgasstation.info (mainnet only)
  });

  const repayBorrow = await cDai.methods.repayBorrow(
    web3.utils.toWei(daiToRepay.toString(), 'ether')
  ).send({
    from: myWalletAddress,
    gasLimit: web3.utils.toHex(600000),      // posted at compound.finance/developers#gas-costs
    gasPrice: web3.utils.toHex(20000000000), // use ethgasstation.info (mainnet only)
  });

  if (repayBorrow.events && repayBorrow.events.Failure) {
    const errorCode = repayBorrow.events.Failure.returnValues.error;
    console.error(`repayBorrow error, code ${errorCode}`);
    process.exit(12);
  }

  console.log(`\nBorrow repaid.\n`);
  await logBalances();
};

main().catch((err) => {
  console.error('ERROR:', err);
});
