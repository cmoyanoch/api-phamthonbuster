const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

// Importar módulos refactorizados
const { authenticateApiKey } = require("./middleware/authentication");
const PhantombusterService = require("./services/PhantombusterService");
const LinkedInProfileVisitorService = require("./services/LinkedInProfileVisitorService");
const DatabaseService = require("./database-service");
const LinkedInCookieManager = require("./cookie-manager");

// Importar rutas específicas
const autoconnectRoutes = require("./routes/autoconnect");
const messageSenderRoutes = require("./routes/message-sender");
const autoconnectMonitoringRoutes = require("./routes/autoconnect-monitoring");
const domainScraperRoutes = require("./routes/domain-scraper");
const axonautRoutes = require("./routes/axonaut");

const metricsCollector = require("./monitoring/metrics");
const SequentialDistributionManager = require("./services/SequentialDistributionManager");
const containerStatusMonitor = require("./services/ContainerStatusMonitor");
const KnownErrorsService = require("./services/KnownErrorsService");
const PhantombusterErrorParser = require("./services/PhantombusterErrorParser");
const AutoconnectResponseMonitor = require("./services/AutoconnectResponseMonitor");
const axios = require("axios"); // Agregado axios para acceso a URLs de S3

// Importar utilidades de optimización
const { logInfo, logError, logWarn, logEndpoint } = require('./utils/logger');
const { validateContainerId, mapPhantombusterError, createErrorResponse, createSuccessResponse, createResultsResponse } = require('./utils/responseHelpers');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================================
// MIDDLEWARE DE SEGURIDAD Y CONFIGURACIÓN
// ============================================================================

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Limitación de velocidad
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por ventana
  message: {
    error: "Demasiadas requests desde esta IP, intenta de nuevo más tarde.",
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Registro de logs optimizado
app.use(morgan("combined"));

// Middleware de métricas y logging optimizado
app.use((req, res, next) => {
  const startTime = Date.now();

  res.on("finish", () => {
    const responseTime = Date.now() - startTime;
    metricsCollector.recordRequest(
      req.path,
      req.method,
      res.statusCode,
      responseTime
    );

    // Log solo requests importantes (errores o endpoints críticos)
    if (res.statusCode >= 400 || req.path.includes('/search/') || req.path.includes('/health')) {
      logEndpoint(req.method, req.path, res.statusCode, responseTime);
    }
  });

  next();
});

// ============================================================================
// INICIALIZACIÓN DE SERVICIOS
// ============================================================================

const dbService = new DatabaseService();
const phantombusterService = new PhantombusterService();
const profileVisitorService = new LinkedInProfileVisitorService();
const cookieManager = new LinkedInCookieManager();
const knownErrorsService = new KnownErrorsService();
const phantombusterErrorParser = new PhantombusterErrorParser();
const autoconnectResponseMonitor = new AutoconnectResponseMonitor(phantombusterService, dbService);
const sequentialDistributionManager = new SequentialDistributionManager(
  dbService,
  phantombusterService
);

// Inicializar servicios
(async () => {
  try {
    await dbService.initialize();

    // Asignar servicios a app.locals para acceso global
    app.locals.dbService = dbService;
    app.locals.phantombusterService = phantombusterService;
    app.locals.profileVisitorService = profileVisitorService;

    logInfo("✅ Persistencia de datos habilitada");
    logInfo("✅ Servicios asignados a app.locals");
  } catch (error) {
    logError("❌ Error inicializando persistencia", error);
    logWarn("⚠️ La API funcionará con almacenamiento en memoria");
  }
})();

// ============================================================================
// ENDPOINTS DE SALUD Y CONFIGURACIÓN
// ============================================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API Phantombuster funcionando correctamente",
    timestamp: new Date().toISOString(),
    version: "2.0.0",
    uptime: process.uptime(),
  });
});

app.get("/api/health/live", (req, res) => {
  res.status(200).send("OK");
});

// Endpoint para probar conectividad con Phantombuster
app.get("/api/test-phantombuster", authenticateApiKey, async (req, res) => {
  try {
    logInfo("🧪 Probando conectividad con Phantombuster...");

    // Hacer una petición simple a Phantombuster para verificar conectividad
    const response = await axios.get(`${phantombusterService.baseUrl}/agents/fetch-all`, {
      headers: {
        "X-Phantombuster-Key": phantombusterService.apiKey,
        "Content-Type": "application/json",
      },
      timeout: 10000, // 10 segundos
    });

    logInfo("✅ Conectividad con Phantombuster exitosa");
    res.json({
      success: true,
      message: "Conectividad con Phantombuster verificada",
      status: response.status,
      data: response.data
    });
  } catch (error) {
    logError("❌ Error en conectividad con Phantombuster", error);
    res.status(500).json({
      success: false,
      message: "Error en conectividad con Phantombuster",
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
  }
});

app.get("/api/config", authenticateApiKey, (req, res) => {
  res.json({
    success: true,
    config: {
      phantombuster: {
        apiKeyConfigured: !!process.env.PHANTOMBUSTER_API_KEY,
        searchAgentIdConfigured:
          !!process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID,
        profileVisitorAgentIdConfigured:
          !!process.env.PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID,
      },
      linkedin: {
        sessionCookieConfigured: !!process.env.LINKEDIN_SESSION_COOKIE,
        userAgentConfigured: !!process.env.LINKEDIN_USER_AGENT,
      },
      database: {
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        port: process.env.DB_PORT,
      },
      limits: {
        dailyVisitLimit: process.env.DAILY_VISIT_LIMIT || 100,
        dailySearchLimit: process.env.DAILY_SEARCH_LIMIT || 50,
        rateLimitWindow: "15 minutos",
        rateLimitMax: 100,
      },
    },
  });
});

// ============================================================================
// ENDPOINTS DE TRIGGERS DE LOOP COMPLETION
// ============================================================================

app.get("/api/loop-completion/check", authenticateApiKey, async (req, res) => {
  try {
    console.log("🔍 Verificando completion de loops...");

    const result = await dbService.pgPool.query(
      "SELECT check_and_notify_loop_completion() as result"
    );

    const message = result.rows[0]?.result || "Sin resultado";

    res.json({
      success: true,
      message: "Verificación de loop completion ejecutada",
      result: message,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`❌ Error verificando loop completion: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Error verificando loop completion",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get("/api/loop-completion/session/:sessionId", authenticateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;

    console.log(`🔍 Verificando completion de sesión: ${sessionId}`);

    const result = await dbService.pgPool.query(
      "SELECT check_session_completion($1) as details",
      [sessionId]
    );

    const sessionDetails = result.rows[0]?.details || {};

    res.json({
      success: true,
      message: `Estado de sesión ${sessionId}`,
      sessionDetails,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`❌ Error verificando sesión ${req.params.sessionId}: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Error verificando estado de sesión",
      error: error.message,
      sessionId: req.params.sessionId,
      timestamp: new Date().toISOString(),
    });
  }
});

app.post("/api/loop-completion/manual-trigger", authenticateApiKey, async (req, res) => {
  try {
    const { sessionId, force = false } = req.body;

    console.log(`🚀 Trigger manual para sesión: ${sessionId}, force: ${force}`);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "sessionId es requerido",
        timestamp: new Date().toISOString(),
      });
    }

    // Verificar estado actual de la sesión
    const sessionCheck = await dbService.pgPool.query(
      "SELECT check_session_completion($1) as details",
      [sessionId]
    );

    const sessionDetails = sessionCheck.rows[0]?.details || {};

    // Si force=true o la sesión está completa, disparar notificación
    if (force || sessionDetails.is_complete) {
      const webhookPayload = {
        event: 'manual_loop_completion_trigger',
        table: 'phantombuster.sequential_url_states',
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        session_details: sessionDetails,
        triggered_by: 'manual_api_call',
        force_triggered: force,
        message: `Manual trigger para sesión: ${sessionId}`
      };

      // Enviar notificación manual
      await dbService.pgPool.query(
        "SELECT pg_notify('loop_completion_alert', $1)",
        [JSON.stringify(webhookPayload)]
      );

      res.json({
        success: true,
        message: `Trigger manual enviado para sesión ${sessionId}`,
        sessionDetails,
        webhookPayload,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.json({
        success: false,
        message: `Sesión ${sessionId} no está completa. Use force=true para enviar de todas formas`,
        sessionDetails,
        suggestion: "POST /api/loop-completion/manual-trigger con { sessionId, force: true }",
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error(`❌ Error en trigger manual: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Error ejecutando trigger manual",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================================================
// ENDPOINTS DE ERRORES CONOCIDOS
// ============================================================================

app.get("/api/known-errors", authenticateApiKey, async (req, res) => {
  try {
    const { type, containerId, limit = 50 } = req.query;

    let errors = [];

    if (containerId) {
      const error = await knownErrorsService.findKnownErrorByContainerId(containerId);
      errors = error ? [error] : [];
    } else if (type) {
      errors = await knownErrorsService.findKnownErrorsByType(type);
    } else {
      // Obtener estadísticas generales
      const stats = await knownErrorsService.getErrorStatistics();
      return res.json({
        success: true,
        message: "Estadísticas de errores conocidos",
        statistics: stats,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: "Errores conocidos encontrados",
      errors: errors.slice(0, parseInt(limit)),
      total: errors.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`❌ Error consultando errores conocidos: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Error consultando errores conocidos",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.post("/api/known-errors/:containerId/resolve", authenticateApiKey, async (req, res) => {
  try {
    const { containerId } = req.params;
    const { resolutionNotes } = req.body;

    const result = await knownErrorsService.markErrorAsResolved(containerId, resolutionNotes);

    if (result) {
      res.json({
        success: true,
        message: "Error marcado como resuelto",
        result,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Error no encontrado",
        containerId,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error(`❌ Error marcando error como resuelto: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Error marcando error como resuelto",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================================================
// ENDPOINTS DE MÉTRICAS
// ============================================================================

app.get("/api/metrics", authenticateApiKey, (req, res) => {
  try {
    const metrics = metricsCollector.getMetrics();
    res.json({
      success: true,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error obteniendo métricas:", error);
    res.status(500).json({
      success: false,
      message: "Error obteniendo métricas",
      error: error.message,
    });
  }
});

app.post("/api/metrics/reset", authenticateApiKey, (req, res) => {
  try {
    metricsCollector.resetMetrics();
    res.json({
      success: true,
      message: "Métricas reiniciadas correctamente",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error reiniciando métricas:", error);
    res.status(500).json({
      success: false,
      message: "Error reiniciando métricas",
      error: error.message,
    });
  }
});

// ============================================================================
// ENDPOINTS DE COOKIES
// ============================================================================

app.get("/api/cookies/status", authenticateApiKey, async (req, res) => {
  try {
    const status = await cookieManager.getStatus();
    metricsCollector.recordCookieValidation(status.isValid);

    res.json({
      success: true,
      currentStatus: status.isValid ? "valid" : "invalid",
      lastValidation: status.lastValidation,
      message: status.isValid ? "Cookie válida" : "Cookie inválida",
    });
  } catch (error) {
    console.error("❌ Error obteniendo estado de cookies:", error);
    metricsCollector.recordError(
      "COOKIE_ERROR",
      "/api/cookies/status",
      error.message
    );

    res.status(500).json({
      success: false,
      message: "Error obteniendo estado de cookies",
      error: error.message,
    });
  }
});

app.post(
  "/api/validate-cookies-before-launch",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { agentType = "search" } = req.body;
              // Validación manual de cookies para agente

      const validationResult =
        await phantombusterService.validateCookiesBeforeLaunch(agentType);
      metricsCollector.recordCookieValidation(
        validationResult.success,
        validationResult.status === "renewed"
      );

      res.json({
        success: true,
        message: "Cookies validadas correctamente",
        data: {
          agentType,
          validationResult,
          timestamp: new Date().toISOString(),
          readyForLaunch: true,
        },
      });
    } catch (error) {
      console.error("❌ Error validando cookies:", error);
      metricsCollector.recordError(
        "COOKIE_VALIDATION_ERROR",
        "/api/validate-cookies-before-launch",
        error.message
      );

      res.status(400).json({
        success: false,
        message: "Error validando cookies",
        error: error.message,
        data: {
          readyForLaunch: false,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }
);

// ============================================================================
// ENDPOINTS DE BÚSQUEDA
// ============================================================================

// ENDPOINT /api/search/simple-start ELIMINADO - FUNCIONALIDAD CONSOLIDADA EN /api/search

// Endpoint unificado para búsquedas (URL directa y parámetros simples)
app.post("/api/search", authenticateApiKey, async (req, res) => {
  try {
    const {
      linkedInSearchUrl,
      numberOfResults,
      // NUEVOS PARÁMETROS PARA SECUENCIA
      campaignId,
      urlsWithPriorities = [],
      useSequentialDistribution,
    } = req.body;

    // Log básico para debugging
    console.log(`📥 Request recibido - useSequentialDistribution: ${useSequentialDistribution}`);

    // Extraer totalLeadsLimit de urlsWithPriorities si está disponible
    let totalLeadsLimit = 2500; // valor por defecto
    if (urlsWithPriorities && urlsWithPriorities.length > 0 && urlsWithPriorities[0].totalLeadsLimit) {
      totalLeadsLimit = parseInt(urlsWithPriorities[0].totalLeadsLimit);
      console.log(`📊 TotalLeadsLimit extraído de urlsWithPriorities: ${totalLeadsLimit}`);
    }

    let searchData, launchResult;

    // SI ES DISTRIBUCIÓN SECUENCIAL
    if (useSequentialDistribution) {
      // Validar y corregir urlsWithPriorities
      let processedUrlsWithPriorities = urlsWithPriorities;

      // Si es string, intentar parsearlo como JSON
      if (typeof urlsWithPriorities === "string") {
        try {
          processedUrlsWithPriorities = JSON.parse(urlsWithPriorities);
          console.log(
            `🔄 URLs parseadas desde string:`,
            processedUrlsWithPriorities
          );
        } catch (parseError) {
          console.error(`❌ Error parseando urlsWithPriorities:`, parseError);
          return res.status(400).json({
            success: false,
            message:
              "urlsWithPriorities debe ser un array válido o JSON string válido",
            error: "INVALID_URLS_WITH_PRIORITIES_FORMAT",
            receivedType: typeof urlsWithPriorities,
            receivedValue: urlsWithPriorities,
            parseError: parseError.message,
          });
        }
      } else if (Array.isArray(urlsWithPriorities)) {
        // Si ya es un array, usarlo directamente
        processedUrlsWithPriorities = urlsWithPriorities;
        console.log(
          `🔄 URLs recibidas como array:`,
          processedUrlsWithPriorities
        );
      }

      // Validar que sea un array después del procesamiento
      if (!Array.isArray(processedUrlsWithPriorities)) {
        return res.status(400).json({
          success: false,
          message: "urlsWithPriorities debe ser un array",
          error: "INVALID_URLS_WITH_PRIORITIES",
          receivedType: typeof processedUrlsWithPriorities,
          receivedValue: processedUrlsWithPriorities,
        });
      }

      if (processedUrlsWithPriorities.length === 0) {
        return res.status(400).json({
          success: false,
          message: "urlsWithPriorities no puede estar vacío",
          error: "EMPTY_URLS_WITH_PRIORITIES",
        });
      }

      if (!campaignId) {
        return res.status(400).json({
          success: false,
          message: "campaignId es requerido para distribución secuencial",
          error: "MISSING_CAMPAIGN_ID",
        });
      }

      console.log(`🔄 Iniciando búsqueda con distribución secuencial`);

      try {
        // Inicializar o recuperar secuencia
        const sequenceResult =
          await sequentialDistributionManager.initializeOrResumeSequence(
            campaignId,
            processedUrlsWithPriorities,
            totalLeadsLimit
          );

        if (sequenceResult.status === "completed") {
          return res.json({
            success: true,
            message: "Secuencia completada",
            data: sequenceResult,
          });
        }

        // Ejecutar próxima URL en la secuencia
        const executionResult =
          await sequentialDistributionManager.executeNextUrlInSequence(
            sequenceResult.sessionId,
            {
              numberOfResultsPerLaunch: parseInt(numberOfResults),
              numberOfResultsPerSearch: parseInt(numberOfResults),
              numberOfLinesPerLaunch: parseInt(numberOfResults),
            }
          );

        if (executionResult.status === "launched") {
          // Obtener session_cookie_hash
          const cookieHash = await cookieManager.getSessionCookieHash();

          return res.json({
            success: true,
            sessionId: executionResult.sessionId,
            containerId: executionResult.containerId,
            status: "running",
            session_cookie_hash: cookieHash.session_cookie_hash,
            message: "Búsqueda secuencial iniciada",
            data: {
              campaignId,
              urlId: executionResult.urlId,
              range: executionResult.range,
              allocatedLeads: executionResult.allocatedLeads,
              sequenceOrder: executionResult.sequenceOrder,
              remainingLeads: executionResult.remainingLeads,
              nextUrl: sequenceResult.nextUrl,
            },
          });
        } else {
          return res.json({
            success: false,
            message: "Error ejecutando secuencia",
            data: executionResult,
          });
        }
      } catch (sequenceError) {
        console.error("❌ Error en distribución secuencial:", sequenceError);
        return res.status(500).json({
          success: false,
          message: "Error en distribución secuencial",
          error: sequenceError.message,
        });
      }
    }

    // BÚSQUEDA CON URL DIRECTA (ÚNICA OPCIÓN DISPONIBLE)
    if (!linkedInSearchUrl) {
      return res.status(400).json({
        success: false,
        message: "linkedInSearchUrl es requerido para búsquedas",
        error: "MISSING_LINKEDIN_URL",
      });
    }

    // Validar que sea una URL de LinkedIn (Regular o Sales Navigator)
    if (!linkedInSearchUrl.includes("linkedin.com")) {
      return res.status(400).json({
        success: false,
        message: "URL debe ser de LinkedIn",
        error: "INVALID_LINKEDIN_URL",
        providedUrl: linkedInSearchUrl,
      });
    }

    // Extraer numberOfPage y startPage de urlsWithPriorities
    let numberOfPage = 5; // valor por defecto
    let startPage = 1;    // valor por defecto

    if (urlsWithPriorities && urlsWithPriorities.length > 0) {
      // Buscar la URL que coincida con linkedInSearchUrl
      const matchingUrl = urlsWithPriorities.find(url =>
        url.url === linkedInSearchUrl || url.url_template === linkedInSearchUrl
      );

      if (matchingUrl) {
        let rawNumberOfPage = parseInt(matchingUrl.numberOfPage) || 5;
        let rawStartPage = parseInt(matchingUrl.startPage) || 1;

        // VALIDACIÓN Y CORRECCIÓN DE PARÁMETROS
        console.log(`🔍 Parámetros originales: numberOfPage=${rawNumberOfPage}, startPage=${rawStartPage}`);

        // USAR LOS PARÁMETROS EXACTOS DE N8N SIN CORRECCIÓN
        startPage = rawStartPage;
        numberOfPage = rawNumberOfPage;

        console.log(`✅ Usando parámetros exactos de n8n: numberOfPage=${numberOfPage}, startPage=${startPage}`);

        // Solo validar valores mínimos, no corregir lógica de negocio
        if (numberOfPage < 1) {
          console.log(`⚠️ numberOfPage (${numberOfPage}) es muy bajo, pero manteniendo valor original`);
        }

        if (startPage < 1) {
          console.log(`⚠️ startPage (${startPage}) es muy bajo, pero manteniendo valor original`);
        }

        console.log(`✅ Parámetros corregidos: numberOfPage=${numberOfPage}, startPage=${startPage}`);
      } else {
        console.log(`⚠️ No se encontró URL coincidente en urlsWithPriorities, usando valores por defecto`);
        console.log(`🔍 URL buscada: ${linkedInSearchUrl}`);
      }
    } else {
      console.log(`⚠️ No se envió urlsWithPriorities, usando valores por defecto`);
    }

    console.log(`📋 Parámetros finales: numberOfPage=${numberOfPage}, startPage=${startPage}`);
    console.log(`🔍 URLs disponibles en urlsWithPriorities:`, urlsWithPriorities ? urlsWithPriorities.map(u => ({ url: u.url, numberOfPage: u.numberOfPage, startPage: u.startPage })) : 'No hay URLs');

    const searchId = `search_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Crear búsqueda inicial para URL directa
    searchData = {
      searchId,
      containerId: null,
      status: "launching",
      progress: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
      linkedInSearchUrl,
      results: [],
    };

    // Guardar en base de datos
    await dbService.saveSearch(searchData);

    // Lanzar agente con URL directa
    console.log(`🚀 Lanzando agente con parámetros:`, {
      linkedInSearchUrl,
      numberOfResults,
      numberOfPage,
      startPage
    });

    const startTime = Date.now();
    launchResult = await phantombusterService.launchSearchAgentWithUrl(
      linkedInSearchUrl,
      numberOfResults,
      parseInt(numberOfPage),
      parseInt(startPage)
    );
    const duration = Date.now() - startTime;

    // Actualizar búsqueda
    searchData.containerId = launchResult.containerId;
    searchData.status = "running";
    await dbService.updateSearchStatus(searchId, "running", 0, null, null);

    // Obtener session_cookie_hash
    const cookieHash = await cookieManager.getSessionCookieHash();

    metricsCollector.recordPhantombusterSearch(true, duration);

    res.json({
      success: true,
      searchId,
      containerId: launchResult.containerId,
      status: "running",
      session_cookie_hash: cookieHash.session_cookie_hash,
      message: "Búsqueda iniciada correctamente",
      data: {
        searchParams: {
          linkedInSearchUrl,
          numberOfResults: parseInt(numberOfResults),
          numberOfPage: numberOfPage,
          startPage: startPage,
        },
        estimatedDuration: "5-10 minutos",
        estimatedDurationMinutes: 7,
      },
    });
  } catch (error) {
    console.error("❌ Error en búsqueda:", error);
    metricsCollector.recordError("SEARCH_ERROR", "/api/search", error.message);

    res.status(500).json({
      success: false,
      message: "Error en búsqueda",
      error: error.message,
    });
  }
});

// Endpoint mejorado para verificar estado de agentes
app.get("/api/search/status/:containerId",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { containerId } = req.params;

      // Validación optimizada usando utilidad
      const validation = validateContainerId(containerId);
      if (!validation.isValid) {
        return res.status(400).json(validation.error);
      }

      try {
        // Primero intentar obtener el estado normal
        const statusResult = await phantombusterService.getAgentStatus(
          containerId,
          "search"
        );

        // Si el agente está terminado, intentar obtener resultados
        if (statusResult.data.status === "finished") {
          try {
            const resultsResult = await phantombusterService.getAgentResults(
              containerId
            );

            if (resultsResult.success) {
              const processedResults =
                phantombusterService.processPhantombusterResults(
                  resultsResult.results,
                  { containerId }
                );

              return res.json({
                success: true,
                status: "completed",
                progress: 100,
                totalResults: processedResults.length,
                results: processedResults,
                message: "Búsqueda completada exitosamente",
                containerId,
                timestamp: new Date().toISOString(),
              });
            }
          } catch (resultsError) {
            console.warn(
              `⚠️ Error obteniendo resultados del agente ${containerId}:`,
              resultsError.message
            );
            // Continuar con el estado básico si no se pueden obtener resultados
          }
        }

        // Devolver estado básico
        res.json({
          success: true,
          status: statusResult.data.status,
          progress: statusResult.data.progress || 0,
          message: statusResult.data.message || "Búsqueda en progreso",
          containerId,
          timestamp: new Date().toISOString(),
        });
      } catch (statusError) {
        // Si el agente aparece como "no encontrado", intentar obtener resultados directamente
        if (
          statusError.message &&
          statusError.message.includes("Agent not found")
        ) {
          console.log(
            `🔄 Agente ${containerId} aparece como no encontrado, intentando obtener resultados directamente...`
          );

          try {
            const directResults =
              await phantombusterService.getAgentResultsDirectly(containerId);

            if (directResults.success) {
              const processedResults =
                phantombusterService.processPhantombusterResults(
                  directResults.results,
                  { containerId }
                );

              return res.json({
                success: true,
                status: "completed",
                progress: 100,
                totalResults: processedResults.length,
                results: processedResults,
                message:
                  "Búsqueda completada (agente expirado pero resultados recuperados)",
                containerId,
                timestamp: new Date().toISOString(),
                source: directResults.source,
              });
            } else {
              // Si no se pueden obtener resultados directamente
              return res.status(404).json({
                success: false,
                message: "Agente expirado y resultados no disponibles",
                error: "AGENT_EXPIRED_NO_RESULTS",
                containerId,
                timestamp: new Date().toISOString(),
                note: "El agente completó su ejecución pero los resultados ya no están disponibles en la API",
              });
            }
          } catch (directError) {
            console.error(
              `❌ Error obteniendo resultados directamente para ${containerId}:`,
              directError.message
            );

            return res.status(404).json({
              success: false,
              message: "Agente no encontrado o expirado",
              error: "AGENT_NOT_FOUND",
              containerId,
              timestamp: new Date().toISOString(),
              note: "El agente puede haber completado su ejecución pero ya no está disponible en la API",
            });
          }
        } else {
          // Re-lanzar otros tipos de errores
          throw statusError;
        }
      }
    } catch (error) {
      logError("Error obteniendo estado de búsqueda", error);

      // Usar utilidad para mapear errores de Phantombuster
      const errorMapping = mapPhantombusterError(error);

      metricsCollector.recordError(
        "STATUS_ERROR",
        "/api/search/status",
        error.message
      );

      res.status(errorMapping.status).json(
        createErrorResponse(
          errorMapping.message,
          error,
          errorMapping.status,
          { containerId: req.params.containerId }
        )
      );
    }
  }
);



// Endpoint para recuperar resultados de agentes expirados
app.get(
  "/api/search/recover-results/:containerId",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { containerId } = req.params;
      const { sessionId, urlId } = req.query; // NUEVOS PARÁMETROS PARA SECUENCIA

          // Intentando recuperar resultados del agente expirado

      // Validación optimizada usando utilidad
      const validation = validateContainerId(containerId);
      if (!validation.isValid) {
        return res.status(400).json(validation.error);
      }

      // SI ES PARTE DE UNA SECUENCIA
      if (sessionId && urlId) {
        console.log(
          `📥 Recuperando resultados de secuencia: ${sessionId} - ${urlId}`
        );

        try {
          // Descargar con rango específico
          const results =
            await sequentialDistributionManager.downloadResultsWithSpecificRange(
              sessionId,
              urlId,
              containerId
            );

          return res.json({
            success: true,
            status: "recovered_with_fetch_result_object",
            progress: 100,
            totalResults: results.results.length,
            results: results.results,
            message: "Resultados recuperados exitosamente",
            containerId,
            sessionId,
            urlId,
            metadata: results.metadata,
            timestamp: new Date().toISOString(),
            source: "sequential_distribution",
            method: "range_specific_download",
            note: "Recuperación exitosa con distribución secuencial",
          });
        } catch (sequenceError) {
          console.error(
            "❌ Error recuperando resultados de secuencia:",
            sequenceError
          );

          // Verificar si es un error de configuración (sessionId/urlId no encontrados)
          if (sequenceError.message && sequenceError.message.includes("Estado de URL no encontrado")) {
            console.log(`⚠️ Configuración de secuencia no encontrada: ${sessionId} - ${urlId}`);
            return res.status(404).json({
              success: false,
              status: "sequential_config_not_found",
              message: "Sequential distribution configuration not found",
              error: "SEQUENTIAL_CONFIG_NOT_FOUND",
              containerId,
              sessionId,
              urlId,
              timestamp: new Date().toISOString(),
              note: "Los parámetros sessionId y urlId no corresponden a una configuración válida en la base de datos",
              details: {
                sessionId,
                urlId,
                error: sequenceError.message
              }
            });
          }


          // INTENTAR DETECTAR ERRORES CONOCIDOS ANTES DE DEVOLVER ERROR 500
          try {
            console.log(`🔍 Verificando errores conocidos para container de secuencia: ${containerId}`);

            // Obtener el estado del agente para ver si hay algún mensaje específico
            const agentStatus = await phantombusterService.getAgentStatus(containerId);

            if (agentStatus && (agentStatus.data || agentStatus.containerOutput)) {
              const containerData = agentStatus.data;
              const outputText = JSON.stringify(agentStatus.containerOutput || {}).toLowerCase();

              // Detectar error específico de argumentos inválidos
              if (outputText.includes("phantom argument is invalid") ||
                  outputText.includes("search => must be string")) {

                console.log(`⚠️ Container de secuencia ${containerId} tuvo error de argumentos inválidos`);

                // Guardar el error en la base de datos
                try {
                  await knownErrorsService.saveKnownError({
                    containerId,
                    errorType: "argument_validation_error",
                    errorMessage: "the Phantom argument is invalid: - search => must be string",
                    errorDetails: {
                      expected: "search parameter should be a string URL",
                      received: "search parameter was an object with linkedInSearchUrl property",
                      solution: "pass linkedInSearchUrl directly as search parameter",
                      outputText: outputText.substring(0, 500),
                      context: "sequential_distribution",
                      sessionId,
                      urlId
                    },
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    durationMs: containerData.endedAt - containerData.launchedAt
                  });
                } catch (dbError) {
                  console.error(`❌ Error guardando error conocido en BD: ${dbError.message}`);
                }

                return res.status(404).json({
                  success: false,
                  status: "invalid_arguments",
                  message: "Container failed due to invalid arguments",
                  error: "INVALID_ARGUMENTS",
                  containerId,
                  sessionId,
                  urlId,
                  timestamp: new Date().toISOString(),
                  note: "El container de secuencia falló debido a argumentos inválidos",
                  containerInfo: {
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    status: containerData.status,
                    duration: containerData.endedAt - containerData.launchedAt,
                    errorType: "argument_validation_error"
                  },
                  context: "sequential_distribution"
                });
              }

              // Detectar error de "No results found" con exit code 1
              if (outputText.includes("no results found") && containerData.exitCode === 1) {

                console.log(`⚠️ Container de secuencia ${containerId} no encontró resultados (exit code 1)`);

                // Guardar el error en la base de datos
                try {
                  await knownErrorsService.saveKnownError({
                    containerId,
                    errorType: "no_results_found",
                    errorMessage: "No results found - Process finished with error (exit code: 1)",
                    errorDetails: {
                      exitCode: containerData.exitCode,
                      endType: containerData.endType,
                      status: containerData.status,
                      reason: "Phantombuster no encontró resultados para la búsqueda",
                      outputText: outputText.substring(0, 500),
                      context: "sequential_distribution",
                      sessionId,
                      urlId
                    },
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    durationMs: containerData.endedAt - containerData.launchedAt
                  });
                } catch (dbError) {
                  console.error(`❌ Error guardando error conocido en BD: ${dbError.message}`);
                }

                // ACTUALIZAR ESTADO EN LA BASE DE DATOS A 'completed'
                try {
                  await dbService.updateSequentialUrlStateStatus(sessionId, urlId, 'completed');
                  console.log(`✅ Estado actualizado a 'completed' para sessionId: ${sessionId}, urlId: ${urlId} (no_results_found)`);
                } catch (dbUpdateError) {
                  console.error(`❌ Error actualizando estado a 'completed': ${dbUpdateError.message}`);
                }

                return res.status(404).json({
                  success: false,
                  status: "no_results_found",
                  message: "No results found for this search",
                  error: "NO_RESULTS_FOUND",
                  containerId,
                  sessionId,
                  urlId,
                  timestamp: new Date().toISOString(),
                  note: "Phantombuster no encontró resultados para la búsqueda especificada",
                  containerInfo: {
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    status: containerData.status,
                    duration: containerData.endedAt - containerData.launchedAt,
                    errorType: "no_results_found"
                  },
                  context: "sequential_distribution",
                  databaseUpdate: "status_updated_to_completed"
                });
              }

              // Detectar containers detenidos manualmente
              if (containerData.exitCode === 137 ||
                  containerData.endType === "killed" ||
                  (containerData.status === "finished" && containerData.exitCode !== 0)) {

                console.log(`⚠️ Container de secuencia ${containerId} fue detenido manualmente o terminó con error`);

                // Guardar el error en la base de datos
                try {
                  await knownErrorsService.saveKnownError({
                    containerId,
                    errorType: "manually_stopped",
                    errorMessage: `Container stopped with exit code ${containerData.exitCode}`,
                    errorDetails: {
                      exitCode: containerData.exitCode,
                      endType: containerData.endType,
                      status: containerData.status,
                      reason: containerData.exitCode === 137 ? "Process killed (SIGKILL)" : "Process terminated with error",
                      outputText: outputText.substring(0, 500),
                      context: "sequential_distribution",
                      sessionId,
                      urlId
                    },
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    durationMs: containerData.endedAt - containerData.launchedAt
                  });
                } catch (dbError) {
                  console.error(`❌ Error guardando error conocido en BD: ${dbError.message}`);
                }

                return res.status(404).json({
                  success: false,
                  status: "manually_stopped",
                  message: "Container was manually stopped before completion",
                  error: "MANUALLY_STOPPED",
                  containerId,
                  sessionId,
                  urlId,
                  timestamp: new Date().toISOString(),
                  note: "El container de secuencia fue detenido manualmente",
                  containerInfo: {
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    status: containerData.status,
                    duration: containerData.endedAt - containerData.launchedAt
                  },
                  context: "sequential_distribution"
                });
              }

                            // Detectar resultados ya recuperados
              const searchText = JSON.stringify(agentStatus.data || {}).toLowerCase() + " " + outputText;
              if (searchText.includes("all search results have been retrieved") ||
                  searchText.includes("we've already retrieved all results from that search") ||
                  searchText.includes("already retrieved all results") ||
                  searchText.includes("search successfully finished")) {

                console.log(`✅ Container de secuencia ${containerId} ya tiene todos los resultados recuperados`);

                // ACTUALIZAR ESTADO EN LA BASE DE DATOS A 'completed'
                try {
                  await dbService.updateSequentialUrlStateStatus(sessionId, urlId, 'completed');
                  console.log(`✅ Estado actualizado a 'completed' para sessionId: ${sessionId}, urlId: ${urlId}`);
                } catch (dbUpdateError) {
                  console.error(`❌ Error actualizando estado a 'completed': ${dbUpdateError.message}`);
                }

                return res.json({
                  success: true,
                  status: "results_already_retrieved",
                  progress: 100,
                  totalResults: 0,
                  results: [],
                  message: "All search results have been retrieved",
                  containerId,
                  sessionId,
                  urlId,
                  timestamp: new Date().toISOString(),
                  source: "phantombuster_output",
                  method: "output_analysis",
                  note: "Phantombuster indica que ya se recuperaron todos los resultados",
                  context: "sequential_distribution",
                  databaseUpdate: "status_updated_to_completed"
                });
              }
            }
          } catch (errorAnalysisError) {
            console.error(`❌ Error analizando errores conocidos: ${errorAnalysisError.message}`);
          }

          // Si no se detectó ningún error conocido, devolver el error original
          return res.status(500).json({
            success: false,
            message: "Error recuperando resultados de secuencia",
            error: sequenceError.message,
            containerId,
            sessionId,
            urlId,
            context: "sequential_distribution"
          });
        }
      }

              // LÓGICA EXISTENTE PARA RECUPERACIÓN SIMPLE
              // Intentar con fetch-result-object (método directo)
      try {
        console.log(
          `📥 Intentando con fetch-result-object para: ${containerId}`
        );
        const fetchResultObjectResult =
          await phantombusterService.getAgentResultsWithFetchResultObject(
            containerId
          );

        if (fetchResultObjectResult.success) {
          const processedResults =
            phantombusterService.processPhantombusterResults(
              fetchResultObjectResult.results,
              { containerId }
            );

                    // Verificar si los resultados están malformados
          const hasMalformedData = processedResults.some(result =>
            result.fullName === "undefined undefined" ||
            result.fullName === "null null" ||
            (result.firstName === "" && result.lastName === "" && result.fullName === "") ||
            result.isComplete === false
          );

          if (hasMalformedData && processedResults.length > 0) {
            console.log(`⚠️ Container ${containerId} tiene datos malformados: ${processedResults.length} resultados con datos incompletos`);

            // Verificar si el container originalmente reportó "No results found"
            try {
              const agentStatus = await phantombusterService.getAgentStatus(containerId);
              const outputText = JSON.stringify(agentStatus.containerOutput || {}).toLowerCase();

              if (outputText.includes("no results found") && agentStatus.data && agentStatus.data.exitCode === 1) {
                console.log(`⚠️ Container ${containerId} reportó "No results found" con exit code 1`);

                // Guardar como error de "no results found"
                try {
                  await knownErrorsService.saveKnownError({
                    containerId,
                    errorType: "no_results_found",
                    errorMessage: "No results found - Process finished with error (exit code: 1)",
                    errorDetails: {
                      exitCode: agentStatus.data.exitCode,
                      endType: agentStatus.data.endType,
                      status: agentStatus.data.status,
                      reason: "Phantombuster no encontró resultados para la búsqueda",
                      outputText: outputText.substring(0, 500),
                      context: "fetch_result_object_with_malformed_data",
                      malformedDataDetected: true,
                      totalResults: processedResults.length
                    },
                    exitCode: agentStatus.data.exitCode,
                    endType: agentStatus.data.endType,
                    durationMs: agentStatus.data.endedAt - agentStatus.data.launchedAt
                  });
                } catch (dbError) {
                  console.error(`❌ Error guardando error de no results found: ${dbError.message}`);
                }

                                // ACTUALIZAR ESTADO EN LA BASE DE DATOS A 'completed' si hay sessionId y urlId
                if (sessionId && urlId) {
                  try {
                    await dbService.updateSequentialUrlStateStatus(sessionId, urlId, 'completed');
                    console.log(`✅ Estado actualizado a 'completed' para sessionId: ${sessionId}, urlId: ${urlId} (no_results_found)`);
                  } catch (dbUpdateError) {
                    console.error(`❌ Error actualizando estado a 'completed': ${dbUpdateError.message}`);
                  }
                }

                return res.json({
                  success: false,
                  status: "no_results_found",
                  message: "No results found for this search",
                  error: "NO_RESULTS_FOUND",
                  containerId,
                  sessionId,
                  urlId,
                  timestamp: new Date().toISOString(),
                  note: "Phantombuster no encontró resultados para la búsqueda especificada",
                  containerInfo: {
                    exitCode: agentStatus.data.exitCode,
                    endType: agentStatus.data.endType,
                    status: agentStatus.data.status,
                    duration: agentStatus.data.endedAt - agentStatus.data.launchedAt,
                    errorType: "no_results_found"
                  },
                  methodsAttempted: [
                    "fetch-result-object",
                    "direct_fetch",
                    "s3_fallback",
                    "output_analysis"
                  ],
                  databaseUpdate: sessionId && urlId ? "status_updated_to_completed" : "no_sequential_context"
                });
              }
            } catch (statusError) {
              console.error(`❌ Error verificando status del container: ${statusError.message}`);
            }

            // Si no se detectó "no results found", guardar como datos malformados
            try {
              await knownErrorsService.saveKnownError({
                containerId,
                errorType: "malformed_data_error",
                errorMessage: "Container returned malformed/incomplete data",
                errorDetails: {
                  totalResults: processedResults.length,
                  malformedResults: processedResults.filter(r =>
                    r.fullName === "undefined undefined" ||
                    r.fullName === "null null" ||
                    (r.firstName === "" && r.lastName === "" && r.fullName === "") ||
                    r.isComplete === false
                  ).length,
                  sampleData: processedResults[0],
                  reason: "Phantombuster returned data but with incomplete/malformed profile information",
                  context: "fetch_result_object_success"
                },
                exitCode: null,
                endType: null,
                durationMs: null
              });
            } catch (dbError) {
              console.error(`❌ Error guardando error de datos malformados: ${dbError.message}`);
            }

            return res.json({
              success: true,
              status: "recovered_with_fetch_result_object",
              progress: 100,
              totalResults: processedResults.length,
              results: processedResults,
              message: "Resultados recuperados exitosamente",
              containerId,
              timestamp: new Date().toISOString(),
              source: fetchResultObjectResult.source,
              method: "fetch-result-object",
              note: "Recuperación exitosa usando el endpoint oficial de Phantombuster",
              warning: "Los datos recuperados están incompletos o malformados",
              errorType: "malformed_data_error"
            });
          }

          return res.json({
            success: true,
            status: "recovered_with_fetch_result_object",
            progress: 100,
            totalResults: processedResults.length,
            results: processedResults,
            message:
              "Resultados recuperados exitosamente usando fetch-result-object",
            containerId,
            timestamp: new Date().toISOString(),
            source: fetchResultObjectResult.source,
            method: "fetch-result-object",
            note: "Recuperación exitosa usando el endpoint oficial de Phantombuster",
          });
        }
      } catch (fetchError) {
        console.log(
          `⚠️ fetch-result-object falló para ${containerId}:`,
          fetchError.message
        );
        // Continuar con el siguiente método
      }

      // SEGUNDO: Si fetch-result-object falla, intentar con getAgentResultsDirectly
      try {
        console.log(
          `📥 Intentando con getAgentResultsDirectly para: ${containerId}`
        );
        const directResults =
          await phantombusterService.getAgentResultsDirectly(containerId);

        if (directResults.success) {
          const processedResults =
            phantombusterService.processPhantombusterResults(
              directResults.results,
              { containerId }
            );

          return res.json({
            success: true,
            status: "recovered_with_fetch_result_object",
            progress: 100,
            totalResults: processedResults.length,
            results: processedResults,
            message: "Resultados recuperados exitosamente",
            containerId,
            timestamp: new Date().toISOString(),
            source: directResults.source,
            method: "direct_fetch",
            note: "Recuperación exitosa usando método alternativo",
          });
        }
      } catch (directError) {
        console.log(
          `⚠️ getAgentResultsDirectly falló para ${containerId}:`,
          directError.message
        );
        // Continuar con el siguiente método
      }

      // TERCERO: Si ambos métodos fallan, intentar con S3
      try {
        // Intentando con S3
        const s3Results = await phantombusterService.getResultsFromS3(
          containerId
        );

        if (s3Results.success) {
          const processedResults =
            phantombusterService.processPhantombusterResults(
              s3Results.results,
              { containerId }
            );

          return res.json({
            success: true,
            status: "recovered_with_fetch_result_object",
            progress: 100,
            totalResults: processedResults.length,
            results: processedResults,
            message: "Resultados recuperados exitosamente",
            containerId,
            timestamp: new Date().toISOString(),
            source: s3Results.source,
            method: "s3_fallback",
            note: "Recuperación exitosa desde bucket S3 de Phantombuster",
          });
        }
      } catch (s3Error) {
        // S3 falló
      }

      // CUARTO: Si todos los métodos fallan, verificar si es porque ya se recuperaron todos los resultados
      try {
        console.log(`🔍 Verificando si ya se recuperaron todos los resultados para: ${containerId}`);

        // Obtener el estado del agente para ver si hay algún mensaje específico
        const agentStatus = await phantombusterService.getAgentStatus(containerId);

                                if (agentStatus && (agentStatus.data || agentStatus.containerOutput)) {
          // Buscar el mensaje específico en la respuesta completa de Phantombuster
          const responseText = JSON.stringify(agentStatus.data || {}).toLowerCase();
          const outputText = JSON.stringify(agentStatus.containerOutput || {}).toLowerCase();

          console.log(`🔍 Respuesta completa del agente ${containerId}:`, JSON.stringify(agentStatus.data, null, 2));
          console.log(`🔍 Output del container ${containerId}:`, JSON.stringify(agentStatus.containerOutput, null, 2));
          console.log(`🔍 Texto de búsqueda (data):`, responseText);
          console.log(`🔍 Texto de búsqueda (output):`, outputText);

          // Buscar diferentes variantes del mensaje en ambos campos
          const searchText = responseText + " " + outputText;
          if (searchText.includes("all search results have been retrieved") ||
              searchText.includes("we've already retrieved all results from that search") ||
              searchText.includes("already retrieved all results") ||
              searchText.includes("search successfully finished")) {

                        console.log(`✅ Encontrado mensaje de resultados ya recuperados para: ${containerId}`);

            // Si hay sessionId y urlId, actualizar estado en la base de datos
            if (req.query.sessionId && req.query.urlId) {
              try {
                await dbService.updateSequentialUrlStateStatus(req.query.sessionId, req.query.urlId, 'completed');
                console.log(`✅ Estado actualizado a 'completed' para sessionId: ${req.query.sessionId}, urlId: ${req.query.urlId}`);
              } catch (dbUpdateError) {
                console.error(`❌ Error actualizando estado a 'completed': ${dbUpdateError.message}`);
              }
            }

            return res.json({
              success: true,
              status: "results_already_retrieved",
              progress: 100,
              totalResults: 0,
              results: [],
              message: "All search results have been retrieved",
              containerId,
              sessionId: req.query.sessionId,
              urlId: req.query.urlId,
              timestamp: new Date().toISOString(),
              source: "phantombuster_output",
              method: "output_analysis",
              note: "Phantombuster indica que ya se recuperaron todos los resultados de esta búsqueda",
              phantombusterMessage: "All search results have been retrieved",
              agentStatus: agentStatus,
              databaseUpdate: req.query.sessionId && req.query.urlId ? "status_updated_to_completed" : "no_sequential_context"
            });
          } else {
            console.log(`❌ No se encontró el mensaje específico en la respuesta del agente ${containerId}`);
          }
        } else {
          console.log(`❌ No se pudo obtener datos del agente ${containerId}:`, agentStatus);
        }

                                // Verificar si el container fue detenido manualmente o tuvo errores específicos
            if (agentStatus && agentStatus.data) {
              const containerData = agentStatus.data;
              const outputText = JSON.stringify(agentStatus.containerOutput || {}).toLowerCase();

                            // Detectar error específico de argumentos inválidos
              if (outputText.includes("phantom argument is invalid") ||
                  outputText.includes("search => must be string")) {

                console.log(`⚠️ Container ${containerId} tuvo error de argumentos inválidos`);

                // Guardar el error en la base de datos
                try {
                  await knownErrorsService.saveKnownError({
                    containerId,
                    errorType: "argument_validation_error",
                    errorMessage: "the Phantom argument is invalid: - search => must be string",
                    errorDetails: {
                      expected: "search parameter should be a string URL",
                      received: "search parameter was an object with linkedInSearchUrl property",
                      solution: "pass linkedInSearchUrl directly as search parameter",
                      outputText: outputText.substring(0, 500) // Primeros 500 caracteres del output
                    },
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    durationMs: containerData.endedAt - containerData.launchedAt
                  });
                } catch (dbError) {
                  console.error(`❌ Error guardando error conocido en BD: ${dbError.message}`);
                }

                return res.status(404).json({
                  success: false,
                  status: "invalid_arguments",
                  message: "Container failed due to invalid arguments",
                  error: "INVALID_ARGUMENTS",
                  containerId,
                  timestamp: new Date().toISOString(),
                  note: "El container falló debido a argumentos inválidos (search debe ser string, no objeto)",
                  containerInfo: {
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    status: containerData.status,
                    duration: containerData.endedAt - containerData.launchedAt,
                    errorType: "argument_validation_error"
                  },
                  methodsAttempted: [
                    "fetch-result-object",
                    "direct_fetch",
                    "s3_fallback",
                    "output_analysis"
                  ],
                });
              }

                            // Detectar error de "No results found" con exit code 1
              if (outputText.includes("no results found") && containerData.exitCode === 1) {

                console.log(`⚠️ Container ${containerId} no encontró resultados (exit code 1)`);

                // Guardar el error en la base de datos
                try {
                  await knownErrorsService.saveKnownError({
                    containerId,
                    errorType: "no_results_found",
                    errorMessage: "No results found - Process finished with error (exit code: 1)",
                    errorDetails: {
                      exitCode: containerData.exitCode,
                      endType: containerData.endType,
                      status: containerData.status,
                      reason: "Phantombuster no encontró resultados para la búsqueda",
                      outputText: outputText.substring(0, 500)
                    },
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    durationMs: containerData.endedAt - containerData.launchedAt
                  });
                } catch (dbError) {
                  console.error(`❌ Error guardando error conocido en BD: ${dbError.message}`);
                }

                return res.status(404).json({
                  success: false,
                  status: "no_results_found",
                  message: "No results found for this search",
                  error: "NO_RESULTS_FOUND",
                  containerId,
                  timestamp: new Date().toISOString(),
                  note: "Phantombuster no encontró resultados para la búsqueda especificada",
                  containerInfo: {
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    status: containerData.status,
                    duration: containerData.endedAt - containerData.launchedAt,
                    errorType: "no_results_found"
                  },
                  methodsAttempted: [
                    "fetch-result-object",
                    "direct_fetch",
                    "s3_fallback",
                    "output_analysis"
                  ],
                });
              }

              // Detectar containers detenidos manualmente
              if (containerData.exitCode === 137 ||
                  containerData.endType === "killed" ||
                  (containerData.status === "finished" && containerData.exitCode !== 0)) {

                console.log(`⚠️ Container ${containerId} fue detenido manualmente o terminó con error`);

                // Guardar el error en la base de datos
                try {
                  await knownErrorsService.saveKnownError({
                    containerId,
                    errorType: "manually_stopped",
                    errorMessage: `Container stopped with exit code ${containerData.exitCode}`,
                    errorDetails: {
                      exitCode: containerData.exitCode,
                      endType: containerData.endType,
                      status: containerData.status,
                      reason: containerData.exitCode === 137 ? "Process killed (SIGKILL)" : "Process terminated with error",
                      outputText: outputText.substring(0, 500) // Primeros 500 caracteres del output
                    },
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    durationMs: containerData.endedAt - containerData.launchedAt
                  });
                } catch (dbError) {
                  console.error(`❌ Error guardando error conocido en BD: ${dbError.message}`);
                }

                return res.status(404).json({
                  success: false,
                  status: "manually_stopped",
                  message: "Container was manually stopped before completion",
                  error: "MANUALLY_STOPPED",
                  containerId,
                  timestamp: new Date().toISOString(),
                  note: "El container fue detenido manualmente y no completó la búsqueda",
                  containerInfo: {
                    exitCode: containerData.exitCode,
                    endType: containerData.endType,
                    status: containerData.status,
                    duration: containerData.endedAt - containerData.launchedAt
                  },
                  methodsAttempted: [
                    "fetch-result-object",
                    "direct_fetch",
                    "s3_fallback",
                    "output_analysis"
                  ],
                });
              }
            }

            // Si no se encuentra el mensaje específico y no fue detenido manualmente, devolver error 404 genérico
            return res.status(404).json({
              success: false,
              message: "No se pudieron recuperar resultados del agente expirado",
              error: "ALL_METHODS_FAILED",
              containerId,
              timestamp: new Date().toISOString(),
              note: "Se intentaron todos los métodos de recuperación disponibles",
              methodsAttempted: [
                "fetch-result-object",
                "direct_fetch",
                "s3_fallback",
                "output_analysis"
              ],
            });
      } catch (statusError) {
        console.log(`⚠️ Error verificando estado del agente: ${statusError.message}`);

        // Si no se puede verificar el estado, devolver error 404
        return res.status(404).json({
          success: false,
          message: "No se pudieron recuperar resultados del agente expirado",
          error: "ALL_METHODS_FAILED",
          containerId,
          timestamp: new Date().toISOString(),
          note: "Se intentaron todos los métodos de recuperación disponibles",
          methodsAttempted: [
            "fetch-result-object",
            "direct_fetch",
            "s3_fallback",
            "output_analysis"
          ],
        });
      }
    } catch (error) {
      console.error("❌ Error recuperando resultados:", error);

      res.status(500).json({
        success: false,
        message: "Error recuperando resultados del agente expirado",
        error: error.message,
        containerId: req.params.containerId,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// Endpoint específico para obtener resultados desde URL específica de S3
app.get(
  "/api/search/get-s3-results/:containerId",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { containerId } = req.params;

      console.log(`🌐 Obteniendo resultados desde S3 para: ${containerId}`);

      // Validación optimizada usando utilidad
      const validation = validateContainerId(containerId);
      if (!validation.isValid) {
        return res.status(400).json(validation.error);
      }

      // Intentar obtener resultados desde S3
      const s3Results = await phantombusterService.getResultsFromS3(
        containerId
      );

      if (s3Results.success) {
        const processedResults =
          phantombusterService.processPhantombusterResults(s3Results.results, {
            containerId,
          });

        return res.json({
          success: true,
          status: "recovered_with_fetch_result_object",
          progress: 100,
          totalResults: processedResults.length,
          results: processedResults,
          message: "Resultados recuperados exitosamente",
          containerId,
          timestamp: new Date().toISOString(),
          source: s3Results.source,
          s3Url: s3Results.data.s3Url,
        });
      } else {
        return res.status(404).json({
          success: false,
          message: "No se pudieron obtener resultados desde S3",
          error: "S3_RESULTS_NOT_AVAILABLE",
          containerId,
          timestamp: new Date().toISOString(),
          note: "Los resultados pueden estar disponibles manualmente en el dashboard de Phantombuster",
          s3Info: s3Results.data,
        });
      }
    } catch (error) {
      console.error("❌ Error obteniendo resultados desde S3:", error);

      res.status(500).json({
        success: false,
        message: "Error obteniendo resultados desde S3",
        error: error.message,
        containerId: req.params.containerId,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// Endpoint específico para obtener resultados desde URL específica de S3
app.post(
  "/api/search/get-s3-results-from-url",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { s3Url, containerId } = req.body;

      console.log(`🌐 Obteniendo resultados desde URL específica: ${s3Url}`);

      if (!s3Url) {
        return res.status(400).json({
          success: false,
          message: "URL de S3 es requerida",
          error: "MISSING_S3_URL",
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const response = await axios.get(s3Url, {
          timeout: 15000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (response.status === 200 && response.data) {
          console.log(`✅ Resultados obtenidos desde URL específica`);

          // Procesar los resultados
          const results = Array.isArray(response.data)
            ? response.data
            : response.data.results || response.data.data || [];

          const processedResults =
            phantombusterService.processPhantombusterResults(results, {
              containerId: containerId || "unknown",
            });

          return res.json({
            success: true,
            status: "recovered_with_fetch_result_object",
            progress: 100,
            totalResults: processedResults.length,
            results: processedResults,
            message: "Resultados recuperados exitosamente",
            containerId: containerId || "unknown",
            timestamp: new Date().toISOString(),
            source: "specific_s3_url",
            s3Url,
          });
        } else {
          return res.status(404).json({
            success: false,
            message: "No se encontraron datos en la URL proporcionada",
            error: "NO_DATA_IN_URL",
            s3Url,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (urlError) {
        console.error(`❌ Error accediendo a URL: ${s3Url}`, urlError.message);

        return res.status(404).json({
          success: false,
          message: "No se pudo acceder a la URL proporcionada",
          error: "URL_ACCESS_ERROR",
          s3Url,
          timestamp: new Date().toISOString(),
          note: "Verificar que la URL sea correcta y accesible",
        });
      }
    } catch (error) {
      console.error(
        "❌ Error obteniendo resultados desde URL específica:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Error obteniendo resultados desde URL específica",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ENDPOINT /api/search/simple-direct/status/:containerId ELIMINADO - FUNCIONALIDAD CONSOLIDADA EN /api/search/status/:containerId

// Endpoint específico para obtener resultados de agentes terminados
app.get(
  "/api/search/get-results/:containerId",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { containerId } = req.params;

      console.log(
        `📥 Obteniendo resultados del agente terminado: ${containerId}`
      );

      // Validación optimizada usando utilidad
      const validation = validateContainerId(containerId);
      if (!validation.isValid) {
        return res.status(400).json(validation.error);
      }

      // Intentar obtener resultados directamente
      try {
        const resultsResult = await phantombusterService.getAgentResults(
          containerId
        );

        if (resultsResult.success) {
          const processedResults =
            phantombusterService.processPhantombusterResults(
              resultsResult.results,
              { containerId }
            );

          return res.json({
            success: true,
            status: "completed",
            progress: 100,
            totalResults: processedResults.length,
            results: processedResults,
            message: "Resultados obtenidos exitosamente",
            containerId,
            timestamp: new Date().toISOString(),
            source: "direct_results",
          });
        } else {
          return res.status(404).json({
            success: false,
            message: "No se encontraron resultados para este agente",
            error: "NO_RESULTS_AVAILABLE",
            containerId,
            timestamp: new Date().toISOString(),
            note: "El agente puede estar terminado pero sin resultados disponibles",
          });
        }
      } catch (resultsError) {
        console.error(
          `❌ Error obteniendo resultados para ${containerId}:`,
          resultsError.message
        );

        return res.status(404).json({
          success: false,
          message: "Error obteniendo resultados del agente",
          error: "RESULTS_ERROR",
          containerId,
          timestamp: new Date().toISOString(),
          note: "Verificar que el agente haya completado su ejecución correctamente",
        });
      }
    } catch (error) {
      console.error("❌ Error obteniendo resultados:", error);

      res.status(500).json({
        success: false,
        message: "Error obteniendo resultados del agente",
        error: error.message,
        containerId: req.params.containerId,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ============================================================================
// ENDPOINTS DE VISITA DE PERFILES
// ============================================================================

app.post(
  "/api/profile-visitor/visit-single",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { profileUrl, connectionDegree = "3rd+" } = req.body;

      if (!profileUrl) {
        return res.status(400).json({
          success: false,
          message: "profileUrl es requerido",
          error: "MISSING_PARAMETERS",
        });
      }

      // Validar connectionDegree
      const validDegrees = ["1st", "2nd", "3rd+"];
      if (!validDegrees.includes(connectionDegree)) {
        return res.status(400).json({
          success: false,
          message: "connectionDegree debe ser: 1st, 2nd, o 3rd+",
          error: "INVALID_CONNECTION_DEGREE",
        });
      }

      console.log(`🔍 Iniciando Profile Visitor para: ${profileUrl}`);
      console.log(`📊 Grado de conexión: ${connectionDegree}`);

      const startTime = Date.now();

      // ============================================================================
      // VERIFICACIÓN DE LÍMITES DIARIOS
      // ============================================================================
      // Usar la instancia global del DatabaseService
      const dbService = req.app.locals.dbService;
      if (!dbService) {
        throw new Error('DatabaseService no está disponible');
      }

      const userId = req.query.userId || 'default';
      const date = new Date().toISOString().split('T')[0];
      const limits = await dbService.getCompleteDailyLimits(userId, date);

      // Verificar si se ha alcanzado el límite de visitas
      if (limits.visit_count >= limits.visit_limit) {
        return res.status(429).json({
          success: false,
          message: '❌ Límite diario de visitas alcanzado',
          error: 'DAILY_LIMIT_EXCEEDED',
          timestamp: new Date().toISOString(),
          data: {
            current: limits.visit_count,
            limit: limits.visit_limit,
            remaining: 0,
            resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            recommendations: [
              'Esperar hasta mañana para hacer más visitas',
              'Revisar la estrategia de targeting',
              'Optimizar el timing de las visitas'
            ]
          }
        });
      }

      // ============================================================================
      // LANZAR PROFILE VISITOR CON PHANTOMBUSTER
      // ============================================================================
      const profileVisitorConfig = {
        profileUrl: profileUrl,
        connectionDegree: connectionDegree
      };

      const launchResponse = await phantombusterService.launchProfileVisitor(
        [profileUrl], // Array con una sola URL
        {
          connectionDegree: connectionDegree,
          numberOfProfilesPerLaunch: 1
        }
      );

            if (!launchResponse.success) {
        // Usar el nuevo sistema de parsing de errores
        const errorInfo = phantombusterErrorParser.parsePhantombusterResponse(launchResponse);

        if (errorInfo.hasError) {
          // Guardar el error en la base de datos
          const containerId = `profile_visitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

        throw new Error(launchResponse.message || 'Error lanzando Profile Visitor');
      }

      const duration = Date.now() - startTime;

      // ============================================================================
      // INCREMENTAR CONTADOR DE VISITAS
      // ============================================================================
      await dbService.incrementVisitCount(userId, date);

      // Obtener límites actualizados
      const updatedLimits = await dbService.getCompleteDailyLimits(userId, date);

      // ============================================================================
      // REGISTRAR MÉTRICAS
      // ============================================================================
      metricsCollector.recordPhantombusterProfileVisit(
        true,
        duration
      );

      // ============================================================================
      // RESPONSE EXITOSO
      // ============================================================================
      res.json({
        success: true,
        executionId: `profile_visitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        containerId: launchResponse.containerId,
        status: "running",
        message: "LinkedIn Profile Visitor iniciado exitosamente",
        data: {
          inputMode: "single",
          profileUrl: profileUrl,
          connectionDegree: connectionDegree,
          profileCount: 1,
          estimatedDuration: "30-60 segundos",
          estimatedCompletionTime: new Date(Date.now() + 60000).toISOString(),
          configuration: {
            delayBetweenVisits: 3,
            respectLinkedInLimits: true,
            maxVisitsPerDay: 100
          },
          limits: {
            current: updatedLimits.visit_count,
            limit: updatedLimits.visit_limit,
            remaining: updatedLimits.visit_limit - updatedLimits.visit_count,
            usagePercentage: Math.round((updatedLimits.visit_count / updatedLimits.visit_limit) * 100)
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error("❌ Error visitando perfil:", error);
      metricsCollector.recordError(
        "PROFILE_VISIT_ERROR",
        "/api/profile-visitor/visit-single",
        error.message
      );

      res.status(500).json({
        success: false,
        message: "Error visitando perfil",
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Endpoint específico usando fetch-result-object de Phantombuster
app.get(
  "/api/search/fetch-result-object/:containerId",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { containerId } = req.params;

      console.log(
        `📥 Descargando contenedor usando fetch-result-object: ${containerId}`
      );

      // Validación optimizada usando utilidad
      const validation = validateContainerId(containerId);
      if (!validation.isValid) {
        return res.status(400).json(validation.error);
      }

      // Usar el nuevo método con fetch-result-object
      try {
        const resultsResult =
          await phantombusterService.getAgentResultsWithFetchResultObject(
            containerId
          );

        if (resultsResult.success) {
          const processedResults =
            phantombusterService.processPhantombusterResults(
              resultsResult.results,
              { containerId }
            );

          return res.json({
            success: true,
            status: "completed",
            progress: 100,
            totalResults: processedResults.length,
            results: processedResults,
            message:
              "Resultados descargados exitosamente usando fetch-result-object",
            containerId,
            timestamp: new Date().toISOString(),
            source: resultsResult.source,
            phantombusterEndpoint: "fetch-result-object",
          });
        } else {
          return res.status(404).json({
            success: false,
            message: "No se encontraron resultados para este contenedor",
            error: "NO_RESULTS_AVAILABLE",
            containerId,
            timestamp: new Date().toISOString(),
            note: "El contenedor puede estar terminado pero sin resultados disponibles",
            phantombusterEndpoint: "fetch-result-object",
          });
        }
      } catch (resultsError) {
        console.error(
          `❌ Error obteniendo resultados con fetch-result-object para ${containerId}:`,
          resultsError.message
        );

        return res.status(404).json({
          success: false,
          message: "Error obteniendo resultados del contenedor",
          error: "RESULTS_ERROR",
          containerId,
          timestamp: new Date().toISOString(),
          note: "Verificar que el contenedor haya completado su ejecución correctamente",
          phantombusterEndpoint: "fetch-result-object",
          errorDetails: resultsError.message,
        });
      }
    } catch (error) {
      console.error("❌ Error descargando contenedor:", error);

      res.status(500).json({
        success: false,
        message: "Error descargando contenedor",
        error: error.message,
        containerId: req.params.containerId,
        timestamp: new Date().toISOString(),
        phantombusterEndpoint: "fetch-result-object",
      });
    }
  }
);

// ============================================================================
// ENDPOINTS PARA DISTRIBUCIÓN SECUENCIAL
// ============================================================================

// Endpoint para obtener estado de secuencia
app.get(
  "/api/search/sequence-status/:sessionId",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      console.log(`📊 Obteniendo estado de secuencia: ${sessionId}`);

      const status = await sequentialDistributionManager.getSequenceStatus(
        sessionId
      );

      res.json({
        success: true,
        data: status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Error obteniendo estado de secuencia:", error);
      res.status(500).json({
        success: false,
        message: "Error obteniendo estado de secuencia",
        error: error.message,
        sessionId: req.params.sessionId,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// Endpoint para continuar secuencia manualmente
app.post(
  "/api/search/continue-sequence/:sessionId",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      console.log(`🔄 Continuando secuencia manualmente: ${sessionId}`);

      const executionResult =
        await sequentialDistributionManager.executeNextUrlInSequence(sessionId);

      if (executionResult.status === "launched") {
        // Obtener session_cookie_hash
        const cookieHash = await cookieManager.getSessionCookieHash();

        res.json({
          success: true,
          sessionId: executionResult.sessionId,
          containerId: executionResult.containerId,
          status: "running",
          session_cookie_hash: cookieHash.session_cookie_hash,
          message: "Secuencia continuada exitosamente",
          data: {
            urlId: executionResult.urlId,
            range: executionResult.range,
            allocatedLeads: executionResult.allocatedLeads,
            sequenceOrder: executionResult.sequenceOrder,
            remainingLeads: executionResult.remainingLeads,
          },
        });
      } else if (executionResult.status === "completed") {
        res.json({
          success: true,
          message: "Secuencia completada",
          data: executionResult,
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Error continuando secuencia",
          data: executionResult,
        });
      }
    } catch (error) {
      console.error("❌ Error continuando secuencia:", error);
      res.status(500).json({
        success: false,
        message: "Error continuando secuencia",
        error: error.message,
        sessionId: req.params.sessionId,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// Endpoint para actualizar estado de container manualmente
app.post(
  "/api/search/update-container-status",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { containerId, status } = req.body;

      if (!containerId || !status) {
        return res.status(400).json({
          success: false,
          message: "containerId y status son requeridos",
          timestamp: new Date().toISOString(),
        });
      }

      console.log(
        `🔄 Actualizando estado del container ${containerId} a ${status}`
      );

      // Actualizar estado en la base de datos
      await dbService.updateSequentialUrlStateStatusByContainer(
        containerId,
        status
      );

      res.json({
        success: true,
        message: `Estado del container ${containerId} actualizado a ${status}`,
        containerId,
        status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Error actualizando estado del container:", error);
      res.status(500).json({
        success: false,
        message: "Error actualizando estado del container",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ============================================================================
// RUTAS ESPECÍFICAS
// ============================================================================

// Rutas de LinkedIn Autoconnect
app.use("/api/autoconnect", autoconnectRoutes);
app.use("/api/message-sender", messageSenderRoutes);
app.use("/api/autoconnect-monitoring", autoconnectMonitoringRoutes(autoconnectResponseMonitor));
app.use("/api/limits", require("./routes/limits"));
app.use("/api/phantombuster", require("./routes/phantombuster-status"));
app.use("/api/known-errors", require("./routes/known-errors"));
app.use("/api/domain-scraper", domainScraperRoutes);
app.use("/api/axonaut", axonautRoutes);

// ============================================================================
// ENDPOINTS DE MONITOREO AUTOMÁTICO
// ============================================================================

// Endpoint para iniciar monitoreo automático
app.post("/api/monitoring/start", authenticateApiKey, async (req, res) => {
  try {
    await containerStatusMonitor.startMonitoring();

    res.json({
      success: true,
      message: "Monitoreo automático iniciado",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error iniciando monitoreo:", error);
    res.status(500).json({
      success: false,
      message: "Error iniciando monitoreo automático",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Endpoint para detener monitoreo automático
app.post("/api/monitoring/stop", authenticateApiKey, async (req, res) => {
  try {
    containerStatusMonitor.stopMonitoring();

    res.json({
      success: true,
      message: "Monitoreo automático detenido",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error deteniendo monitoreo:", error);
    res.status(500).json({
      success: false,
      message: "Error deteniendo monitoreo automático",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Endpoint para obtener estado del monitoreo
app.get("/api/monitoring/status", authenticateApiKey, async (req, res) => {
  try {
    const stats = await containerStatusMonitor.getMonitoringStats();

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error obteniendo estado del monitoreo:", error);
    res.status(500).json({
      success: false,
      message: "Error obteniendo estado del monitoreo",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Endpoint para verificar containers completados automáticamente
app.get(
  "/api/monitoring/completed-containers",
  authenticateApiKey,
  async (req, res) => {
    try {
      const completedContainers = await dbService.getCompletedContainersToday();

      res.json({
        success: true,
        data: {
          containers: completedContainers,
          count: completedContainers.length,
          date: new Date().toISOString().split("T")[0],
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Error obteniendo containers completados:", error);
      res.status(500).json({
        success: false,
        message: "Error obteniendo containers completados",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ============================================================================
// MANEJO DE ERRORES GLOBAL
// ============================================================================

app.use((error, req, res, next) => {
  console.error("❌ Error no manejado:", error);
  metricsCollector.recordError("UNHANDLED_ERROR", req.path, error.message);

  res.status(500).json({
    success: false,
    message: "Error interno del servidor",
    error:
      process.env.NODE_ENV === "development" ? error.message : "Error interno",
  });
});

// ============================================================================
// INICIO DEL SERVIDOR
// ============================================================================

app.listen(PORT, () => {
  console.log(`🚀 Servidor API Phantombuster iniciado en puerto ${PORT}`);
  console.log(`📊 Métricas disponibles en /api/metrics`);
  console.log(`🔍 Health check en /api/health`);
  console.log(`⚙️ Configuración en /api/config`);

  // Iniciar monitoreo de sesiones
  console.log(`🍪 Iniciando monitoreo de cookies LinkedIn...`);
  cookieManager.startMonitoring();
});

module.exports = app;
