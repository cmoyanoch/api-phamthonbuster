const express = require('express');
const router = express.Router();
const { authenticateApiKey } = require('../middleware/authentication');
const DatabaseService = require('../database-service');
const { logInfo, logError } = require('../utils/logger');

// Inicializar el servicio de base de datos
let dbService;

async function initializeDatabaseService() {
  if (!dbService) {
    dbService = new DatabaseService();
    await dbService.initialize();
  }
  return dbService;
}

// ============================================================================
// ENDPOINTS PARA GESTIÓN DE LÍMITES DIARIOS
// ============================================================================

/**
 * GET /api/limits/daily
 * Obtener límites diarios actuales para todos los agentes
 */
router.get('/daily', authenticateApiKey, async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const date = req.query.date || new Date().toISOString().split('T')[0];

    logInfo(`📊 Consultando límites diarios para usuario: ${userId}, fecha: ${date}`);

    const dbServiceInstance = await initializeDatabaseService();
    const limits = await dbServiceInstance.getCompleteDailyLimits(userId, date);

    res.json({
      success: true,
      message: 'Limites quotidiens obtenus avec succès',
      timestamp: new Date().toISOString(),
      data: {
        userId: limits.user_id,
        date: limits.date,
        agents: {
          profileVisitor: {
            current: limits.visit_count,
            limit: limits.visit_limit,
            remaining: limits.visit_remaining,
            exceeded: limits.visit_count >= limits.visit_limit,
            percentage: Math.round((limits.visit_count / limits.visit_limit) * 100)
          },
          searchAgent: {
            current: limits.search_count,
            limit: limits.search_limit,
            remaining: limits.search_remaining,
            exceeded: limits.search_count >= limits.search_limit,
            percentage: Math.round((limits.search_count / limits.search_limit) * 100)
          },
          autoconnect: {
            current: limits.connection_count,
            limit: limits.connection_limit,
            remaining: limits.connection_remaining,
            exceeded: limits.connection_count >= limits.connection_limit,
            percentage: Math.round((limits.connection_count / limits.connection_limit) * 100)
          },
          messageSender: {
            current: limits.message_count,
            limit: limits.message_limit,
            remaining: limits.message_remaining,
            exceeded: limits.message_count >= limits.message_limit,
            percentage: Math.round((limits.message_count / limits.message_limit) * 100)
          }
        },
        summary: {
          totalUsed: limits.visit_count + limits.search_count + limits.connection_count + limits.message_count,
          totalLimit: limits.visit_limit + limits.search_limit + limits.connection_limit + limits.message_limit,
          totalRemaining: limits.visit_remaining + limits.search_remaining + limits.connection_remaining + limits.message_remaining,
          anyExceeded: limits.visit_count >= limits.visit_limit ||
                      limits.search_count >= limits.search_limit ||
                      limits.connection_count >= limits.connection_limit ||
                      limits.message_count >= limits.message_limit
        }
      }
    });

  } catch (error) {
    logError('❌ Error obteniendo límites diarios:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/limits/increment
 * Incrementar contador de un agente específico
 */
router.post('/increment', authenticateApiKey, async (req, res) => {
  try {
    const { agentType, userId = 'default' } = req.body;
    const date = new Date().toISOString().split('T')[0];

    if (!agentType) {
      return res.status(400).json({
        success: false,
        message: 'Le type d\'agent est requis',
        validAgents: ['profileVisitor', 'searchAgent', 'autoconnect', 'messageSender']
      });
    }

    logInfo(`📈 Incrementando contador para agente: ${agentType}, usuario: ${userId}`);

    const dbServiceInstance = await initializeDatabaseService();
    let result;
    let agentName;

    switch (agentType) {
      case 'profileVisitor':
        result = await dbServiceInstance.incrementVisitCount(userId, date);
        agentName = 'Profile Visitor';
        break;
      case 'searchAgent':
        result = await dbServiceInstance.incrementSearchCount(userId, date);
        agentName = 'Search Agent';
        break;
      case 'autoconnect':
        result = await dbServiceInstance.incrementConnectionCount(userId, date);
        agentName = 'Autoconnect';
        break;
      case 'messageSender':
        result = await dbServiceInstance.incrementMessageCount(userId, date);
        agentName = 'Message Sender';
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Tipo de agente inválido',
          validAgents: ['profileVisitor', 'searchAgent', 'autoconnect', 'messageSender']
        });
    }

    // Obtener límites actualizados
    const updatedLimits = await dbServiceInstance.getCompleteDailyLimits(userId, date);

    res.json({
      success: true,
      message: `Contador incrementado exitosamente para ${agentName}`,
      timestamp: new Date().toISOString(),
      data: {
        agentType,
        agentName,
        userId: result.user_id,
        date: result.date,
        newCount: result[`${agentType === 'profileVisitor' ? 'visit' : agentType === 'searchAgent' ? 'search' : agentType === 'autoconnect' ? 'connection' : 'message'}_count`],
        limits: updatedLimits
      }
    });

  } catch (error) {
    logError('❌ Error incrementando contador:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/limits/status
 * Obtener estado de límites (resumen rápido)
 */
router.get('/status', authenticateApiKey, async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const date = new Date().toISOString().split('T')[0];

    const dbServiceInstance = await initializeDatabaseService();
    const limits = await dbServiceInstance.getCompleteDailyLimits(userId, date);

    const status = {
      profileVisitor: {
        status: limits.visit_count >= limits.visit_limit ? 'EXCEEDED' : 'AVAILABLE',
        remaining: limits.visit_remaining
      },
      searchAgent: {
        status: limits.search_count >= limits.search_limit ? 'EXCEEDED' : 'AVAILABLE',
        remaining: limits.search_remaining
      },
      autoconnect: {
        status: limits.connection_count >= limits.connection_limit ? 'EXCEEDED' : 'AVAILABLE',
        remaining: limits.connection_remaining
      },
      messageSender: {
        status: limits.message_count >= limits.message_limit ? 'EXCEEDED' : 'AVAILABLE',
        remaining: limits.message_remaining
      }
    };

    const overallStatus = Object.values(status).some(agent => agent.status === 'EXCEEDED') ? 'LIMITED' : 'AVAILABLE';

    res.json({
      success: true,
      message: 'État des limites obtenu avec succès',
      timestamp: new Date().toISOString(),
      data: {
        overallStatus,
        agents: status,
        summary: {
          availableAgents: Object.values(status).filter(agent => agent.status === 'AVAILABLE').length,
          exceededAgents: Object.values(status).filter(agent => agent.status === 'EXCEEDED').length,
          totalRemaining: Object.values(status).reduce((sum, agent) => sum + agent.remaining, 0)
        }
      }
    });

  } catch (error) {
    logError('❌ Error obteniendo estado de límites:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/limits/history
 * Obtener historial de límites de los últimos días
 */
router.get('/history', authenticateApiKey, async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const days = parseInt(req.query.days) || 7;

    const dbServiceInstance = await initializeDatabaseService();
    const client = await dbServiceInstance.pgPool.connect();

    const query = `
      SELECT * FROM phantombuster.daily_limits
      WHERE user_id = $1
      ORDER BY date DESC
      LIMIT $2
    `;

    const result = await client.query(query, [userId, days]);
    client.release();

    const history = result.rows.map(row => ({
      date: row.date,
      profileVisitor: row.visit_count,
      searchAgent: row.search_count,
      autoconnect: row.connection_count,
      messageSender: row.message_count,
      total: row.visit_count + row.search_count + row.connection_count + row.message_count
    }));

    res.json({
      success: true,
      message: 'Historial de límites obtenido exitosamente',
      timestamp: new Date().toISOString(),
      data: {
        userId,
        days,
        history,
        summary: {
          totalDays: history.length,
          averagePerDay: history.length > 0 ? Math.round(history.reduce((sum, day) => sum + day.total, 0) / history.length) : 0,
          maxPerDay: history.length > 0 ? Math.max(...history.map(day => day.total)) : 0
        }
      }
    });

  } catch (error) {
    logError('❌ Error obteniendo historial de límites:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
