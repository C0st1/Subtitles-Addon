'use strict';
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Get encryption key from environment, derive from ENC_SECRET or use a default for dev
function getEncryptionKey() {
  const secret = process.env.ENC_SECRET;
  if (!secret) return null; // Encryption disabled
  return crypto.scryptSync(secret, 'subtitle-hub-salt', 32);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns base64url string: IV + ciphertext + authTag (all concatenated).
 * Returns plaintext unchanged if encryption is not configured.
 */
function encrypt(plaintext) {
  const key = getEncryptionKey();
  if (!key) return plaintext;
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString('base64url');
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Returns decrypted plaintext or original string if decryption fails or not configured.
 */
function decrypt(encrypted) {
  const key = getEncryptionKey();
  if (!key) return encrypted;
  
  try {
    const combined = Buffer.from(encrypted, 'base64url');
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    return encrypted; // Fallback to original
  }
}

/**
 * Encrypt all API key fields in a config object.
 */
function encryptConfig(config) {
  if (!getEncryptionKey()) return config;
  const apiKeyFields = ['opensubtitles_api_key', 'subdl_api_key', 'subsource_api_key', 'addic7ed_username', 'addic7ed_password'];
  const encrypted = { ...config };
  for (const field of apiKeyFields) {
    if (encrypted[field]) {
      encrypted[field] = '__enc__:' + encrypt(encrypted[field]);
    }
  }
  return encrypted;
}

/**
 * Decrypt all API key fields in a config object.
 */
function decryptConfig(config) {
  const apiKeyFields = ['opensubtitles_api_key', 'subdl_api_key', 'subsource_api_key', 'addic7ed_username', 'addic7ed_password'];
  const decrypted = { ...config };
  for (const field of apiKeyFields) {
    if (decrypted[field] && decrypted[field].startsWith('__enc__:')) {
      decrypted[field] = decrypt(decrypted[field].substring(7));
    }
  }
  return decrypted;
}

module.exports = { encrypt, decrypt, encryptConfig, decryptConfig, isEncryptionEnabled: () => !!getEncryptionKey() };
