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
        message: "ID de conteneur invalide",
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
    'Agent not found': { status: 404, message: 'Agent non trouvé ou expiré' },
    '400': { status: 400, message: 'Demande invalide à l\'agent' },
    '401': { status: 401, message: 'Non autorisé à accéder à l\'agent' },
    '403': { status: 403, message: 'Accès interdit à l\'agent' }
  };

  // Buscar coincidencia en el mensaje de error
  for (const [key, value] of Object.entries(errorMap)) {
    if (errorMessage.includes(key)) {
      return value;
    }
  }

  // Error genérico por defecto
  return { status: 500, message: 'Erreur lors de l\'obtention de l\'état de recherche' };
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
const createSuccessResponse = (data, message = 'Opération réussie', extra = {}) => ({
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
