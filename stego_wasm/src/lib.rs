use wasm_bindgen::prelude::*;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce
};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha20Rng;
use image::{DynamicImage, GenericImageView, ImageFormat};
use std::io::Cursor;
use flate2::write::ZlibEncoder;
use flate2::read::ZlibDecoder;
use flate2::Compression;
use std::io::prelude::*;

// --- HELPER STRUCT FOR JS ---
// This allows us to return multiple values (filename + file data) to JavaScript
#[wasm_bindgen]
pub struct DecryptedFile {
    filename: String,
    data: Vec<u8>,
}

#[wasm_bindgen]
impl DecryptedFile {
    // Getters so JS can read these fields
    #[wasm_bindgen(getter)]
    pub fn filename(&self) -> String {
        self.filename.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Vec<u8> {
        self.data.clone()
    }
}

// --- CORE ENCRYPTION LOGIC ---

fn get_shuffled_indices(width: u32, height: u32, password: &str) -> Vec<(u32, u32, usize)> {
    let total_pixels = width * height;
    let mut coords: Vec<(u32, u32, usize)> = Vec::with_capacity((total_pixels * 3) as usize);

    for y in 0..height {
        for x in 0..width {
            coords.push((x, y, 0)); // R
            coords.push((x, y, 1)); // G
            coords.push((x, y, 2)); // B
        }
    }

    // SIMPLIFIED HASH for demo (Use sha2 in production):
    let mut seed = [0u8; 32];
    let pass_bytes = password.as_bytes();
    for (i, &b) in pass_bytes.iter().enumerate() {
        seed[i % 32] ^= b;
    }
    
    // Shuffle using ChaCha20 RNG
    let mut rng = ChaCha20Rng::from_seed(seed);
    
    // Fisher-Yates shuffle
    for i in (1..coords.len()).rev() {
        let j = rng.gen_range(0..=i);
        coords.swap(i, j);
    }
    
    coords
}

fn encrypt_bytes(data: &[u8], password: &str) -> Vec<u8> {
    // Hash password to 32 bytes for AES Key
    let mut key_bytes = [0u8; 32];
    for (i, &b) in password.as_bytes().iter().enumerate() {
        key_bytes[i % 32] ^= b;
    }
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    // Generate random nonce
    let mut rng = rand::thread_rng();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, data).expect("Encryption failed");

    // Prepend nonce to result
    let mut result = nonce_bytes.to_vec();
    result.extend(ciphertext);
    result
}

fn decrypt_bytes(encrypted_data: &[u8], password: &str) -> Result<Vec<u8>, String> {
    if encrypted_data.len() < 12 {
        return Err("Data too short".into());
    }

    let (nonce_bytes, ciphertext) = encrypted_data.split_at(12);

    let mut key_bytes = [0u8; 32];
    for (i, &b) in password.as_bytes().iter().enumerate() {
        key_bytes[i % 32] ^= b;
    }
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher.decrypt(nonce, ciphertext).map_err(|_| "Decryption failed (Wrong password?)".into())
}


#[wasm_bindgen]
pub fn encrypt_and_hide(image_bytes: &[u8], secret_bytes: &[u8], filename: String, password: String) -> Result<Vec<u8>, String> {
    // 1. COMPRESS secret_bytes
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(secret_bytes).map_err(|e| e.to_string())?;
    let compressed_bytes = encoder.finish().map_err(|e| e.to_string())?;

    // 2. Prepare Payload
    let name_bytes = filename.as_bytes();
    let name_len = name_bytes.len() as u32;
    let mut payload = Vec::new();
    payload.extend_from_slice(&name_len.to_be_bytes());
    payload.extend_from_slice(name_bytes);
    payload.extend_from_slice(&compressed_bytes);

    // 3. Encrypt
    let encrypted_data = encrypt_bytes(&payload, &password);
    let data_len = encrypted_data.len() as u32; // We need to save this!

    // 4. Load Image
    let img = image::load_from_memory(image_bytes).map_err(|e| e.to_string())?;
    let mut img_buffer = img.to_rgba8();
    let (width, height) = img.dimensions();

    let coords = get_shuffled_indices(width, height, &password);
    
    // We need 32 bits (4 bytes) for size + data bits
    let total_bits_needed = 32 + (encrypted_data.len() * 8);
    if total_bits_needed > coords.len() {
        return Err("File too large".into());
    }

    // 5. HIDE SIZE (First 32 bits of the shuffled path)
    for bit_pos in 0..32 {
        let bit = (data_len >> (31 - bit_pos)) & 1;
        let (x, y, channel) = coords[bit_pos];
        let pixel = img_buffer.get_pixel_mut(x, y);
        pixel[channel] = (pixel[channel] & 0xFE) | (bit as u8);
    }

    // 6. HIDE DATA (Rest of the path)
    for (i, byte) in encrypted_data.iter().enumerate() {
        for bit_pos in 0..8 {
            let bit = (byte >> (7 - bit_pos)) & 1;
            // Note: offset by 32 because we used first 32 for size
            let (x, y, channel) = coords[32 + (i * 8) + bit_pos]; 
            let pixel = img_buffer.get_pixel_mut(x, y);
            pixel[channel] = (pixel[channel] & 0xFE) | bit;
        }
    }

    // 7. Save
    let dyn_image = DynamicImage::ImageRgba8(img_buffer);
    let mut buffer = Cursor::new(Vec::new());
    dyn_image.write_to(&mut buffer, ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(buffer.into_inner())
}

#[wasm_bindgen]
pub fn decrypt_and_extract(image_bytes: &[u8], password: String) -> Result<DecryptedFile, String> {
    let img = image::load_from_memory(image_bytes).map_err(|e| e.to_string())?;
    let img_buffer = img.to_rgba8();
    let (width, height) = img.dimensions();
    
    let coords = get_shuffled_indices(width, height, &password);

    // 1. EXTRACT SIZE (First 32 bits)
    let mut data_len: u32 = 0;
    for bit_pos in 0..32 {
        let (x, y, channel) = coords[bit_pos];
        let bit = img_buffer.get_pixel(x, y)[channel] & 1;
        data_len = (data_len << 1) | (bit as u32);
    }

    // Safety check: is size realistic?
    if data_len == 0 || data_len as usize > coords.len() / 8 {
        return Err("Invalid data length detected. Wrong password?".into());
    }

    // 2. EXTRACT DATA
    let mut encrypted_data = vec![0u8; data_len as usize];
    for i in 0..data_len as usize {
        let mut byte = 0u8;
        for bit_pos in 0..8 {
            let (x, y, channel) = coords[32 + (i * 8) + bit_pos];
            let bit = img_buffer.get_pixel(x, y)[channel] & 1;
            byte = (byte << 1) | bit;
        }
        encrypted_data[i] = byte;
    }

    // 3. DECRYPT
    let decrypted = decrypt_bytes(&encrypted_data, &password)?;

    // 4. PARSE (Len + Name + Content)
    if decrypted.len() < 4 { return Err("Corrupted payload".into()); }
    
    let (len_bytes, rest) = decrypted.split_at(4);
    let name_len = u32::from_be_bytes(len_bytes.try_into().unwrap()) as usize;
    
    if rest.len() < name_len { return Err("Filename truncated".into()); }
    let (name_bytes, content_compressed) = rest.split_at(name_len);
    
    let filename = String::from_utf8(name_bytes.to_vec()).unwrap_or("unknown.bin".to_string());
    // 5. DECOMPRESS
    let mut decoder = ZlibDecoder::new(content_compressed);
    let mut decompressed_data = Vec::new();
    decoder.read_to_end(&mut decompressed_data)
        .map_err(|_| String::from("Decompression failed (Corrupt data or wrong password)"))?;

    Ok(DecryptedFile {
        filename,
        data: decompressed_data // <--- Return the decompressed data
    })
}

// --- ADD TO THE BOTTOM OF lib.rs ---

#[wasm_bindgen]
pub fn preview_heatmap(width: u32, height: u32, password: String, payload_size: u32) -> Result<Vec<u8>, String> {
    // 1. Create a black image
    let mut heatmap = image::RgbImage::new(width, height);

    // 2. Get the shuffled coordinates
    let coords = get_shuffled_indices(width, height, &password);

    // 3. Calculate bits needed
    let total_bits_needed = (32 + (payload_size as usize * 8)).min(coords.len());

    // 4. Mark pixels cumulatively
    // We add 85 brightness (255 / 3) for each channel modified in a pixel.
    for i in 0..total_bits_needed {
        let (x, y, _) = coords[i];

        // Get current pixel value (starts at 0,0,0)
        let pixel = heatmap.get_pixel_mut(x, y);
        
        // Add 85 to the existing brightness. 
        // 1 hit = 85 (Dark Gray)
        // 2 hits = 170 (Light Gray)
        // 3 hits = 255 (White)
        let new_val = pixel[0].saturating_add(85);
        
        *pixel = image::Rgb([new_val, new_val, new_val]);
    }

    // 5. Write to PNG
    let mut buffer = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(heatmap)
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    Ok(buffer.into_inner())
}

#[wasm_bindgen]
pub fn calculate_required_pixels(secret_bytes: &[u8], filename: String) -> u32 {
    // 1. Simulate Compression
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    if encoder.write_all(secret_bytes).is_err() { return 0; }
    let compressed = encoder.finish().unwrap_or(Vec::new());

    // 2. Calculate Payload Size
    // Payload = [NameLen (4)] + [Name] + [Compressed Content]
    let name_bytes = filename.as_bytes();
    let payload_len = 4 + name_bytes.len() + compressed.len();

    // 3. Calculate Encrypted Size
    // AES-GCM adds: 12 bytes (Nonce) + 16 bytes (Auth Tag)
    let encrypted_len = 12 + payload_len + 16;

    // 4. Calculate Pixels
    // We need 32 bits for the Size Header + 8 bits per byte of data
    let total_bits = 32 + (encrypted_len * 8);

    // Each bit uses 1 pixel (LSB)
    total_bits as u32
}