const KnownErrorsService = require('./KnownErrorsService');

class PhantombusterErrorParser {
  constructor() {
    this.knownErrorsService = new KnownErrorsService();
  }

  /**
   * Parsea la respuesta de Phantombuster para detectar errores conocidos
   */
  parsePhantombusterResponse(response, containerId = null) {
    try {
      // Si es una respuesta exitosa, no hay error
      if (response.success) {
        return { hasError: false };
      }

      const errorInfo = {
        hasError: true,
        errorType: null,
        errorMessage: null,
        errorDetails: {},
        exitCode: null,
        endType: 'error',
        durationMs: null
      };

      // Extraer información del error
      if (response.error) {
        errorInfo.errorMessage = response.error;
      }

      if (response.message) {
        errorInfo.errorMessage = response.message;
      }

      if (response.data) {
        errorInfo.errorDetails = response.data;
      }

      // Detectar tipos específicos de errores
      errorInfo.errorType = this.detectErrorType(response);

      return errorInfo;
    } catch (error) {
      console.error('Error parseando respuesta de Phantombuster:', error);
      return {
        hasError: true,
        errorType: 'parsing_error',
        errorMessage: 'Error parseando respuesta de Phantombuster',
        errorDetails: { originalError: error.message }
      };
    }
  }

  /**
   * Detecta el tipo de error basado en la respuesta
   */
  detectErrorType(response) {
    const errorText = JSON.stringify(response).toLowerCase();
    const errorMessage = (response.error || response.message || '').toLowerCase();

    // Error de créditos agotados (402)
    if (errorMessage.includes('402') ||
        errorMessage.includes('no monthly execution time remaining') ||
        errorMessage.includes('execution time exhausted') ||
        errorText.includes('402')) {
      return 'credits_exhausted';
    }

    // Error de argumentos inválidos
    if (errorMessage.includes('phantom argument is invalid') ||
        errorMessage.includes('search => must be string') ||
        errorMessage.includes('argument is invalid')) {
      return 'argument_validation_error';
    }

    // Error de no resultados encontrados
    if (errorMessage.includes('no results found') ||
        errorMessage.includes('no leads found')) {
      return 'no_results_found';
    }

    // Error de autenticación
    if (errorMessage.includes('unauthorized') ||
        errorMessage.includes('401') ||
        errorMessage.includes('invalid api key')) {
      return 'authentication_error';
    }

    // Error de permisos
    if (errorMessage.includes('forbidden') ||
        errorMessage.includes('403') ||
        errorMessage.includes('access denied')) {
      return 'permission_error';
    }

    // Error de agente no encontrado
    if (errorMessage.includes('agent not found') ||
        errorMessage.includes('404') ||
        errorMessage.includes('not found')) {
      return 'agent_not_found';
    }

    // Error de conectividad
    if (errorMessage.includes('no response') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection')) {
      return 'connectivity_error';
    }

    // Error de límites de rate
    if (errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests') ||
        errorMessage.includes('429')) {
      return 'rate_limit_error';
    }

    // Error genérico
    return 'unknown_error';
  }

  /**
   * Guarda un error conocido en la base de datos
   */
  async saveKnownError(errorInfo, containerId = null) {
    try {
      if (!errorInfo.hasError) {
        return null;
      }

      const errorData = {
        containerId: containerId || `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        errorType: errorInfo.errorType,
        errorMessage: errorInfo.errorMessage,
        errorDetails: errorInfo.errorDetails,
        exitCode: errorInfo.exitCode,
        endType: errorInfo.endType,
        durationMs: errorInfo.durationMs
      };

      const result = await this.knownErrorsService.saveKnownError(errorData);
      console.log(`✅ Error conocido guardado: ${errorData.containerId} - ${errorData.errorType}`);

      return result;
    } catch (error) {
      console.error(`❌ Error guardando error conocido: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca errores conocidos por tipo
   */
  async findKnownErrorsByType(errorType) {
    try {
      return await this.knownErrorsService.findKnownErrorsByType(errorType);
    } catch (error) {
      console.error(`❌ Error buscando errores conocidos: ${error.message}`);
      return [];
    }
  }

  /**
   * Obtiene estadísticas de errores
   */
  async getErrorStatistics() {
    try {
      return await this.knownErrorsService.getErrorStatistics();
    } catch (error) {
      console.error(`❌ Error obteniendo estadísticas: ${error.message}`);
      return [];
    }
  }

  /**
   * Marca un error como resuelto
   */
  async markErrorAsResolved(containerId, resolutionNotes = null) {
    try {
      return await this.knownErrorsService.markErrorAsResolved(containerId, resolutionNotes);
    } catch (error) {
      console.error(`❌ Error marcando error como resuelto: ${error.message}`);
      return null;
    }
  }

  /**
   * Genera recomendaciones basadas en el tipo de error
   */
  generateRecommendations(errorType) {
    const recommendations = {
      credits_exhausted: {
        title: '❌ Créditos de ejecución agotados',
        description: 'No hay créditos disponibles en Phantombuster',
        recommendations: [
          'Actualizar el plan de Phantombuster para obtener más créditos',
          'Esperar hasta el próximo reset mensual (8 días)',
          'Contactar soporte de Phantombuster para verificar el estado de la cuenta',
          'Revisar el uso de otros agentes para optimizar recursos'
        ],
        nextSteps: [
          'Verificar el estado de la cuenta en https://phantombuster.com/resources',
          'Considerar actualizar a un plan superior',
          'Pausar temporalmente las automatizaciones hasta tener créditos'
        ],
        estimatedReset: '8 días (reset mensual automático)',
        affectedAgents: [
          'LinkedIn Profile Visitor',
          'LinkedIn Autoconnect',
          'LinkedIn Message Sender'
        ]
      },
      argument_validation_error: {
        title: '❌ Error de validación de argumentos',
        description: 'Los argumentos proporcionados no son válidos',
        recommendations: [
          'Verificar el formato de los parámetros enviados',
          'Asegurar que las URLs de LinkedIn sean válidas',
          'Revisar la documentación de la API',
          'Contactar soporte técnico si el problema persiste'
        ],
        nextSteps: [
          'Revisar los logs del servidor para más detalles',
          'Verificar la configuración de los agentes',
          'Probar con parámetros diferentes'
        ]
      },
      no_results_found: {
        title: '⚠️ No se encontraron resultados',
        description: 'La búsqueda no produjo resultados',
        recommendations: [
          'Ampliar los criterios de búsqueda',
          'Verificar que las URLs de búsqueda sean correctas',
          'Revisar los filtros aplicados',
          'Considerar usar diferentes palabras clave'
        ],
        nextSteps: [
          'Revisar los parámetros de búsqueda',
          'Probar con diferentes criterios',
          'Verificar la conectividad con LinkedIn'
        ]
      },
      authentication_error: {
        title: '🔐 Error de autenticación',
        description: 'Problema con las credenciales de Phantombuster',
        recommendations: [
          'Verificar que la API key sea válida',
          'Confirmar que la cuenta esté activa',
          'Revisar los permisos de la API key',
          'Contactar soporte de Phantombuster'
        ],
        nextSteps: [
          'Verificar la configuración de PHANTOMBUSTER_API_KEY',
          'Confirmar el estado de la cuenta en Phantombuster',
          'Regenerar la API key si es necesario'
        ]
      },
      permission_error: {
        title: '🚫 Error de permisos',
        description: 'No tienes permisos para realizar esta acción',
        recommendations: [
          'Verificar los permisos de la API key',
          'Confirmar que tienes acceso al agente',
          'Revisar la configuración de la cuenta',
          'Contactar al administrador de la cuenta'
        ],
        nextSteps: [
          'Verificar los permisos en Phantombuster',
          'Confirmar el acceso a los agentes',
          'Contactar soporte si es necesario'
        ]
      },
      agent_not_found: {
        title: '🔍 Agente no encontrado',
        description: 'El agente especificado no existe o no está disponible',
        recommendations: [
          'Verificar que el ID del agente sea correcto',
          'Confirmar que el agente esté activo',
          'Revisar la configuración de los agentes',
          'Contactar soporte técnico'
        ],
        nextSteps: [
          'Verificar PHANTOMBUSTER_*_AGENT_ID en la configuración',
          'Confirmar que los agentes estén activos en Phantombuster',
          'Revisar la configuración del proyecto'
        ]
      },
      connectivity_error: {
        title: '🌐 Error de conectividad',
        description: 'Problema de conexión con Phantombuster',
        recommendations: [
          'Verificar la conectividad de red',
          'Revisar la configuración de firewall',
          'Confirmar que Phantombuster esté disponible',
          'Intentar nuevamente en unos minutos'
        ],
        nextSteps: [
          'Verificar la conectividad a api.phantombuster.com',
          'Revisar los logs del servidor',
          'Contactar soporte técnico si persiste'
        ]
      },
      rate_limit_error: {
        title: '⏱️ Límite de velocidad alcanzado',
        description: 'Se ha alcanzado el límite de requests',
        recommendations: [
          'Esperar antes de hacer más requests',
          'Implementar retry con backoff exponencial',
          'Revisar la frecuencia de requests',
          'Optimizar el uso de la API'
        ],
        nextSteps: [
          'Implementar delays entre requests',
          'Revisar la estrategia de rate limiting',
          'Considerar usar batch requests'
        ]
      },
      unknown_error: {
        title: '❓ Error desconocido',
        description: 'Error no identificado',
        recommendations: [
          'Revisar los logs del servidor',
          'Verificar la configuración',
          'Contactar soporte técnico',
          'Proporcionar más contexto del error'
        ],
        nextSteps: [
          'Revisar los logs para más detalles',
          'Verificar la configuración del sistema',
          'Contactar soporte técnico'
        ]
      }
    };

    return recommendations[errorType] || recommendations.unknown_error;
  }

  /**
   * Cierra las conexiones
   */
  async close() {
    await this.knownErrorsService.close();
  }
}

module.exports = PhantombusterErrorParser;
