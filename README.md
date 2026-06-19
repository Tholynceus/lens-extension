<div align="center">

# LENS for Chrome

### bios lie, chains don't

on-chain intelligence injected into every X profile you visit, read the deployer wallet behind any handle before you ape

[![License: MIT](https://img.shields.io/badge/license-MIT-3a3a3a?style=flat-square)](LICENSE)
[![Built on Base](https://img.shields.io/badge/built%20on-Base-0052FF?style=flat-square)](https://base.org)
[![@lnsx_io](https://img.shields.io/badge/project-%40lnsx__io-1d9bf0?style=flat-square&logo=x&logoColor=white)](https://x.com/lnsx_io)

[Website](https://lnsx.io) · [API](https://lnsx.io/developers) · [Docs](https://lnsx.io/lens-docs)

</div>

---

## What this is

LENS is a Chrome extension that injects a wallet read into X profiles. Open any profile and LENS resolves the deployer behind it, then scores it into one plain verdict, `CLEAR`, `CAUTION`, or `STOP`, with the on-chain signals behind that call.

It reads `x.com` only, never connects a wallet, and runs on public data. This repo is the full source so you can verify the code yourself.

## Install (load unpacked)

The Chrome Web Store listing is in review. Until it goes live you can run the same build now:

1. Download or clone this repo
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder
5. Open any profile on X and the LENS card appears inline

## Configuration

Everything works out of the box through the LENS backend, no keys required. Power users can set their own values in the popup, stored locally in `chrome.storage`:

| key | required | purpose |
| --- | --- | --- |
| `LENS_API_URL` | no | point the extension at your own LENS backend |
| `ALCHEMY_KEY` | no | use your own Alchemy key instead of the backend proxy |
| `GITHUB_TOKEN` | no | raise GitHub rate limits for the GitHub Intel read |

No secret is bundled in this repo. On-chain calls route through the backend proxy by default.

## Permissions

LENS asks for the minimum:

- host access to `x.com` only, nothing else
- no wallet connection, ever
- no background tracking of other sites

## How it works

1. LENS detects wallet addresses, contract addresses, and GitHub links in a profile
2. it resolves the deployer wallet on Base through Alchemy
3. it pulls dev sells, fee capture, liquidity status, linked accounts, and the funding trail
4. it scores the read into `CLEAR / CAUTION / STOP` and renders the card inline

The same read is available as a public API at [lnsx.io/developers](https://lnsx.io/developers).

## Privacy

LENS reads the page you are already on and queries public chain data. It does not collect your identity, does not touch any site other than X, and never asks for a wallet. Full policy at [lnsx.io/privacy](https://lnsx.io/privacy).

## License

MIT, see [LICENSE](LICENSE).

<div align="center">

built on Base · [lnsx.io](https://lnsx.io)

</div>
