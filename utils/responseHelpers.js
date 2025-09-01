/**
 * Utilidades para respuestas HTTP estandarizadas
 */

/**
 * Validar Container ID
 */
const validateContainerId = (containerId) => {
  if (!containerId || containerId.length < 10) {
    return {
      isValid: false,
      error: {
        success: false,
        message: "Container ID inválido",
        error: "INVALID_CONTAINER_ID",
        containerId,
        timestamp: new Date().toISOString(),
      }
    };
  }
  return { isValid: true };
};

/**
 * Mapear errores de Phantombuster a códigos HTTP
 */
const mapPhantombusterError = (error) => {
  const errorMessage = error.message || '';
  
  const errorMap = {
    'Agent not found': { status: 404, message: 'Agente no encontrado o expirado' },
    '400': { status: 400, message: 'Solicitud inválida al agente' },
    '401': { status: 401, message: 'No autorizado para acceder al agente' },
    '403': { status: 403, message: 'Acceso prohibido al agente' }
  };

  // Buscar coincidencia en el mensaje de error
  for (const [key, value] of Object.entries(errorMap)) {
    if (errorMessage.includes(key)) {
      return value;
    }
  }

  // Error genérico por defecto
  return { status: 500, message: 'Error obteniendo estado de búsqueda' };
};

/**
 * Crear respuesta de error estándar
 */
const createErrorResponse = (message, error, statusCode = 500, extra = {}) => ({
  success: false,
  message,
  error: error instanceof Error ? error.message : error,
  timestamp: new Date().toISOString(),
  ...extra
});

/**
 * Crear respuesta de éxito estándar
 */
const createSuccessResponse = (data, message = 'Operación exitosa', extra = {}) => ({
  success: true,
  message,
  timestamp: new Date().toISOString(),
  ...data,
  ...extra
});

/**
 * Crear respuesta de resultados procesados
 */
const createResultsResponse = (results, containerId, source = 'direct', extra = {}) => ({
  success: true,
  status: "completed",
  progress: 100,
  totalResults: results.length,
  results,
  containerId,
  timestamp: new Date().toISOString(),
  source,
  ...extra
});

module.exports = {
  validateContainerId,
  mapPhantombusterError,
  createErrorResponse,
  createSuccessResponse,
  createResultsResponse
};