/**
 * Sistema de logging optimizado para reemplazar console.log
 */
const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Asegurar que existe el directorio de logs
const logDir = path.join(__dirname, '../logs');
let canWriteLogs = true;

try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true, mode: 0o775 });
  }
  // Verificar que podemos escribir en el directorio
  fs.accessSync(logDir, fs.constants.W_OK);
} catch (error) {
  canWriteLogs = false;
  console.warn('No se puede usar directorio de logs, usando solo console:', error.message);
}

// Configurar Winston con manejo de errores
const transports = [];

// Solo agregar transportes de archivo si podemos escribir logs
if (canWriteLogs) {
  transports.push(
    // Escribir logs de error a archivo
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Ecribir logs combinados a archivo
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Siempre agregar consola para logs en producción (sin archivos)
transports.push(new winston.transports.Console({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
      return `${timestamp} [${service || 'api'}] ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  )
}));

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'phantombuster-api' },
  transports: transports,
  silent: false // Asegurar que no esté silenciado
});

/**
 * Wrapper functions para mantener compatibilidad con console.log
 */
const logInfo = (message, meta = {}) => {
  logger.info(message, meta);
};

const logError = (message, error = null, meta = {}) => {
  logger.error(message, {
    error: error instanceof Error ? error.message : error,
    stack: error instanceof Error ? error.stack : null,
    ...meta
  });
};

const logWarn = (message, meta = {}) => {
  logger.warn(message, meta);
};

const logDebug = (message, meta = {}) => {
  logger.debug(message, meta);
};

// Función para endpoints críticos (solo información esencial)
const logEndpoint = (method, path, status, duration, meta = {}) => {
  logger.info('API Request', {
    method,
    path,
    status,
    duration: `${duration}ms`,
    ...meta
  });
};

module.exports = {
  logger,
  logInfo,
  logError,
  logWarn,
  logDebug,
  logEndpoint
};
