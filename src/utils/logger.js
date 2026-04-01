/**
 * Structured JSON logger with automatic API key redaction.
 *
 * Improvements:
 * - Redacts any key containing 'api_key' OR 'apikey' (case-insensitive)
 *   to catch both snake_case and camelCase variants.
 * - Uses console.error for ERROR level so it surfaces in serverless log streams
 *   that separate stdout/stderr.
 * - Redaction is applied to nested objects (one level deep via config key).
 */
function redact(data) {
  const clone = JSON.parse(JSON.stringify(data));
  const redactObj = (obj) => {
    if (typeof obj !== 'object' || obj === null) return;
    for (const key of Object.keys(obj)) {
      if (/api[_-]?key/i.test(key)) {
        obj[key] = '***';
      } else if (typeof obj[key] === 'object') {
        redactObj(obj[key]);
      }
    }
  };
  redactObj(clone);
  return clone;
}

function log(level, provider, message, data = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    provider,
    message,
    ...redact(data),
  });

  if (level === 'ERROR') {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

module.exports = {
  info:  (provider, msg, data) => log('INFO',  provider, msg, data),
  warn:  (provider, msg, data) => log('WARN',  provider, msg, data),
  error: (provider, msg, data) => log('ERROR', provider, msg, data),
};
