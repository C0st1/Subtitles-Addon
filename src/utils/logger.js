/**
 * Structured JSON logger. Redacts API keys automatically.
 */
function log(level, provider, message, data = {}) {
  const redactedData = JSON.parse(JSON.stringify(data));
  if (redactedData.config) {
    Object.keys(redactedData.config).forEach(k => {
      if (k.includes('api_key')) redactedData.config[k] = '***';
    });
  }
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    provider,
    message,
    ...redactedData
  }));
}

module.exports = {
  info: (provider, msg, data) => log('INFO', provider, msg, data),
  error: (provider, msg, data) => log('ERROR', provider, msg, data),
  warn: (provider, msg, data) => log('WARN', provider, msg, data)
};
