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
const { mapSimpleParams } = require("./utils/parameterMapper");
const metricsCollector = require("./monitoring/metrics");
const SequentialDistributionManager = require("./services/SequentialDistributionManager");
const containerStatusMonitor = require("./services/ContainerStatusMonitor");
const axios = require("axios"); // Agregado axios para acceso a URLs de S3

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

// Registro de logs
app.use(morgan("combined"));

// Middleware de métricas
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
const sequentialDistributionManager = new SequentialDistributionManager(
  dbService,
  phantombusterService
);

// Inicializar servicios
(async () => {
  try {
    await dbService.initialize();
    console.log("✅ Persistencia de datos habilitada");
  } catch (error) {
    console.error("❌ Error inicializando persistencia:", error.message);
    console.log("⚠️ La API funcionará con almacenamiento en memoria");
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
      totalLeadsLimit = 2000,
      useSequentialDistribution = false,
    } = req.body;

    let searchType, searchData, launchResult;

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
          // Logs de debug removidos para producción

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

    // LÓGICA EXISTENTE PARA BÚSQUEDA SIMPLE
    // DETERMINAR TIPO DE BÚSQUEDA
    if (linkedInSearchUrl) {
      // BÚSQUEDA CON URL DIRECTA
      searchType = "direct_url";

      // Validar que sea una URL de LinkedIn (Regular o Sales Navigator)
      if (!linkedInSearchUrl.includes("linkedin.com")) {
        return res.status(400).json({
          success: false,
          message: "URL debe ser de LinkedIn",
          error: "INVALID_LINKEDIN_URL",
          providedUrl: linkedInSearchUrl,
        });
      }

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
        configuracionAutomatica: null,
        results: [],
      };

      // Guardar en base de datos
      await dbService.saveSearch(searchData);

      // Lanzar agente con URL directa y configuración automática
      const startTime = Date.now();
      launchResult = await phantombusterService.launchSearchAgentWithUrl(
        linkedInSearchUrl,
        numberOfResults,
        urlsWithPriorities.numberOfPage,
        urlsWithPriorities.startPage
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
        message: "Búsqueda iniciada correctamente con configuración automática",
        data: {
          searchParams: {
            linkedInSearchUrl,
            numberOfResultsPerLaunch: parseInt(numberOfResults),
            numberOfResultsPerSearch: parseInt(numberOfResults),
            // Configuración automática aplicada
            configuracionAutomatica: {
              numberOfPage: urlsWithPriorities.numberOfPage,
              userAgent: configuracionAutomatica.userAgent,
              csvName: configuracionAutomatica.csvName,
            },
          },
          mappedParams: {
            linkedInSearchUrl,
            numberOfResultsPerLaunch: parseInt(numberOfResultsPerLaunch),
            numberOfResultsPerSearch: parseInt(numberOfResultsPerSearch),
            connection_degree:
              configuracionAutomatica.connectionDegreesToScrape,
            results_per_launch: parseInt(numberOfResultsPerLaunch),
            total_results: parseInt(numberOfResultsPerSearch),
          },
          searchUrls: [linkedInSearchUrl],
          estimatedDuration: "5-10 minutos",
          estimatedDurationMinutes: 7,
        },
      });
    } else {
      // BÚSQUEDA CON PARÁMETROS SIMPLES (LÓGICA EXISTENTE)
      searchType = "simple_params";

      // Validar parámetros requeridos
      const {
        sectors,
        roles,
        countries,
        companySizes,
        options = {},
      } = req.body;

      if (!sectors || !roles || !countries) {
        return res.status(400).json({
          success: false,
          message:
            "Para búsqueda simple: sectors, roles y countries son requeridos",
          error: "MISSING_PARAMETERS",
        });
      }

      // CONFIGURACIÓN HARCODEADA AUTOMÁTICA
      const configuracionAutomatica = {
        // Configuración de círculos
        circles: {
          first: true,
          second: true,
          third: true,
        },

        // Configuración de categoría
        category: "People",

        // Configuración de páginas
        numberOfPage: 5,
        numberOfLinesPerLaunch: 100,

        // Configuración de resultados
        onlyGetFirstResult: false,
        connectionDegreesToScrape: ["1", "2", "3+"],

        // Configuración de optimización
        enrichLeadsWithAdditionalInformation: true,
        removeDuplicateProfiles: true,

        // Configuración de sesión (obtenida desde variable de entorno)
        sessionCookie:
          process.env.LINKEDIN_SESSION_COOKIE ||
          (await cookieManager.getSessionCookie()),
        userAgent:
          process.env.LINKEDIN_USER_AGENT ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",

        // Configuración de archivo
        csvName: `europbots_search_${Date.now()}`,

        // PARÁMETROS ESPECÍFICOS PARA PHANTOMBUSTER
        numberOfResultsPerLaunch: parseInt(numberOfResultsPerLaunch) || 125, // VALOR POR DEFECTO: 125
        numberOfResultsPerSearch: parseInt(numberOfResultsPerSearch) || 2000, // VALOR POR DEFECTO: 2000
        numberOfLinesPerLaunch: parseInt(numberOfLinesPerLaunch) || 100, // VALOR POR DEFECTO: 100
      };

      const searchParams = {
        sectors,
        roles,
        countries,
        companySizes,
        removeDuplicateProfiles:
          configuracionAutomatica.removeDuplicateProfiles,
        enrichLeadsWithAdditionalInformation:
          configuracionAutomatica.enrichLeadsWithAdditionalInformation,
      };
      const mappedParams = mapSimpleParams(searchParams);
      const searchUrls =
        phantombusterService.processSearchParameters(searchParams);

      const searchId = `search_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      // Crear búsqueda inicial para parámetros simples
      searchData = {
        searchId,
        containerId: null,
        status: "launching",
        progress: 0,
        createdAt: new Date().toISOString(),
        completedAt: null,
        searchParams,
        mappedParams,
        searchUrls,
        configuracionAutomatica,
        results: [],
      };

      // Guardar en base de datos
      await dbService.saveSearch(searchData);

      // Lanzar agente con parámetros simples y configuración automática
      const startTime = Date.now();
      launchResult = await phantombusterService.launchSearchAgent(searchUrls, {
        ...configuracionAutomatica,
        ...options,
      });
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
        message: "Búsqueda iniciada correctamente con configuración automática",
        data: {
          searchParams,
          mappedParams,
          searchUrls,
          configuracionAutomatica: {
            circles: configuracionAutomatica.circles,
            category: configuracionAutomatica.category,
            numberOfPage: configuracionAutomatica.numberOfPage,
            onlyGetFirstResult: configuracionAutomatica.onlyGetFirstResult,
            connectionDegreesToScrape:
              configuracionAutomatica.connectionDegreesToScrape,
            enrichLeadsWithAdditionalInformation:
              configuracionAutomatica.enrichLeadsWithAdditionalInformation,
            removeDuplicateProfiles:
              configuracionAutomatica.removeDuplicateProfiles,
            userAgent: configuracionAutomatica.userAgent,
            csvName: configuracionAutomatica.csvName,
          },
          estimatedDuration: "5-10 minutos",
          estimatedDurationMinutes: 7,
        },
      });
    }
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
app.get(
  "/api/search/status/:containerId",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { containerId } = req.params;

      // Verificación de estado del contenedor

      // Verificar si el containerId es válido
      if (!containerId || containerId.length < 10) {
        return res.status(400).json({
          success: false,
          message: "Container ID inválido",
          error: "INVALID_CONTAINER_ID",
          containerId,
          timestamp: new Date().toISOString(),
        });
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
      console.error("❌ Error obteniendo estado de búsqueda:", error);

      // Manejar errores específicos de Phantombuster
      let statusCode = 500;
      let errorMessage = "Error obteniendo estado de búsqueda";

      if (error.message && error.message.includes("Agent not found")) {
        statusCode = 404;
        errorMessage = "Agente no encontrado o expirado";
      } else if (error.message && error.message.includes("400")) {
        statusCode = 400;
        errorMessage = "Solicitud inválida al agente";
      } else if (error.message && error.message.includes("401")) {
        statusCode = 401;
        errorMessage = "No autorizado para acceder al agente";
      } else if (error.message && error.message.includes("403")) {
        statusCode = 403;
        errorMessage = "Acceso prohibido al agente";
      }

      metricsCollector.recordError(
        "STATUS_ERROR",
        "/api/search/status",
        error.message
      );

      res.status(statusCode).json({
        success: false,
        message: errorMessage,
        error: error.message,
        containerId: req.params.containerId,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

app.get(
  "/api/search/simple-direct/status/:containerId",
  authenticateApiKey,
  async (req, res) => {
    try {
      const { containerId } = req.params;

      // Verificación de estado del contenedor

      const statusResult = await phantombusterService.getAgentStatus(
        containerId,
        "search"
      );

      if (statusResult.data.status === "finished") {
        const resultsResult = await phantombusterService.getAgentResults(
          containerId
        );

        if (resultsResult.success) {
          const processedResults =
            phantombusterService.processPhantombusterResults(
              resultsResult.results,
              { containerId }
            );

          res.json({
            success: true,
            status: "completed",
            progress: 100,
            totalResults: processedResults.length,
            results: processedResults,
            message: "Búsqueda completada",
          });
        } else {
          res.json({
            success: true,
            status: "processing",
            progress: 50,
            message: "Procesando resultados...",
          });
        }
      } else {
        res.json({
          success: true,
          status: statusResult.data.status,
          progress: statusResult.data.progress || 0,
          message: statusResult.data.message || "Búsqueda en progreso",
        });
      }
    } catch (error) {
      console.error("❌ Error obteniendo estado de búsqueda:", error);

      // Manejar errores específicos de Phantombuster
      let statusCode = 500;
      let errorMessage = "Error obteniendo estado de búsqueda";

      if (error.message && error.message.includes("Agent not found")) {
        statusCode = 404;
        errorMessage = "Agente no encontrado o expirado";
      } else if (error.message && error.message.includes("400")) {
        statusCode = 400;
        errorMessage = "Solicitud inválida al agente";
      } else if (error.message && error.message.includes("401")) {
        statusCode = 401;
        errorMessage = "No autorizado para acceder al agente";
      } else if (error.message && error.message.includes("403")) {
        statusCode = 403;
        errorMessage = "Acceso prohibido al agente";
      }

      metricsCollector.recordError(
        "STATUS_ERROR",
        "/api/search/simple-direct/status",
        error.message
      );

      res.status(statusCode).json({
        success: false,
        message: errorMessage,
        error: error.message,
        containerId: req.params.containerId,
        timestamp: new Date().toISOString(),
      });
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

      // Verificar si el containerId es válido
      if (!containerId || containerId.length < 10) {
        return res.status(400).json({
          success: false,
          message: "Container ID inválido",
          error: "INVALID_CONTAINER_ID",
          containerId,
          timestamp: new Date().toISOString(),
        });
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
            status: "recovered_with_sequential_range",
            progress: 100,
            totalResults: results.results.length,
            results: results.results,
            message: "Resultados de secuencia recuperados exitosamente",
            containerId,
            sessionId,
            urlId,
            metadata: results.metadata,
            timestamp: new Date().toISOString(),
            source: "sequential_distribution",
            method: "range_specific_download",
            note: "Recuperación exitosa con rango específico de secuencia",
          });
        } catch (sequenceError) {
          console.error(
            "❌ Error recuperando resultados de secuencia:",
            sequenceError
          );
          return res.status(500).json({
            success: false,
            message: "Error recuperando resultados de secuencia",
            error: sequenceError.message,
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
            status: "recovered_with_direct_method",
            progress: 100,
            totalResults: processedResults.length,
            results: processedResults,
            message:
              "Resultados recuperados exitosamente usando método directo",
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
            status: "recovered_from_s3",
            progress: 100,
            totalResults: processedResults.length,
            results: processedResults,
            message: "Resultados recuperados exitosamente desde S3",
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

      // Si todos los métodos fallan
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
        ],
      });
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

      // Verificar si el containerId es válido
      if (!containerId || containerId.length < 10) {
        return res.status(400).json({
          success: false,
          message: "Container ID inválido",
          error: "INVALID_CONTAINER_ID",
          containerId,
          timestamp: new Date().toISOString(),
        });
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
          status: "recovered_from_s3",
          progress: 100,
          totalResults: processedResults.length,
          results: processedResults,
          message: "Resultados recuperados desde S3 exitosamente",
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
            status: "recovered_from_specific_url",
            progress: 100,
            totalResults: processedResults.length,
            results: processedResults,
            message: "Resultados recuperados desde URL específica exitosamente",
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

      // Verificar si el containerId es válido
      if (!containerId || containerId.length < 10) {
        return res.status(400).json({
          success: false,
          message: "Container ID inválido",
          error: "INVALID_CONTAINER_ID",
          containerId,
          timestamp: new Date().toISOString(),
        });
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
      const { profileUrl, options = {} } = req.body;

      if (!profileUrl) {
        return res.status(400).json({
          success: false,
          message: "profileUrl es requerido",
          error: "MISSING_PARAMETERS",
        });
      }

      const startTime = Date.now();
      const result = await profileVisitorService.visitSingleProfile(
        profileUrl,
        options
      );
      const duration = Date.now() - startTime;

      metricsCollector.recordPhantombusterProfileVisit(
        result.success,
        duration
      );

      res.json({
        success: true,
        visitId: result.visitId,
        profileUrl: result.profileUrl,
        result: result.result,
        message: result.message,
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

      // Verificar si el containerId es válido
      if (!containerId || containerId.length < 10) {
        return res.status(400).json({
          success: false,
          message: "Container ID inválido",
          error: "INVALID_CONTAINER_ID",
          containerId,
          timestamp: new Date().toISOString(),
        });
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
});

module.exports = app;
