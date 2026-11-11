# FOGO Wallet Browser Extension

A comprehensive multi-chain crypto wallet with native FOGO Chain support.

## Features

✅ **Multi-Chain Support**
- FOGO Chain (native)
- Ethereum
- BSC
- Polygon
- Arbitrum
- Base

✅ **Core Wallet Functions**
- Create & Import Wallets
- Send/Receive Crypto
- Token Management (ERC-20)
- NFT Gallery
- Transaction History
- Address Book

✅ **DeFi Features**
- Token Swaps
- Staking (FOGO tokens)
- Multi-DEX Support

✅ **DApp Connectivity**
- window.ethereum provider
- window.fogo provider
- MetaMask compatible
- EIP-6963 Multi-Provider Discovery
- Transaction signing
- Message signing
- Typed data signing

✅ **Security**
- Secure seed phrase generation
- Encrypted storage
- Transaction approval popups
- Network switching protection

## Installation

### Prerequisites

Before installing, you need to download the following libraries and place them in the `lib/` folder:

1. **ethers.js** (v5.7.2 or higher)
   - Download from: https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js
   - Save as: `lib/ethers.min.js`

2. **QRCode.js**
   - Download from: https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
   - Save as: `lib/qrcode.min.js`

### Steps

1. **Download Libraries**
   ```bash
   cd lib
   
   # Download ethers.js
   curl -o ethers.min.js https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js
   
   # Download QRCode.js
   curl -o qrcode.min.js https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
   ```

2. **Create Icons**
   
   Create PNG icons in the `icons/` folder:
   - `icon16.png` (16x16px)
   - `icon32.png` (32x32px)
   - `icon48.png` (48x48px)
   - `icon128.png` (128x128px)
   
   Use the 🔥 emoji or create custom FOGO branding.

3. **Load Extension in Browser**

   **Chrome/Brave/Edge:**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `fogo-wallet-extension` folder

   **Firefox:**
   - Open `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `manifest.json` from the extension folder

## Configuration

### FOGO Chain Setup

Update the FOGO Chain configuration in `wallet.js`:

```javascript
fogo: {
  name: 'FOGO Chain',
  chainId: '0x1234', // Replace with actual FOGO chain ID
  rpcUrl: 'https://rpc.fogochain.com', // Replace with actual RPC URL
  symbol: 'FOGO',
  explorer: 'https://explorer.fogochain.com' // Replace with actual explorer URL
}
```

### Integration Requirements

For production deployment, you'll need to integrate:

1. **Price APIs** - For token/crypto prices (CoinGecko, CoinMarketCap)
2. **NFT Indexers** - Alchemy, Moralis, or similar for NFT data
3. **Transaction History** - Etherscan/BSCScan APIs or similar
4. **DEX Integration** - Uniswap/PancakeSwap routers for swaps
5. **Staking Contract** - FOGO Chain staking contract addresses

## Usage

### First Time Setup

1. Click the extension icon
2. Choose "Create New Wallet" or "Import Existing Wallet"
3. Save your seed phrase securely (for new wallets)
4. Start using the wallet!

### Connecting to DApps

The wallet automatically injects `window.ethereum` and `window.fogo` providers. DApps can connect using:

```javascript
// Request connection
const accounts = await window.ethereum.request({ 
  method: 'eth_requestAccounts' 
});

// Or using FOGO provider directly
const accounts = await window.fogo.request({ 
  method: 'eth_requestAccounts' 
});
```

### Switching Networks

Use the network dropdown in the wallet header to switch between:
- FOGO Chain
- Ethereum
- BSC
- Polygon
- Arbitrum
- Base

## Security Notes

⚠️ **Important Security Considerations:**

1. **Seed Phrase Storage**: Current implementation uses simple encoding. For production, implement proper encryption (AES-256-GCM).

2. **Private Key Handling**: Never log or expose private keys. Consider using hardware wallet integration.

3. **Transaction Approval**: The current approval system is simplified. Implement comprehensive approval UI with gas estimation, security warnings, etc.

4. **Content Security**: Validate all user inputs and transaction parameters.

5. **HTTPS Only**: Only interact with HTTPS websites to prevent MITM attacks.

## Development

### File Structure

```
fogo-wallet-extension/
├── manifest.json         # Extension configuration
├── popup.html           # Main wallet UI
├── styles.css           # Styling
├── wallet.js            # Core wallet logic
├── popup.js             # UI interactions
├── background.js        # Service worker
├── content.js           # Content script (bridge)
├── inpage.js            # window.ethereum provider
├── lib/
│   ├── ethers.min.js   # Ethereum library
│   └── qrcode.min.js   # QR code generation
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

### Testing

1. Test wallet creation and import
2. Test sending/receiving on testnet first
3. Test DApp connectivity with popular DApps
4. Test network switching
5. Test token additions
6. Test NFT display
7. Test swap functionality

### Adding New Networks

Edit the `networks` object in `wallet.js`:

```javascript
customNetwork: {
  name: 'Custom Network',
  chainId: '0xABC',
  rpcUrl: 'https://rpc.custom.com',
  symbol: 'CUSTOM',
  explorer: 'https://explorer.custom.com'
}
```

## API Integration Examples

### Price Feeds (CoinGecko)

```javascript
async function getTokenPrice(tokenAddress) {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${tokenAddress}&vs_currencies=usd`
  );
  return await response.json();
}
```

### NFT Data (Alchemy)

```javascript
async function getNFTs(address) {
  const response = await fetch(
    `https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY/getNFTs?owner=${address}`
  );
  return await response.json();
}
```

## Troubleshooting

**Extension not loading:**
- Check that all required files are present
- Verify manifest.json is valid
- Check browser console for errors

**DApps not connecting:**
- Refresh the DApp page after installing extension
- Check that content script is injecting properly
- Verify window.ethereum is available in console

**Transactions failing:**
- Ensure sufficient balance for gas
- Check network RPC is responding
- Verify transaction parameters

## Contributing

Contributions are welcome! Areas that need work:

1. Enhanced security (encryption, key management)
2. Better gas estimation
3. Hardware wallet support
4. Multi-signature wallets
5. Advanced DeFi integrations
6. Mobile support
7. Dark/light theme toggle

## License

MIT License - See LICENSE file for details

## Disclaimer

This is a development wallet. Use at your own risk. Always test with small amounts first. Never share your seed phrase or private keys.

## Support

For issues and feature requests, please open an issue on the project repository.

---

**Built for FOGO Chain 🔥**
