'use strict';

const SENSITIVE_KEY_PATTERNS = ['api_key', 'apikey', 'token', 'secret', 'password', 'credential', 'auth'];

/**
 * Structured JSON logger with automatic sensitive data redaction.
 * Supports request correlation IDs for serverless environments.
 */
function log(level, provider, message, data = {}) {
  // Log level filtering: suppress INFO in production
  if (process.env.NODE_ENV === 'production' && level === 'INFO') return;

  const requestId = process.env.__REQUEST_ID__ || undefined;

  // Deep clone data without the performance cost of JSON round-trip
  const redactedData = structuredClone(data);

  // Recursively redact sensitive keys in nested objects
  redactSensitive(redactedData);

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    provider,
    message,
    ...(requestId && { requestId }),
    data: redactedData
  };

  // Use appropriate console level
  if (level === 'ERROR') {
    console.error(JSON.stringify(entry));
  } else if (level === 'WARN') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

/**
 * Recursively redact keys matching sensitive patterns.
 */
function redactSensitive(obj) {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    obj.forEach(item => redactSensitive(item));
    return;
  }

  for (const key of Object.keys(obj)) {
    const keyLower = key.toLowerCase();
    if (SENSITIVE_KEY_PATTERNS.some(pattern => keyLower.includes(pattern))) {
      obj[key] = '***REDACTED***';
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      redactSensitive(obj[key]);
    }
  }
}

module.exports = {
  info: (provider, msg, data) => log('INFO', provider, msg, data),
  error: (provider, msg, data) => log('ERROR', provider, msg, data),
  warn: (provider, msg, data) => log('WARN', provider, msg, data)
};
