'use strict';

const SECRET_KEY = /password|authorization|cookie|token|secret|api.?key|database.?url/i;

function redact(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, 'postgresql://[REDACTED]@')
      .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]')
      .replace(/scrypt\$[^\s]+/g, 'scrypt$[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  return value;
}

function createLogger(output = console) {
  const write = (level, event, details = {}) => output[level](`[${event}]`, redact(details));
  return {
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details)
  };
}

module.exports = { createLogger, redact };
