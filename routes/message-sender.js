const express = require('express');
const router = express.Router();
const PhantombusterService = require('../services/PhantombusterService');
const { authenticateApiKey } = require('../middleware/authentication');
const { logInfo, logError } = require('../utils/logger');
const metricsCollector = require('../monitoring/metrics');

// Inicializar servicio
const phantombusterService = new PhantombusterService();

/**
 * Endpoint simplificado para LinkedIn Message Sender
 * Solo requiere profileUrl y message
 * Todos los demás parámetros son manejados internamente
 */
router.post('/launch', authenticateApiKey, async (req, res) => {
  try {
    const { profileUrl, profileUrls, message } = req.body;

    // ============================================================================
    // VERIFICACIÓN DE LÍMITES DIARIOS
    // ============================================================================
    const DatabaseService = require('../database-service');
    const dbService = new DatabaseService();
    await dbService.initialize();

    const userId = req.query.userId || 'default';
    const date = new Date().toISOString().split('T')[0];
    const limits = await dbService.getCompleteDailyLimits(userId, date);

    // Verificar si se ha alcanzado el límite de mensajes
    if (limits.message_count >= limits.message_limit) {
      return res.status(429).json({
        success: false,
        message: '❌ Límite diario de mensajes alcanzado',
        error: 'DAILY_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString(),
        data: {
          current: limits.message_count,
          limit: limits.message_limit,
          remaining: 0,
          resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Mañana a esta hora
          recommendations: [
            'Esperar hasta mañana para enviar más mensajes',
            'Revisar la calidad de los mensajes',
            'Optimizar el targeting de conexiones'
          ]
        }
      });
    }

    // Verificar si está cerca del límite (80% o más)
    const usagePercentage = (limits.message_count / limits.message_limit) * 100;
    if (usagePercentage >= 80) {
      console.log(`⚠️ ADVERTENCIA: Límite de mensajes al ${usagePercentage.toFixed(1)}%`);
    }

    // Mapeo inteligente: acepta tanto profileUrl (string) como profileUrls (array)
    let targetProfileUrls = [];

    if (profileUrl && typeof profileUrl === 'string') {
      // Modo simplificado: un solo perfil como string
      targetProfileUrls = [profileUrl.trim()];
    } else if (profileUrls && Array.isArray(profileUrls)) {
      // Modo legacy: array de URLs (mantenido para compatibilidad)
      targetProfileUrls = profileUrls;
    } else {
      return res.status(400).json({
        success: false,
        message: "Se requiere 'profileUrl' (string) o 'profileUrls' (array). Usa 'profileUrl' para un solo perfil.",
        error: "MISSING_PROFILE_URL",
        examples: {
          "Recomendado (un perfil)": {
            "profileUrl": "https://www.linkedin.com/in/ejemplo-perfil/",
            "message": "Hola! Me gustaría conectar contigo."
          },
          "Legacy (múltiples perfiles)": {
            "profileUrls": ["https://www.linkedin.com/in/perfil-1/"],
            "message": "Hola! Me gustaría conectar contigo."
          }
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "message es requerido y debe ser un string no vacío",
        error: "INVALID_MESSAGE",
        timestamp: new Date().toISOString()
      });
    }

    // Validar que las URLs sean de LinkedIn
    const invalidUrls = targetProfileUrls.filter(url => !url.includes('linkedin.com/in/'));
    if (invalidUrls.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Todas las URLs deben ser perfiles de LinkedIn",
        error: "INVALID_LINKEDIN_URLS",
        invalidUrls,
        receivedInput: profileUrl ? 'profileUrl' : 'profileUrls',
        timestamp: new Date().toISOString()
      });
    }

    // Validar límite de URLs por seguridad
    // Para modo simplificado (profileUrl), máximo 1 perfil
    // Para modo legacy (profileUrls), máximo 3 perfiles
    const maxProfiles = profileUrl ? 1 : 3;
    if (targetProfileUrls.length > maxProfiles) {
      return res.status(400).json({
        success: false,
        message: profileUrl
          ? "Modo 'profileUrl' solo acepta un perfil. Para múltiples perfiles usa 'profileUrls' (máximo 3)."
          : "Máximo 3 perfiles por ejecución en modo 'profileUrls' para evitar límites de LinkedIn",
        error: "TOO_MANY_PROFILES",
        received: targetProfileUrls.length,
        maximum: maxProfiles,
        inputMode: profileUrl ? 'profileUrl (single)' : 'profileUrls (batch)',
        timestamp: new Date().toISOString()
      });
    }

    // Validar longitud del mensaje (LinkedIn tiene límites)
    if (message.length > 8000) {
      return res.status(400).json({
        success: false,
        message: "El mensaje no puede exceder 8000 caracteres (límite de LinkedIn)",
        error: "MESSAGE_TOO_LONG",
        received: message.length,
        maximum: 8000,
        timestamp: new Date().toISOString()
      });
    }

    const inputMode = profileUrl ? 'single' : 'batch';
    logInfo(`📩 Iniciando LinkedIn Message Sender (${inputMode}) para ${targetProfileUrls.length} perfil${targetProfileUrls.length > 1 ? 'es' : ''}`);

    // Configuración interna predefinida (valores seguros y optimizados)
    const messageSenderConfig = {
      // Agent ID específico para LinkedIn Message Sender (debe configurarse en .env)
      agentId: process.env.PHANTOMBUSTER_MESSAGE_SENDER_AGENT_ID || process.env.PHANTOMBUSTER_AGENT_ID,

      // Configuración de seguridad de LinkedIn
      sessionCookie: process.env.LINKEDIN_SESSION_COOKIE,
      userAgent: process.env.LINKEDIN_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",

      // Parámetros del usuario (siempre array internamente)
      profileUrls: targetProfileUrls,
      message: message.trim(),

      // Configuración de seguridad (valores internos)
      numberOfProfilesPerLaunch: targetProfileUrls.length,
      delayBetweenMessages: 60, // 60 segundos entre mensajes
      personalizeMessage: true,

      // Límites de velocidad para evitar restricciones de LinkedIn
      rateLimiting: {
        delayBetweenMessages: 60,
        maxMessagesPerDay: 20, // Límite conservador para Message Sender
        respectLinkedInLimits: true,
        randomDelay: true // Añadir variación aleatoria a los delays
      },

      // Configuración de reintentos
      retryPolicy: {
        maxRetries: 3,
        retryDelay: 120000, // 2 minutos entre reintentos
        retryOnError: true
      }
    };

    // Verificar que tenemos la configuración necesaria
    if (!messageSenderConfig.agentId) {
      return res.status(500).json({
        success: false,
        message: "Agent ID para Message Sender no está configurado",
        error: "MISSING_AGENT_ID",
        note: "Configurar PHANTOMBUSTER_MESSAGE_SENDER_AGENT_ID en variables de entorno",
        timestamp: new Date().toISOString()
      });
    }

    if (!messageSenderConfig.sessionCookie) {
      return res.status(500).json({
        success: false,
        message: "Cookie de sesión de LinkedIn no está configurado",
        error: "MISSING_LINKEDIN_COOKIE",
        note: "Configurar LINKEDIN_SESSION_COOKIE en variables de entorno",
        timestamp: new Date().toISOString()
      });
    }

    // Generar ID único para esta ejecución
    const executionId = `message_sender_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logInfo(`🚀 Lanzando Message Sender con configuración:`, {
      executionId,
      inputMode,
      profileCount: targetProfileUrls.length,
      profileUrl: profileUrl || null,
      messageLength: message.length,
      delayBetweenMessages: messageSenderConfig.delayBetweenMessages,
      maxMessagesPerDay: messageSenderConfig.rateLimiting.maxMessagesPerDay
    });

    const startTime = Date.now();

    // Lanzar el phantom de Message Sender
    const launchResult = await phantombusterService.launchMessageSenderAgent(messageSenderConfig);

    const duration = Date.now() - startTime;

    if (launchResult.success) {
      // Registrar métricas
      metricsCollector.recordPhantombusterMessageSender(true, duration);

      // ============================================================================
      // INCREMENTAR CONTADOR DE MENSAJES (SOLO SI EL LANZAMIENTO FUE EXITOSO)
      // ============================================================================
      try {
        await dbService.incrementMessageCount(userId, date);
        console.log(`✅ Contador de mensajes incrementado para usuario: ${userId}`);
      } catch (error) {
        console.error("⚠️ Error incrementando contador de mensajes:", error);
        // No fallar el lanzamiento por error en el contador
      }

      logInfo(`✅ Message Sender lanzado exitosamente: ${launchResult.containerId}`);

      return res.json({
        success: true,
        executionId,
        containerId: launchResult.containerId,
        status: "running",
        message: "LinkedIn Message Sender iniciado exitosamente",
        data: {
          inputMode,
          profileUrl: profileUrl || null,
          profileCount: targetProfileUrls.length,
          messageLength: message.length,
          estimatedDuration: targetProfileUrls.length === 1 ? "2-3 minutos" : `${Math.ceil(targetProfileUrls.length * 1.5 + 3)} minutos`,
          estimatedCompletionTime: new Date(Date.now() + (targetProfileUrls.length * 60000 + 180000)).toISOString(),
          configuration: {
            delayBetweenMessages: messageSenderConfig.delayBetweenMessages,
            personalizeMessage: messageSenderConfig.personalizeMessage,
            maxMessagesPerDay: messageSenderConfig.rateLimiting.maxMessagesPerDay,
            respectLinkedInLimits: messageSenderConfig.rateLimiting.respectLinkedInLimits
          },
          limits: {
            current: limits.message_count + 1,
            limit: limits.message_limit,
            remaining: limits.message_remaining - 1,
            usagePercentage: Math.round(((limits.message_count + 1) / limits.message_limit) * 100)
          }
        },
        timestamp: new Date().toISOString()
      });
        } else {
      // Usar el nuevo sistema de parsing de errores
      const PhantombusterErrorParser = require('../services/PhantombusterErrorParser');
      const phantombusterErrorParser = new PhantombusterErrorParser();

      const errorInfo = phantombusterErrorParser.parsePhantombusterResponse(launchResult);

      if (errorInfo.hasError) {
        // Guardar el error en la base de datos
        const containerId = `message_sender_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await phantombusterErrorParser.saveKnownError(errorInfo, containerId);

        // Generar recomendaciones basadas en el tipo de error
        const recommendations = phantombusterErrorParser.generateRecommendations(errorInfo.errorType);

        // Determinar el código HTTP apropiado
        let httpCode = 500;
        if (errorInfo.errorType === 'credits_exhausted') httpCode = 402;
        else if (errorInfo.errorType === 'authentication_error') httpCode = 401;
        else if (errorInfo.errorType === 'permission_error') httpCode = 403;
        else if (errorInfo.errorType === 'agent_not_found') httpCode = 404;
        else if (errorInfo.errorType === 'rate_limit_error') httpCode = 429;

        return res.status(httpCode).json({
          success: false,
          message: recommendations.title,
          error: errorInfo.errorType.toUpperCase(),
          errorCode: httpCode,
          timestamp: new Date().toISOString(),
          data: {
            issue: errorInfo.errorType,
            currentStatus: 'error_detected',
            errorDetails: errorInfo.errorDetails,
            containerId: containerId,
            recommendations: recommendations.recommendations,
            nextSteps: recommendations.nextSteps,
            estimatedReset: recommendations.estimatedReset,
            affectedAgents: recommendations.affectedAgents
          }
        });
      }

      throw new Error(launchResult.error || 'Error desconocido al lanzar Message Sender');
    }

  } catch (error) {
    logError('Error en LinkedIn Message Sender', error);
    metricsCollector.recordError('MESSAGE_SENDER_ERROR', '/api/message-sender/launch', error.message);

    return res.status(500).json({
      success: false,
      message: "Error interno al iniciar LinkedIn Message Sender",
      error: error.message,
      timestamp: new Date().toISOString(),
      note: "Revisar logs del servidor para más detalles"
    });
  }
});

/**
 * Endpoint para verificar el estado de una ejecución de Message Sender
 */
router.get('/status/:containerId', authenticateApiKey, async (req, res) => {
  try {
    const { containerId } = req.params;

    if (!containerId) {
      return res.status(400).json({
        success: false,
        message: "containerId es requerido",
        error: "MISSING_CONTAINER_ID",
        timestamp: new Date().toISOString()
      });
    }

    logInfo(`📊 Verificando estado de Message Sender: ${containerId}`);

    // Obtener estado del phantom
    const statusResult = await phantombusterService.getAgentStatus(containerId, "message_sender");

    if (statusResult.success) {
      const status = statusResult.data;

      return res.json({
        success: true,
        containerId,
        status: status.status,
        progress: status.progress || 0,
        message: status.message || "Message Sender en progreso",
        data: {
          messagesRequested: status.messagesRequested || 0,
          messagesSent: status.messagesSent || 0,
          messagesDelivered: status.messagesDelivered || 0,
          errors: status.errors || [],
          duration: status.duration || 0,
          estimatedTimeRemaining: status.estimatedTimeRemaining || "Calculando..."
        },
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(404).json({
        success: false,
        message: "No se pudo obtener el estado del Message Sender",
        error: "STATUS_NOT_AVAILABLE",
        containerId,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    logError('Error obteniendo estado de Message Sender', error);

    return res.status(500).json({
      success: false,
      message: "Error interno al verificar estado de Message Sender",
      error: error.message,
      containerId: req.params.containerId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Endpoint para obtener resultados de una ejecución completada de Message Sender
 */
router.get('/results/:containerId', authenticateApiKey, async (req, res) => {
  try {
    const { containerId } = req.params;

    if (!containerId) {
      return res.status(400).json({
        success: false,
        message: "containerId es requerido",
        error: "MISSING_CONTAINER_ID",
        timestamp: new Date().toISOString()
      });
    }

    logInfo(`📥 Obteniendo resultados de Message Sender: ${containerId}`);

    // Intentar obtener resultados
    const resultsResult = await phantombusterService.getMessageSenderResults(containerId);

    if (resultsResult.success) {
      return res.json({
        success: true,
        containerId,
        status: "completed",
        totalResults: resultsResult.results.length,
        results: resultsResult.results,
        summary: {
          messagesRequested: resultsResult.summary.messagesRequested || 0,
          messagesSent: resultsResult.summary.messagesSent || 0,
          messagesDelivered: resultsResult.summary.messagesDelivered || 0,
          messagesRead: resultsResult.summary.messagesRead || 0,
          successRate: resultsResult.summary.successRate || "0%",
          deliveryRate: resultsResult.summary.deliveryRate || "0%",
          errors: resultsResult.summary.errors || [],
          warnings: resultsResult.summary.warnings || [],
          totalDuration: resultsResult.summary.totalDuration || 0,
          breakdown: resultsResult.summary.breakdown || {}
        },
        s3FileUrl: resultsResult.s3FileUrl || null,
        interpretation: resultsResult.interpretation || null,
        message: "Resultados de Message Sender obtenidos exitosamente",
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(404).json({
        success: false,
        message: "No se encontraron resultados para este Message Sender",
        error: "NO_RESULTS_AVAILABLE",
        containerId,
        timestamp: new Date().toISOString(),
        note: "Verificar que la ejecución haya completado exitosamente"
      });
    }

  } catch (error) {
    logError('Error obteniendo resultados de Message Sender', error);

    return res.status(500).json({
      success: false,
      message: "Error interno al obtener resultados de Message Sender",
      error: error.message,
      containerId: req.params.containerId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Endpoint para detener una ejecución de Message Sender en curso
 */
router.post('/stop/:containerId', authenticateApiKey, async (req, res) => {
  try {
    const { containerId } = req.params;
    const { reason = "Detenido manualmente por usuario" } = req.body;

    if (!containerId) {
      return res.status(400).json({
        success: false,
        message: "containerId es requerido",
        error: "MISSING_CONTAINER_ID",
        timestamp: new Date().toISOString()
      });
    }

    logInfo(`🛑 Deteniendo Message Sender: ${containerId}, razón: ${reason}`);

    // Detener el phantom
    const stopResult = await phantombusterService.stopAgent(containerId);

    if (stopResult.success) {
      return res.json({
        success: true,
        containerId,
        status: "stopped",
        message: "Message Sender detenido exitosamente",
        reason,
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Error deteniendo Message Sender",
        error: stopResult.error || "STOP_FAILED",
        containerId,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    logError('Error deteniendo Message Sender', error);

    return res.status(500).json({
      success: false,
      message: "Error interno al detener Message Sender",
      error: error.message,
      containerId: req.params.containerId,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
