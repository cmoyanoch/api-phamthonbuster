const express = require('express');
const router = express.Router();
const { authenticateApiKey } = require('../middleware/authentication');
const { logInfo, logError } = require('../utils/logger');

/**
 * Endpoint para verificar el estado de créditos de Phantombuster
 * Verifica si hay créditos disponibles para ejecutar agentes
 */
router.get('/credits', authenticateApiKey, async (req, res) => {
  try {
    logInfo('🔍 Verificando estado de créditos de Phantombuster');

    // Intentar hacer una llamada de prueba a Phantombuster
    const testResponse = await fetch('https://api.phantombuster.com/api/v2/agents/fetch-output?id=test', {
      method: 'GET',
      headers: {
        'X-Phantombuster-Key': process.env.PHANTOMBUSTER_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const responseData = await testResponse.json();

    // Si obtenemos un 402, significa que no hay créditos
    if (testResponse.status === 402) {
      return res.status(200).json({
        success: true,
        message: 'État des crédits vérifié',
        timestamp: new Date().toISOString(),
        data: {
          status: 'no_credits_available',
          errorCode: 402,
          issue: 'execution_time_exhausted',
          currentCredits: 0,
          remainingCredits: 0,
          recommendations: [
            'Mettre à jour le plan Phantombuster pour obtenir plus de crédits',
            'Attendre jusqu\'au prochain reset mensuel (8 jours)',
            'Contacter le support Phantombuster pour vérifier l\'état du compte',
            'Vérifier l\'utilisation d\'autres agents pour optimiser les ressources'
          ],
          nextSteps: [
            'Vérifier l\'état du compte sur https://phantombuster.com/resources',
            'Envisager de passer à un plan supérieur',
            'Mettre en pause temporairement les automatisations jusqu\'à avoir des crédits'
          ],
          estimatedReset: '8 jours (reset mensuel automatique)',
          affectedAgents: [
            'LinkedIn Profile Visitor',
            'LinkedIn Autoconnect',
            'LinkedIn Message Sender'
          ]
        }
      });
    }

    // Si obtenemos otro error, puede ser por configuración
    if (!testResponse.ok) {
      return res.status(200).json({
        success: true,
        message: 'État des crédits vérifié',
        timestamp: new Date().toISOString(),
        data: {
          status: 'configuration_error',
          errorCode: testResponse.status,
          issue: 'api_configuration_problem',
          recommendations: [
            'Vérifier la configuration de la clé API Phantombuster',
            'Confirmer que les agents sont correctement configurés',
            'Vérifier les logs du serveur pour plus de détails'
          ],
          nextSteps: [
            'Vérifier PHANTOMBUSTER_API_KEY dans la configuration',
            'Confirmer que les agents sont actifs dans Phantombuster',
            'Contacter le support technique si le problème persiste'
          ]
        }
      });
    }

    // Si todo está bien, asumimos que hay créditos disponibles
    return res.status(200).json({
      success: true,
              message: 'État des crédits vérifié',
        timestamp: new Date().toISOString(),
        data: {
          status: 'credits_available',
          errorCode: null,
          issue: null,
          currentCredits: 'available',
          remainingCredits: 'sufficient',
          recommendations: [
            'Les crédits sont disponibles pour exécuter les agents',
            'Vous pouvez procéder avec les automatisations normalement'
          ],
          nextSteps: [
            'Continuer avec les opérations normales',
            'Surveiller l\'utilisation des crédits régulièrement'
          ]
      }
    });

  } catch (error) {
    logError('Error verificando créditos de Phantombuster', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification de l\'état des crédits',
      error: error.message,
      timestamp: new Date().toISOString(),
      data: {
        status: 'error_checking_credits',
        recommendations: [
          'Vérifier la connectivité avec Phantombuster',
          'Vérifier la configuration réseau',
          'Contacter le support technique si le problème persiste'
        ]
      }
    });
  }
});

/**
 * Endpoint para obtener información general del estado de Phantombuster
 * Incluye verificación real de créditos y conectividad
 */
router.get('/status', authenticateApiKey, async (req, res) => {
  try {
    logInfo('📊 Verificando estado general de Phantombuster');

    // Verificar configuración básica
    const statusInfo = {
      apiKey: process.env.PHANTOMBUSTER_API_KEY ? 'configured' : 'missing',
      agents: {
        profileVisitor: process.env.PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID ? 'configured' : 'missing',
        autoconnect: process.env.PHANTOMBUSTER_AUTOCONNECT_AGENT_ID ? 'configured' : 'missing',
        messageSender: process.env.PHANTOMBUSTER_MESSAGE_SENDER_AGENT_ID ? 'configured' : 'missing'
      },
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    };

    // Verificar conectividad y créditos reales
    let connectivityStatus = 'unknown';
    let creditsStatus = 'unknown';
    let hasCredits = false;
    let errorMessage = '';

    try {
      // Hacer una llamada de prueba a Phantombuster para verificar conectividad y créditos
      const testResponse = await fetch('https://api.phantombuster.com/api/v2/agents/fetch-all', {
        method: 'GET',
        headers: {
          'X-Phantombuster-Key': process.env.PHANTOMBUSTER_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 segundos
      });

      if (testResponse.status === 200) {
        connectivityStatus = 'connected';
        creditsStatus = 'available';
        hasCredits = true;
      } else if (testResponse.status === 402) {
        connectivityStatus = 'connected';
        creditsStatus = 'exhausted';
        hasCredits = false;
        errorMessage = 'Crédits d\'exécution épuisés';
      } else if (testResponse.status === 401) {
        connectivityStatus = 'connected';
        creditsStatus = 'auth_error';
        hasCredits = false;
        errorMessage = 'Erreur d\'authentification avec Phantombuster';
      } else {
        connectivityStatus = 'connected';
        creditsStatus = 'other_error';
        hasCredits = false;
        errorMessage = `Erreur d'API: ${testResponse.status}`;
      }
    } catch (error) {
      connectivityStatus = 'disconnected';
      creditsStatus = 'unknown';
      hasCredits = false;
              errorMessage = `Erreur de connectivité: ${error.message}`;
    }

    // Determinar el estado general
    let overallStatus = 'online';
    if (connectivityStatus === 'disconnected') {
      overallStatus = 'offline';
    } else if (creditsStatus === 'exhausted') {
      overallStatus = 'no_credits';
    } else if (creditsStatus === 'auth_error') {
      overallStatus = 'auth_error';
    } else if (creditsStatus === 'other_error') {
      overallStatus = 'error';
    }

    const enhancedStatusInfo = {
      ...statusInfo,
      connectivity: {
        status: connectivityStatus,
        hasCredits: hasCredits,
        creditsStatus: creditsStatus,
        errorMessage: errorMessage
      },
      overallStatus: overallStatus,
      isOnline: overallStatus === 'online'
    };

    return res.status(200).json({
      success: true,
      message: 'État de Phantombuster obtenu',
      data: enhancedStatusInfo
    });

  } catch (error) {
    logError('Error obteniendo estado de Phantombuster', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'obtention de l\'état de Phantombuster',
      error: error.message,
      timestamp: new Date().toISOString(),
      data: {
        overallStatus: 'error',
        isOnline: false,
        connectivity: {
          status: 'error',
          hasCredits: false,
          creditsStatus: 'error',
          errorMessage: error.message
        }
      }
    });
  }
});

module.exports = router;
