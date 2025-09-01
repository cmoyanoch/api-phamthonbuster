/**
 * Middleware para validar Container IDs
 */
const { validateContainerId } = require('../utils/responseHelpers');

/**
 * Middleware que valida el containerId en los parámetros de la ruta
 */
const validateContainerIdMiddleware = (req, res, next) => {
  const { containerId } = req.params;
  
  const validation = validateContainerId(containerId);
  if (!validation.isValid) {
    return res.status(400).json(validation.error);
  }
  
  next();
};

module.exports = {
  validateContainerIdMiddleware
};