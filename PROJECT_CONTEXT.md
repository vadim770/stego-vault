# Project: StegoVault (Web/WASM Edition)

## Overview
A secure, client-side steganography tool that hides files inside images using LSB (Least Significant Bit) manipulation.
- **Architecture:** React (Frontend) + Rust (WASM Backend).
- **Security:** AES-256-GCM encryption + ChaCha20-based pixel shuffling.
- **Privacy:** 100% offline/local processing (WASM).

## Tech Stack
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Rust, `wasm-bindgen`, `aes-gcm`, `image` crate.
- **Hosting:** Static (Vercel/GitHub Pages).

## Core Logic (Rust/WASM)
1.  **Encryption (`encrypt_and_hide`):**
    - Inputs: Carrier Image (Bytes), Secret File (Bytes), Password.
    - Process:
        1. Encrypt secret + filename using AES-256-GCM (Key derived from password).
        2. Generate a "Shuffled Coordinate List" using ChaCha20 RNG seeded by the password.
        3. **Header:** Store payload size (32-bit int) in the first 32 shuffled pixels.
        4. **Payload:** Store encrypted bits in the LSB of subsequent shuffled pixels.
    - Output: PNG Image Bytes.

2.  **Decryption (`decrypt_and_extract`):**
    - Process:
        1. Re-generate Shuffled Coordinates using password.
        2. Read first 32 bits to get `data_len`.
        3. Read `data_len` bytes from LSBs.
        4. Decrypt using AES-256-GCM.
    - Output: Object `{ filename: String, data: Vec<u8> }`.

3.  **Visualization (`preview_heatmap`):**
    - Generates a black/white image where white pixels represent modified data points.
    - Used for user verification of the "scatter" algorithm.

## Frontend Features
- **Stealth Meter:** Calculates `(Payload Size / Image Capacity)` to warn users if noise will be visible.
- **SharedArrayBuffer Fix:** Uses `blob([data as any])` to bypass TypeScript strictness with file buffers.

## Current State
- [x] Basic Encryption/Decryption
- [x] WASM Migration
- [x] Heatmap Preview
- [x] Capacity/Stealth Bar
- [ ] UI Polish & Deployment

## Hosting Strategy
- The app is a static site.
- Build command: `wasm-pack build --target web` -> `npm run build`.
- Output: `dist` folder.