import { useEffect, useState } from "react";
// Import from our local WASM package
import init, { encrypt_and_hide, decrypt_and_extract, preview_heatmap, calculate_required_pixels } from "stego_wasm";
import { SpeedInsights } from "@vercel/speed-insights/react"
import { Github } from "lucide-react";

// Helper to determine color and label
const getStealthStatus = (ratio: number) => {
  const percent = ratio * 100;
  if (percent > 100) return { color: "bg-red-600", textColor: "text-red-500", label: "OVERFLOW (Will Fail)", width: "100%" };
  if (percent > 50) return { color: "bg-red-400", textColor: "text-red-400", label: "High Noise (Visible)", width: `${percent}%` };
  if (percent > 10) return { color: "bg-yellow-500", textColor: "text-yellow-500", label: "Medium Noise", width: `${percent}%` };
  return { color: "bg-green-500", textColor: "text-green-500", label: "Stealthy (Invisible)", width: `${percent}%` };
};

function App() {
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [status, setStatus] = useState("Initializing WASM...");
  const [usageRatio, setUsageRatio] = useState(0);

  // Inputs
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [secretFile, setSecretFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [heatmapUrl, setHeatmapUrl] = useState<string | null>(null);

  // Load the WASM code when the page starts
  useEffect(() => {
    init().then(() => {
      setIsWasmReady(true);
      setStatus("Ready. Select files to begin.");
    });
  }, []);

// --- EFFECT: Calculate Capacity/Stealth ---
  useEffect(() => {
    const calculateCapacity = async () => {
      // If WASM isn't ready or files are missing, reset
      if (!isWasmReady || !imageFile || !secretFile) {
        setUsageRatio(0);
        return;
      }

      try {
        // 1. Get Image Dimensions (Capacity)
        const bmp = await createImageBitmap(imageFile);
        const totalPixels = bmp.width * bmp.height;
        const totalChannels = totalPixels * 3; // RGB
        bmp.close();

        // 2. Get Secret File Data
        const secretBytes = await readFileAsBytes(secretFile);

        // 3. ASK RUST: "How many pixels do you need?"
        // This handles compression + encryption overhead automatically
        const pixelsNeeded = calculate_required_pixels(secretBytes, secretFile.name);

        // 4. Calculate Ratio (Pixels Needed / Total Available Channels)
        // We use 'totalChannels' because we can hide data in R, G, and B.
        const ratio = pixelsNeeded / totalChannels;
        
        setUsageRatio(ratio);

      } catch (e) {
        console.error("Calculation error:", e);
        setUsageRatio(0);
      }
    };

    calculateCapacity();
  }, [imageFile, secretFile, isWasmReady]); // Added isWasmReady dependency

  // --- HELPER: Read file as bytes (Uint8Array) ---
  const readFileAsBytes = (file: File): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
        } else reject("Failed to read file");
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  // --- HELPER: Trigger a browser download ---
  const downloadFile = (data: Uint8Array, filename: string, mimeType: string) => {
    const blob = new Blob([data as any], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleEncrypt = async () => {
    if (!imageFile || !secretFile || !password) {
      setStatus("Please select an image, a secret file, and a password.");
      return;
    }

    try {
      setStatus("Reading files...");
      const imgBytes = await readFileAsBytes(imageFile);
      const secretBytes = await readFileAsBytes(secretFile);

      setStatus("Encrypting...");
      const encryptedImgBytes = encrypt_and_hide(
        imgBytes, 
        secretBytes, 
        secretFile.name, 
        password
      );

      downloadFile(encryptedImgBytes, `safe_${imageFile.name}`, "image/png");
      setStatus("Success! Encrypted image downloaded.");
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e}`);
    }
  };

  const handleDecrypt = async () => {
    if (!imageFile || !password) {
      setStatus("Please select an image and enter password.");
      return;
    }

    try {
      setStatus("Decrypting...");
      const imgBytes = await readFileAsBytes(imageFile);
      const result = decrypt_and_extract(imgBytes, password);
      const filename = result.filename;
      const fileData = result.data;

      downloadFile(fileData, filename, "application/octet-stream");
      setStatus(`Success! Recovered '${filename}'`);
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e}`);
    }
  };

// --- UPDATED HELPER: Generate Heatmap ---
  const handlePreview = async () => {
    if (!imageFile || !secretFile || !password) {
      setStatus("To generate preview: Select image, secret file, and enter password.");
      return;
    }

    try {
      setStatus("Calculating compressed size...");

      // 1. Get Image Dimensions
      const bmp = await createImageBitmap(imageFile);
      const width = bmp.width;
      const height = bmp.height;
      bmp.close(); 

      // 2. Read file to get accurate compressed size
      const secretBytes = await readFileAsBytes(secretFile);

      // 3. ASK RUST: "How many pixels (bits) will this actually use?"
      // This includes Compression + Encryption Overhead + Header
      const totalPixelsNeeded = calculate_required_pixels(secretBytes, secretFile.name);

      // 4. Convert pixels back to "Payload Bytes" for the heatmap function
      // Formula: Total Pixels = 32 (header bits) + (Payload Bytes * 8)
      // So: Payload Bytes = (Total Pixels - 32) / 8
      const compressedPayloadSize = Math.max(0, Math.ceil((totalPixelsNeeded - 32) / 8));

      setStatus(`Generating heatmap for ~${(compressedPayloadSize / 1024).toFixed(1)} KB payload...`);

      // 5. Generate the heatmap with the accurate size
      const heatmapPngBytes = preview_heatmap(width, height, password, compressedPayloadSize);

      // 6. Display it
      const blob = new Blob([heatmapPngBytes as any], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      
      if (heatmapUrl) URL.revokeObjectURL(heatmapUrl);
      setHeatmapUrl(url);
      setStatus("Scatter map generated below.");

    } catch (e) {
      console.error(e);
      setStatus(`Error generating preview: ${e}`);
    }
  };

  const stealth = getStealthStatus(usageRatio);

  return (
    <div className="max-w-3xl mx-auto p-8 flex flex-col gap-6 text-white min-h-screen bg-[#1a1a1a]">

      {/* --- NEW: TOP HEADER --- */}
        <div className="flex justify-end w-full">
          <a 
            href="https://github.com/vadim770/stego-vault" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm font-medium"
          >
            <Github size={20} />
            <span>View Source</span>
          </a>
        </div>

      {/* --- HERO SECTION --- */}
      <div className="text-center mb-10 space-y-4">
        <h1 className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-blue-500 mb-6 pb-2 leading-tight">
          StegoVault
        </h1>
        <p className="text-xl text-gray-300 max-w-2xl mx-auto">
          Hide sensitive files inside innocent images using military-grade encryption.
        </p>
        
        {/* Trust Badges */}
        <div className="flex justify-center gap-4 text-sm font-semibold text-gray-400 mt-2">
          <span className="flex items-center gap-1 bg-zinc-800 px-3 py-1 rounded-full border border-zinc-700">
            🔒 AES-256 Encryption
          </span>
          <span className="flex items-center gap-1 bg-zinc-800 px-3 py-1 rounded-full border border-zinc-700">
            ⚡ 100% Offline (WASM)
          </span>
          <span className="flex items-center gap-1 bg-zinc-800 px-3 py-1 rounded-full border border-zinc-700">
            🕵️ Zero-Knowledge
          </span>
        </div>
      </div>

      {/* --- HOW IT WORKS (Collapsible or Grid) --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        <div className="bg-zinc-800/50 p-4 rounded-lg border border-zinc-700 hover:border-green-500/50 transition-colors">
          <div className="text-green-400 font-bold text-lg mb-1">Step 1: The Carrier</div>
          <p className="text-sm text-gray-400">
            Upload a standard PNG image. This will act as the "safe" that hides your secret data.
          </p>
        </div>
        
        <div className="bg-zinc-800/50 p-4 rounded-lg border border-zinc-700 hover:border-green-500/50 transition-colors">
          <div className="text-green-400 font-bold text-lg mb-1">Step 2: The Secret</div>
          <p className="text-sm text-gray-400">
            Select the file you want to hide (Text, PDF, Zip). We compress and encrypt it automatically.
          </p>
        </div>
        
        <div className="bg-zinc-800/50 p-4 rounded-lg border border-zinc-700 hover:border-green-500/50 transition-colors">
          <div className="text-green-400 font-bold text-lg mb-1">Step 3: Lock It</div>
          <p className="text-sm text-gray-400">
            Set a password. Your data is scattered across pixels using chaos theory logic. Only the password can retrieve it.
          </p>
        </div>
      </div>
      
      {/* --- END HERO SECTION --- */}

      {/* 1. CARRIER IMAGE */}
      <div className="bg-[#333] p-6 rounded-lg shadow-md border border-gray-700">
        <h3 className="text-xl font-semibold mb-3">1. Carrier Image (PNG)</h3>
        <input 
          type="file" 
          accept="image/png" 
          onChange={(e) => setImageFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-600 file:text-white hover:file:bg-green-700 cursor-pointer"
        />
      </div>

      {/* 2. SECRET FILE */}
      <div className="bg-[#2a2a2a] p-6 rounded-lg shadow-md border border-gray-700">
        <h3 className="text-xl font-semibold mb-3">2. Secret File (To Hide)</h3>
        <input 
          type="file" 
          onChange={(e) => setSecretFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-600 file:text-white hover:file:bg-green-700 cursor-pointer"
        />
      </div>

      {/* --- STEALTH METER --- */}
      {imageFile && secretFile && (
        <div className="bg-[#222] p-4 rounded-lg border border-gray-700">
          <div className="flex justify-between mb-2 text-sm text-gray-300">
            <span>Used Capacity: {(usageRatio * 100).toFixed(2)}%</span>
            <span className={`${stealth.textColor} font-bold`}>
              {stealth.label}
            </span>
          </div>

          <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
            <div className={`h-full ${stealth.color} transition-all duration-500 ease-in-out`} style={{ width: stealth.width }} />
          </div>
        </div>
      )}

      {/* 3. PASSWORD */}
      <input 
        type="password" 
        placeholder="Encryption Password" 
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full p-4 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 text-lg transition-all"
      />

      {/* --- PREVIEW SECTION --- */}
      <div className="border-2 border-dashed border-gray-600 p-6 rounded-lg text-center bg-[#252525]">
        <button 
           onClick={handlePreview}
           disabled={!isWasmReady || !imageFile || !secretFile || !password}
           className="border-2 border-green-500 text-green-500 hover:bg-green-500 hover:text-black font-bold py-2 px-6 rounded-lg transition-colors mb-4 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-green-500"
        >
           GENERATE SCATTER PREVIEW
        </button>
        
        {heatmapUrl && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-2 italic">White pixels = Modified data points</p>
            <div className="flex justify-center">
              <img src={heatmapUrl} className="max-w-full max-h-[300px] rounded border border-gray-800 shadow-2xl" />
            </div>
          </div>
        )}
      </div>

      {/* BUTTONS */}
      <div className="flex gap-4">
        <button 
          onClick={handleEncrypt} 
          disabled={!isWasmReady}
          className="flex-1 py-4 bg-green-500 hover:bg-green-600 text-black font-bold rounded-lg shadow-lg transform active:scale-95 transition-all disabled:opacity-50"
        >
          ENCRYPT & DOWNLOAD
        </button>
        <button 
          onClick={handleDecrypt} 
          disabled={!isWasmReady}
          className="flex-1 py-4 bg-cyan-500 hover:bg-cyan-600 text-black font-bold rounded-lg shadow-lg transform active:scale-95 transition-all disabled:opacity-50"
        >
          DECRYPT & DOWNLOAD
        </button>
      </div>

      {/* STATUS */}
      <div className="p-4 bg-black text-green-400 font-mono rounded-lg border border-gray-800 text-sm overflow-hidden whitespace-pre-wrap">
        <span className="text-green-600 mr-2">➜</span> {status}
      </div>

      <footer className="mt-20 border-t border-zinc-800 pt-6 pb-10 text-center text-xs text-zinc-600">
        <p className="mb-2">StegoVault &copy; {new Date().getFullYear()}</p>
        
        {/* The Attribution Link */}
        <p>
          <a 
            href="https://www.flaticon.com/free-icons/photo-gallery" 
            title="photo gallery icons"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-400 transition-colors underline decoration-zinc-700"
          >
            Photo gallery icons created by Freepik - Flaticon
          </a>
        </p>
      </footer>

      <SpeedInsights />
    </div>

    
  );
}

export default App;
