# 🔒 StegoVault Web

> **Professional Client-Side Steganography Tool powered by Rust & WebAssembly.**

StegoVault is a secure web application that allows you to hide sensitive files inside standard PNG images. Unlike traditional online tools, **StegoVault processes everything locally in your browser**. Your files never leave your device, ensuring 100% privacy.

## ✨ Features

* **🛡️ Military-Grade Encryption:** Files are encrypted with **AES-256-GCM** before being hidden.
* **🕵️‍♂️ True Privacy:** Powered by **WebAssembly (WASM)**. No data is ever uploaded to a server.
* **📉 Smart Compression:** Automatically compresses files using Zlib to minimize image noise.
* **🎲 Chaos Shuffling:** Data is scattered across random pixels (seeded by your password) using **ChaCha20**, making statistical detection nearly impossible.
* **📊 Stealth Meter:** Real-time visual indicator showing how "detectable" your hidden file is.
* **👁️ Scatter Preview:** Generate a heatmap to see exactly which pixels will be modified before you commit.

## 🛠️ Tech Stack

* **Frontend:** React, TypeScript, Tailwind CSS, Vite
* **Backend:** Rust (compiled to WASM)
* **Cryptography:** `aes-gcm`, `chacha20poly1305`, `rand`
* **Image Processing:** `image` crate (Rust), Canvas API (JS)

## 🚀 Getting Started

### Prerequisites
* **Node.js** (v16+)
* **Rust** (latest stable)
* **wasm-pack**: `cargo install wasm-pack`

### Installation

1.  **Clone the repository**
    ```bash
    git clone [https://github.com/vadim770/stego-vault.git](https://github.com/vadim770/stego-vault.git)
    cd stego-vault
    ```

2.  **Install Frontend Dependencies**
    ```bash
    npm install
    ```

3.  **Build the WASM Module**
    The core logic lives in `stego_wasm` and needs to be compiled before the site can run.
    ```bash
    cd stego_wasm
    wasm-pack build --target web
    cd ..
    ```

4.  **Run the Development Server**
    ```bash
    npm run dev
    ```
    Open `http://localhost:5173` to view it in the browser.

## 🏗️ Building for Production

To create a production-ready build (e.g., for Vercel or GitHub Pages):

1.  **Build WASM:**
    ```bash
    cd stego_wasm && wasm-pack build --target web
    ```

2.  **Build Frontend:**
    ```bash
    cd .. && npm run build
    ```

The output will be in the `dist` folder.

## 🧠 How It Works

1.  **Compression:** The secret file is compressed to reduce its footprint.
2.  **Encryption:** The compressed blob is encrypted using a key derived from your password.
3.  **Shuffling:** A seeded Random Number Generator (ChaCha20) creates a unique list of pixel coordinates based on your password.
4.  **Embedding:** The encrypted bits are injected into the **Least Significant Bits (LSB)** of the specific pixels chosen by the shuffler.
