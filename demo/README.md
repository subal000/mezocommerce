# Demo video

A narrated walkthrough of MezoCommerce, 1:49 long, recorded on the **live site** (https://mezocommerce.vercel.app)
with **real Mezo testnet transactions**: a new merchant wallet registers a store on-chain, creates a 12.50 MUSD
payment link, and a customer wallet pays it with one permit signature and one transaction.

- Video: `demo/out/mezocommerce-demo.mp4` (1920x1080, 30 fps, H.264 + AAC, subtitles burned in)
- Subtitles: `demo/out/mezocommerce-demo.srt`
- Narration by scene, with timings: [`script.md`](script.md)
- Voice: Microsoft's Andrew neural voice (`en-US-AndrewNeural`) through edge-tts

`demo/out/` is gitignored, so render the video locally.

## Render it

```bash
MERCHANT_PK=0x… CUSTOMER_PK=0x… bash demo/record/run-all.sh
```

- `MERCHANT_PK`: a **new** wallet with about 0.00001 testnet BTC. It must not have a store yet.
- `CUSTOMER_PK`: a wallet with about 0.001 testnet BTC and at least 12.50 MUSD.

Needs Node, Python 3 and network access (the voice service, Google Fonts, the live site and the Mezo RPC).

1. `tts.py` writes one MP3 per scene plus word timings from `narration.json`.
2. `record.mjs` drives headless Chromium with Playwright and captures each scene through the CDP screencast.
   `wallet-shim.js` is a small EIP-1193 provider injected only into the recording contexts. Reads go to the Mezo
   RPC; signatures and transactions go to a Node function (`lib.mjs`) that signs with the given key. The app itself is
   not modified. `overlay.js` draws a cursor and a corner tag naming the wallet in use. `cards.html` holds the
   title cards.
3. `assemble.py` builds the timeline, places the narration, writes subtitles and encodes with the static ffmpeg from
   imageio-ffmpeg.

## Cuts

Network waits are cut, never sped up: sign-in, saving the store, the registration transaction confirming, the
payment link being created, and the wait for the payment's second confirmation (the video goes from "Confirming"
straight to the receipt). The narration keeps playing across a cut, and the recorder waits for each narrated word
before the matching action, so voice and picture stay in sync.

## Notes from recording

- Mezo's public RPC is load-balanced over nodes that are not always in sync. A lagging node estimates a contract call
  at about 21,800 gas and the transaction fails ("gas limit below EIP-7623 floor"). The app now estimates gas itself
  and retries such estimates (`lib/client/gas.ts`); the demo signer does the same.
- Leftover testnet funds from the recording go back to the wallet that funded it.
