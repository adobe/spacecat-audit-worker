/**
 * A utility log method to streamline logging.
 *
 * @param {string} level - The log level ('info', 'error', 'warn').
 * @param {string} message - The message to log.
 * @param {...any} args - Additional arguments to log.
 */
const log = (level, message, ...args) => {
  const timestamp = new Date().toISOString();

  switch (level) {
    case 'info':
      console.info(`[${timestamp}] INFO: ${message}`, ...args);
      break;
    case 'error':
      console.error(`[${timestamp}] ERROR: ${message}`, ...args);
      break;
    case 'warn':
      console.warn(`[${timestamp}] WARN: ${message}`, ...args);
      break;
    default:
      console.log(`[${timestamp}] ${message}`, ...args);
      break;
  }
};

module.exports = {
  log,
};
