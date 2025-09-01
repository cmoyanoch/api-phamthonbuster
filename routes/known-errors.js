const express = require('express');
const router = express.Router();
const { authenticateApiKey } = require('../middleware/authentication');
const PhantombusterErrorParser = require('../services/PhantombusterErrorParser');
const { logInfo, logError } = require('../utils/logger');

/**
 * Obtener errores conocidos por tipo
 */
router.get('/by-type/:errorType', authenticateApiKey, async (req, res) => {
  try {
    const { errorType } = req.params;

    logInfo(`🔍 Buscando errores conocidos de tipo: ${errorType}`);

    const phantombusterErrorParser = new PhantombusterErrorParser();
    const errors = await phantombusterErrorParser.findKnownErrorsByType(errorType);

    return res.json({
      success: true,
      message: `Errores conocidos de tipo ${errorType} encontrados`,
      data: {
        errorType,
        count: errors.length,
        errors: errors
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logError('Error obteniendo errores conocidos por tipo', error);

    return res.status(500).json({
      success: false,
      message: 'Error obteniendo errores conocidos',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Obtener estadísticas de errores
 */
router.get('/statistics', authenticateApiKey, async (req, res) => {
  try {
    logInfo('📊 Obteniendo estadísticas de errores conocidos');

    const phantombusterErrorParser = new PhantombusterErrorParser();
    const statistics = await phantombusterErrorParser.getErrorStatistics();

    return res.json({
      success: true,
      message: 'Estadísticas de errores obtenidas',
      data: {
        statistics: statistics,
        summary: {
          totalErrorTypes: statistics.length,
          totalErrors: statistics.reduce((sum, stat) => sum + parseInt(stat.total_errors), 0),
          totalResolved: statistics.reduce((sum, stat) => sum + parseInt(stat.resolved_errors), 0),
          totalUnresolved: statistics.reduce((sum, stat) => sum + parseInt(stat.unresolved_errors), 0)
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logError('Error obteniendo estadísticas de errores', error);

    return res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas de errores',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Marcar error como resuelto
 */
router.post('/:containerId/resolve', authenticateApiKey, async (req, res) => {
  try {
    const { containerId } = req.params;
    const { resolutionNotes } = req.body;

    logInfo(`✅ Marcando error como resuelto: ${containerId}`);

    const phantombusterErrorParser = new PhantombusterErrorParser();
    const result = await phantombusterErrorParser.markErrorAsResolved(containerId, resolutionNotes);

    if (result) {
      return res.json({
        success: true,
        message: 'Error marcado como resuelto exitosamente',
        data: result,
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'Error no encontrado',
        error: 'ERROR_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    logError('Error marcando error como resuelto', error);

    return res.status(500).json({
      success: false,
      message: 'Error marcando error como resuelto',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Obtener recomendaciones para un tipo de error
 */
router.get('/recommendations/:errorType', authenticateApiKey, async (req, res) => {
  try {
    const { errorType } = req.params;

    logInfo(`💡 Obteniendo recomendaciones para error: ${errorType}`);

    const phantombusterErrorParser = new PhantombusterErrorParser();
    const recommendations = phantombusterErrorParser.generateRecommendations(errorType);

    return res.json({
      success: true,
      message: 'Recomendaciones obtenidas',
      data: recommendations,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logError('Error obteniendo recomendaciones', error);

    return res.status(500).json({
      success: false,
      message: 'Error obteniendo recomendaciones',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Listar todos los tipos de errores disponibles
 */
router.get('/types', authenticateApiKey, async (req, res) => {
  try {
    logInfo('📋 Obteniendo tipos de errores disponibles');

    const errorTypes = [
      'credits_exhausted',
      'argument_validation_error',
      'no_results_found',
      'authentication_error',
      'permission_error',
      'agent_not_found',
      'connectivity_error',
      'rate_limit_error',
      'unknown_error'
    ];

    return res.json({
      success: true,
      message: 'Tipos de errores disponibles',
      data: {
        errorTypes: errorTypes,
        count: errorTypes.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logError('Error obteniendo tipos de errores', error);

    return res.status(500).json({
      success: false,
      message: 'Error obteniendo tipos de errores',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
