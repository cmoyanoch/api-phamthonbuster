const axios = require("axios");
const LinkedInCookieManager = require("../cookie-manager");
const fs = require("fs");
const path = require("path");

// Circuit Breaker para manejar fallos de conectividad
class CircuitBreaker {
  constructor(failureThreshold = 5, resetTimeout = 60000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN - Phantombuster service temporarily unavailable');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      isHealthy: this.state === 'CLOSED'
    };
  }
}

// Monitor de conectividad
class ConnectivityMonitor {
  constructor() {
    this.lastCheck = null;
    this.isHealthy = true;
    this.checkInterval = 300000; // 5 minutos
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutCount: 0,
      averageResponseTime: 0,
      lastError: null,
      lastSuccess: null
    };
  }

  async checkPhantombusterHealth() {
    try {
      const startTime = Date.now();
      // Usar un endpoint que sí existe en la API v2
      const response = await axios.get(`${this.baseUrl}/agents/fetch`, {
        timeout: 10000,
        headers: {
          'X-Phantombuster-Key': this.apiKey
        },
        params: {
          id: this.searchAgentId
        }
      });

      const responseTime = Date.now() - startTime;
      this.isHealthy = response.status === 200;
      this.lastCheck = Date.now();
      this.metrics.lastSuccess = Date.now();
      this.metrics.averageResponseTime = responseTime;

      return this.isHealthy;
    } catch (error) {
      this.isHealthy = false;
      this.lastCheck = Date.now();
      this.metrics.lastError = {
        timestamp: Date.now(),
        message: error.message,
        code: error.code
      };

      console.error('❌ Phantombuster health check failed:', error.message);
      return false;
    }
  }

  shouldRetry() {
    if (!this.lastCheck) return true;
    if (Date.now() - this.lastCheck > this.checkInterval) return true;
    return this.isHealthy;
  }

  updateMetrics(success, responseTime, error = null) {
    this.metrics.totalRequests++;
    if (success) {
      this.metrics.successfulRequests++;
      this.metrics.lastSuccess = Date.now();
    } else {
      this.metrics.failedRequests++;
      this.metrics.lastError = {
        timestamp: Date.now(),
        message: error?.message || 'Unknown error',
        code: error?.code
      };
      if (error?.code === 'ETIMEDOUT' || error?.message?.includes('timeout')) {
        this.metrics.timeoutCount++;
      }
    }

    // Actualizar tiempo de respuesta promedio
    if (responseTime) {
      this.metrics.averageResponseTime =
        (this.metrics.averageResponseTime + responseTime) / 2;
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      errorRate: this.metrics.totalRequests > 0 ?
        this.metrics.failedRequests / this.metrics.totalRequests : 0,
      timeoutRate: this.metrics.totalRequests > 0 ?
        this.metrics.timeoutCount / this.metrics.totalRequests : 0,
      isHealthy: this.isHealthy,
      lastCheck: this.lastCheck
    };
  }
}

class PhantombusterService {
  constructor() {
    this.apiKey = process.env.PHANTOMBUSTER_API_KEY;
    this.searchAgentId = process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID;
    this.profileVisitorAgentId =
      process.env.PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID;
    this.baseUrl = "https://api.phantombuster.com/api/v2";
    this.cookieManager = new LinkedInCookieManager();

    // Configurar directorio de logs
    this.logsDir = path.join(__dirname, "../logs");
    this.ensureLogsDirectory();

    // Inicializar circuit breaker y monitor de conectividad
    this.circuitBreaker = new CircuitBreaker(
      parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD) || 5,
      parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT) || 60000
    );
    this.connectivityMonitor = new ConnectivityMonitor();

    // Configuración mejorada de axios
    this.axiosConfig = {
      timeout: parseInt(process.env.HTTP_TIMEOUT) || 300000, // 5 minutos por defecto
      retry: parseInt(process.env.MAX_RETRIES) || 3,
      retryDelay: parseInt(process.env.RETRY_DELAY) || 1000,
      headers: {
        'X-Phantombuster-Key': this.apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'EUROPBOTS-API/2.0.0'
      }
    };

    // Configurar axios con interceptores para retry
    this.setupAxiosInterceptors();
  }

  setupAxiosInterceptors() {
    // Interceptor para requests
    axios.interceptors.request.use(
      (config) => {
        // Agregar timeout personalizado si no está configurado
        if (!config.timeout) {
          config.timeout = this.axiosConfig.timeout;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Interceptor para responses con retry automático
    axios.interceptors.response.use(
      (response) => {
        return response;
      },
      async (error) => {
        const { config } = error;

        // Solo reintentar en ciertos tipos de errores
        if (this.shouldRetry(error) && config && !config._retry) {
          config._retry = true;

          // Esperar antes del retry
          await new Promise(resolve => setTimeout(resolve, this.axiosConfig.retryDelay));

          console.log(`🔄 Reintentando request a ${config.url} (${config._retryCount || 1}/${this.axiosConfig.retry})`);

          return axios(config);
        }

        return Promise.reject(error);
      }
    );
  }

  shouldRetry(error) {
    // Reintentar en timeouts y errores de red
    return (
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      (error.response && error.response.status >= 500)
    );
  }

  classifyError(error) {
    if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      return 'TIMEOUT';
    }
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return 'NETWORK';
    }
    if (error.response?.status === 429) {
      return 'RATE_LIMIT';
    }
    if (error.response?.status >= 500) {
      return 'SERVER_ERROR';
    }
    return 'GENERIC';
  }

  ensureLogsDirectory() {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
    } catch (error) {
      console.warn(`⚠️ No se pudo crear directorio de logs: ${error.message}`);
      // Usar directorio temporal como fallback
      this.logsDir = '/tmp/europbots-logs';
      try {
        if (!fs.existsSync(this.logsDir)) {
          fs.mkdirSync(this.logsDir, { recursive: true });
        }
      } catch (fallbackError) {
        console.warn(`⚠️ No se pudo crear directorio de logs temporal: ${fallbackError.message}`);
      }
    }
  }

  async logExecution(operation, data) {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        operation,
        ...data,
      };

      // Log detallado para launchSearchAgentWithUrl
      if (operation === "launchSearchAgentWithUrl") {
        const logFileName = `launch-search-${
          new Date().toISOString().split("T")[0]
        }.json`;
        const logFilePath = path.join(this.logsDir, logFileName);

        let logs = [];
        if (fs.existsSync(logFilePath)) {
          try {
            const existingLogs = fs.readFileSync(logFilePath, "utf8");
            logs = JSON.parse(existingLogs);
          } catch (parseError) {
            console.warn(
              "⚠️ Error parseando logs existentes, creando nuevo archivo"
            );
            logs = [];
          }
        }

        logs.push(logEntry);
        fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));

        // También crear un log de resumen
        await this.updateSummaryLog(logEntry);
      }

      // Log en consola
      console.log(
        `📝 [${timestamp}] ${operation}:`,
        JSON.stringify(logEntry, null, 2)
      );
    } catch (error) {
      console.error("❌ Error escribiendo log:", error.message);
    }
  }

  async updateSummaryLog(logEntry) {
    try {
      const summaryFileName = "launch-search-summary.json";
      const summaryFilePath = path.join(this.logsDir, summaryFileName);

      let summary = {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        lastExecution: null,
        executions: [],
      };

      if (fs.existsSync(summaryFilePath)) {
        try {
          const existingSummary = fs.readFileSync(summaryFilePath, "utf8");
          summary = JSON.parse(existingSummary);
        } catch (parseError) {
          console.warn("⚠️ Error parseando resumen existente, creando nuevo");
        }
      }

      // Actualizar estadísticas
      summary.totalExecutions++;
      if (logEntry.success) {
        summary.successfulExecutions++;
      } else {
        summary.failedExecutions++;
      }
      summary.lastExecution = logEntry.timestamp;

      // Agregar ejecución al historial (mantener solo las últimas 100)
      summary.executions.unshift({
        timestamp: logEntry.timestamp,
        success: logEntry.success,
        containerId: logEntry.containerId,
        url: logEntry.searchUrl,
        parameters: logEntry.parameters,
      });

      if (summary.executions.length > 100) {
        summary.executions = summary.executions.slice(0, 100);
      }

      fs.writeFileSync(summaryFilePath, JSON.stringify(summary, null, 2));
    } catch (error) {
      console.error("❌ Error actualizando resumen:", error.message);
    }
  }

    async validateCookiesBeforeLaunch(agentType = "search") {
    try {
      console.log(
        `🔍 Validando cookies antes de lanzar agente ${agentType}...`
      );
      const cookieValidation = await this.cookieManager.validateAndRenew();

      if (!cookieValidation.success) {
        throw new Error(`Cookie inválida: ${cookieValidation.message}`);
      }

      if (cookieValidation.status === "renewed") {
        console.log("🔄 Cookie renovada automáticamente antes del lanzamiento");
      } else {
        console.log("✅ Cookie válida confirmada");
      }

      return {
        success: true,
        status: cookieValidation.status,
        message: "Cookies validadas correctamente",
      };
    } catch (cookieError) {
      console.error("❌ Error validando cookies:", cookieError.message);
      throw new Error(
        `No se puede lanzar agente ${agentType}: ${cookieError.message}`
      );
    }
  }

  async launchSearchAgentWithUrl(
    linkedInSearchUrl,
    numberOfResults,
    numberOfPage,
    startPage
  ) {
    console.log(`📋 Parámetros recibidos en launchSearchAgentWithUrl:`, {
      linkedInSearchUrl,
      numberOfResults,
      numberOfPage,
      startPage,
      numberOfPageType: typeof numberOfPage,
      startPageType: typeof startPage
    });

    const executionId = `exec_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 6)}`;
    const startTime = Date.now();

    try {
      // Log de inicio de ejecución
      await this.logExecution("launchSearchAgentWithUrl", {
        executionId,
        phase: "start",
        searchUrl: linkedInSearchUrl,
        parameters: {
          numberOfResults: parseInt(numberOfResults),
          numberOfPage: parseInt(numberOfPage),
          startPage: parseInt(startPage),
        },
        timestamp: new Date().toISOString(),
      });

      if (!this.apiKey || !this.searchAgentId) {
        const error =
          "API Key y Search Agent ID de Phantombuster son requeridos";
        await this.logExecution("launchSearchAgentWithUrl", {
          executionId,
          phase: "error",
          error,
          success: false,
          duration: Date.now() - startTime,
        });
        throw new Error(error);
      }

      // Log de validación de cookies
      await this.logExecution("launchSearchAgentWithUrl", {
        executionId,
        phase: "cookie_validation",
        message: "Iniciando validación de cookies",
      });

      // TEMPORAL: Comentar validación de cookies para pruebas
      console.log("⚠️ Validación de cookies omitida temporalmente para pruebas");
      // await this.validateCookiesBeforeLaunch("search");

      await this.logExecution("launchSearchAgentWithUrl", {
        executionId,
        phase: "cookie_validated",
        message: "Cookies validadas exitosamente (omitidas temporalmente)",
      });

      console.log("🚀 Lanzando LinkedIn Search Export con URL directa...");
      console.log("📋 URL de búsqueda:", linkedInSearchUrl);

      // USAR PARÁMETROS EXACTOS SIN CORRECCIÓN
      let finalNumberOfPage = parseInt(numberOfPage);
      let finalStartPage = parseInt(startPage);
      let finalNumberOfResults = parseInt(numberOfResults);

      // Solo validar valores mínimos, no corregir lógica de negocio
      if (finalNumberOfPage < 1) {
        console.log(`⚠️ numberOfPage (${finalNumberOfPage}) es muy bajo, pero manteniendo valor original`);
      }

      if (finalStartPage < 1) {
        console.log(`⚠️ startPage (${finalStartPage}) es muy bajo, pero manteniendo valor original`);
      }

      if (finalNumberOfResults < 1) {
        console.log(`⚠️ numberOfResults (${finalNumberOfResults}) es muy bajo, pero manteniendo valor original`);
      }

      console.log(`✅ Usando parámetros exactos: numberOfPage=${finalNumberOfPage}, startPage=${finalStartPage}, numberOfResults=${finalNumberOfResults}`);

      const agentArguments = {
        search: linkedInSearchUrl,
        numberOfPage: finalNumberOfPage,
        startPage: finalStartPage,
        numberOfResultsPerLaunch: finalNumberOfResults,
        sessionCookie: process.env.LINKEDIN_SESSION_COOKIE,
      };

      // Log completo de TODOS los agentArguments construidos
      await this.logExecution("launchSearchAgentWithUrl", {
        executionId,
        phase: "agent_arguments_complete",
        // TODOS los argumentos que se envían a Phantombuster
        completeAgentArguments: agentArguments,
        // Body completo que se enviará a Phantombuster
        fullRequestBody: {
          id: this.searchAgentId,
          argument: agentArguments,
        },
        // Headers que se enviarán (API key oculta por seguridad)
        requestHeaders: {
          "X-Phantombuster-Key": this.apiKey ? "***HIDDEN***" : "NOT_SET",
          "Content-Type": "application/json",
        },
        // URL completa de la API
        apiUrl: `${this.baseUrl}/agents/launch`,
        // Parámetros originales recibidos
        originalParameters: {
          numberOfResults: parseInt(numberOfResults),
          numberOfPage: parseInt(numberOfPage),
          startPage: parseInt(startPage),
        },
      });

      if (!agentArguments.sessionCookie) {
        throw new Error(
          "LINKEDIN_SESSION_COOKIE es requerido para usar el agente"
        );
      }

      console.log(
        "⚙️ Argumentos del agente:",
        JSON.stringify(agentArguments, null, 2)
      );

      // Usar circuit breaker para la llamada a Phantombuster
      console.log("🔧 Iniciando llamada HTTP a Phantombuster...");
      console.log("📡 URL:", `${this.baseUrl}/agents/launch`);
      console.log("🆔 Agent ID:", this.searchAgentId);

      const response = await this.circuitBreaker.execute(async () => {
        const requestStartTime = Date.now();
        console.log("⏱️ Iniciando request HTTP...");

        try {
          console.log("📤 Enviando petición POST...");
          const response = await axios.post(
            `${this.baseUrl}/agents/launch`,
            {
              id: this.searchAgentId,
              argument: agentArguments,
            },
            {
              headers: {
                "X-Phantombuster-Key": this.apiKey,
                "Content-Type": "application/json",
              },
              timeout: 120000, // 2 minutos para Phantombuster
            }
          );

          const responseTime = Date.now() - requestStartTime;
          console.log("✅ Respuesta recibida en", responseTime, "ms");
          this.connectivityMonitor.updateMetrics(true, responseTime);

          return response;
        } catch (error) {
          const responseTime = Date.now() - requestStartTime;
          console.error("❌ Error en llamada HTTP:", error.message);
          console.error("⏱️ Tiempo transcurrido:", responseTime, "ms");
          this.connectivityMonitor.updateMetrics(false, responseTime, error);

          // Clasificar y manejar el error específicamente
          const errorType = this.classifyError(error);
          console.error(`❌ Error de tipo ${errorType}:`, error.message);

          throw error;
        }
      });

      // Log de respuesta recibida
      await this.logExecution("launchSearchAgentWithUrl", {
        executionId,
        phase: "api_response_received",
        responseStatus: response.status,
        responseData: response.data,
      });

      if (response.status === 200 || response.status === 201) {
        console.log("✅ Agente lanzado exitosamente");
        console.log("📊 Response status:", response.status);
        console.log(
          "📋 Response data:",
          JSON.stringify(response.data, null, 2)
        );

        // USAR EL CONTAINER_ID REAL DE PHANTOMBUSTER
        const containerId = response.data.containerId;

        if (!containerId) {
          const error = "Phantombuster no devolvió un containerId válido";
          await this.logExecution("launchSearchAgentWithUrl", {
            executionId,
            phase: "error",
            error,
            success: false,
            duration: Date.now() - startTime,
          });
          throw new Error(error);
        }

        console.log("🆔 Container ID real de Phantombuster:", containerId);

        // Log de éxito
        await this.logExecution("launchSearchAgentWithUrl", {
          executionId,
          phase: "success",
          success: true,
          containerId: containerId,
          searchUrl: linkedInSearchUrl,
          parameters: {
            numberOfResults: parseInt(numberOfResults),
            numberOfPage: parseInt(numberOfPage),
            startPage: parseInt(startPage),
          },
          duration: Date.now() - startTime,
          phantombusterResponse: response.data,
        });

        return {
          success: true,
          containerId: containerId,
          message: "Agente lanzado correctamente",
          phantombusterResponse: response.data,
        };
      } else {
        const error = `Error lanzando agente: ${response.status} - ${response.statusText}`;
        await this.logExecution("launchSearchAgentWithUrl", {
          executionId,
          phase: "error",
          error,
          success: false,
          responseStatus: response.status,
          responseData: response.data,
          duration: Date.now() - startTime,
        });
        throw new Error(error);
      }
    } catch (error) {
      // Log de error general
      await this.logExecution("launchSearchAgentWithUrl", {
        executionId,
        phase: "error",
        error: error.message,
        errorStack: error.stack,
        success: false,
        duration: Date.now() - startTime,
      });

      console.error("❌ Error lanzando agente con URL directa:", error);
      throw error;
    }
  }

  async launchSearchAgent(searchUrls, options = {}) {
    try {
      if (!this.apiKey || !this.searchAgentId) {
        throw new Error(
          "API Key y Search Agent ID de Phantombuster son requeridos"
        );
      }

      await this.validateCookiesBeforeLaunch("search");

      console.log("🚀 Lanzando LinkedIn Search Export...");
      console.log("📋 URLs de búsqueda:", searchUrls);

      const agentArguments = {
        searchType: "linkedInSearchUrl",
        linkedInSearchUrl: searchUrls[0],
        ...(searchUrls.length > 1 && {
          searchType: "spreadsheetUrl",
          search: this.createSpreadsheetFromUrls(searchUrls),
        }),
        circles: { first: true, second: true, third: true },
        category: "People",
        numberOfPage: 5,
        numberOfLinesPerLaunch: 100,
        csvName: `europbots_search_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 6)}`,
        onlyGetFirstResult: false,
        numberOfResultsPerLaunch: options.numberOfResultsPerLaunch || 100,
        numberOfResultsPerSearch: options.numberOfResultsPerSearch || 500,
        connectionDegreesToScrape: ["1", "2", "3+"],
        enrichLeadsWithAdditionalInformation:
          options.enrichLeadsWithAdditionalInformation !== undefined
            ? options.enrichLeadsWithAdditionalInformation
            : true,
        removeDuplicateProfiles:
          options.removeDuplicateProfiles !== undefined
            ? options.removeDuplicateProfiles
            : true,
        // PARÁMETROS DE DEDUPLICACIÓN Y DIFERENCIACIÓN
        deduplicationSettings: {
          enabled: true,
          checkAgainstPreviousLaunches: true,
          removeExactMatches: true,
          removeSimilarProfiles: true,
          similarityThreshold: 0.8,
        },
        // PARÁMETROS DE DIFERENCIACIÓN ENTRE BÚSQUEDAS
        searchDifferentiation: {
          uniqueSearchId: `search_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`,
          searchTimestamp: new Date().toISOString(),
          searchMetadata: {
            source: "europbots_api",
            version: "2.0.0",
            searchType: "linkedin_search_export",
            configuration: "automatic",
          },
        },
        // PARÁMETROS DE RATE LIMITING Y SEGURIDAD
        rateLimiting: {
          delayBetweenSearches: 30,
          delayBetweenPages: 5,
          maxSearchesPerDay: 50,
          respectLinkedInLimits: true,
        },
        sessionCookie: process.env.LINKEDIN_SESSION_COOKIE,
        userAgent:
          process.env.LINKEDIN_USER_AGENT ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      };

      if (!agentArguments.sessionCookie) {
        throw new Error(
          "LINKEDIN_SESSION_COOKIE es requerido para usar el agente"
        );
      }

      console.log(
        "⚙️ Argumentos del agente:",
        JSON.stringify(agentArguments, null, 2)
      );

      const response = await axios.post(
        `${this.baseUrl}/agents/launch`,
        {
          id: this.searchAgentId,
          argument: agentArguments,
        },
        {
          headers: {
            "X-Phantombuster-Key": this.apiKey,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.status === 200 || response.status === 201) {
        console.log("✅ Agente lanzado exitosamente");
        console.log("📊 Response status:", response.status);
        console.log(
          "📋 Response data:",
          JSON.stringify(response.data, null, 2)
        );

        // USAR EL CONTAINER_ID REAL DE PHANTOMBUSTER
        const containerId = response.data.containerId;

        if (!containerId) {
          throw new Error("Phantombuster no devolvió un containerId válido");
        }

        console.log("🆔 Container ID real de Phantombuster:", containerId);

        return {
          success: true,
          containerId: containerId,
          message: "Agente de búsqueda lanzado correctamente",
          phantombusterResponse: response.data,
        };
      } else {
        throw new Error(
          `Error de Phantombuster API: ${response.status} - ${JSON.stringify(
            response.data
          )}`
        );
      }
    } catch (error) {
      console.error("❌ Error lanzando LinkedIn Search Export:", error);
      throw error;
    }
  }

  async launchProfileVisitor(profileUrls, options = {}) {
    try {
      if (!this.apiKey || !this.profileVisitorAgentId) {
        throw new Error(
          "API Key y Profile Visitor Agent ID de Phantombuster son requeridos"
        );
      }

      await this.validateCookiesBeforeLaunch("profile_visitor");

      const containerId = `container_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      console.log("🚀 Lanzando Profile Visitor...");
      console.log("📋 URLs de perfiles:", profileUrls);

      const agentArguments = {
        sessionCookie: process.env.LINKEDIN_SESSION_COOKIE,
        userAgent:
          process.env.LINKEDIN_USER_AGENT ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        profileUrls: profileUrls,
        numberOfProfilesPerLaunch: options.numberOfProfilesPerLaunch || 10,
        delayBetweenVisits: options.delayBetweenVisits || 30,
        visitDuration: options.visitDuration || 60,
        // Nombre único del CSV
        csvName: `europbots_visits_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      if (!agentArguments.sessionCookie) {
        throw new Error(
          "LINKEDIN_SESSION_COOKIE es requerido para usar el agente"
        );
      }

      const response = await axios.post(
        `${this.baseUrl}/agents/launch`,
        {
          id: this.profileVisitorAgentId,
          argument: agentArguments,
        },
        {
          headers: {
            "X-Phantombuster-Key": this.apiKey,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.status !== 200) {
        throw new Error(
          `Error de Phantombuster API: ${response.status} - ${JSON.stringify(
            response.data
          )}`
        );
      }

      console.log("✅ Profile Visitor lanzado exitosamente");
      return {
        success: true,
        containerId: response.data.containerId || containerId,
        message: "Profile Visitor lanzado correctamente",
        data: response.data,
      };
    } catch (error) {
      console.error("❌ Error lanzando Profile Visitor:", error);

      // Manejar errores específicos de Phantombuster
      if (error.response) {
        const { status, data } = error.response;

        if (status === 402) {
          return {
            success: false,
            error: `Request failed with status code 402`,
            message: "No monthly execution time remaining",
            data: data
          };
        } else {
          return {
            success: false,
            error: `Request failed with status code ${status}`,
            message: data?.error || "Error de Phantombuster API",
            data: data
          };
        }
      } else if (error.request) {
        return {
          success: false,
          error: "No response from Phantombuster API",
          message: "Error de conectividad con Phantombuster"
        };
      } else {
        return {
          success: false,
          error: error.message,
          message: "Error interno del servicio"
        };
      }
    }
  }

  createSpreadsheetFromUrls(urls) {
    const csvContent = urls.map((url) => `"${url}"`).join("\n");
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`;
  }

  async getAgentStatus(containerId, agentType = "search") {
    try {
      console.log(
        `🔍 Consultando estado del agente ${containerId} (${agentType})`
      );

      // Usar el endpoint correcto de la API v2 de Phantombuster
      const response = await axios.get(`${this.baseUrl}/containers/fetch`, {
        headers: {
          "X-Phantombuster-Key": this.apiKey,
        },
        params: {
          id: containerId,
        },
      });

      // También intentar obtener información adicional del container
      let containerOutput = null;
      try {
        const outputResponse = await axios.get(`${this.baseUrl}/containers/fetch-output`, {
          headers: {
            "X-Phantombuster-Key": this.apiKey,
          },
          params: {
            id: containerId,
          },
        });
        containerOutput = outputResponse.data;
      } catch (outputError) {
        console.log(`⚠️ No se pudo obtener output del container ${containerId}:`, outputError.message);
      }

      console.log(
        `✅ Estado del agente ${containerId}: ${response.data.status}`
      );

      return {
        success: true,
        status: response.data.status,
        progress: response.data.progress || 0,
        message: response.data.message,
        output: response.data.output, // Agregar el campo output
        containerOutput: containerOutput, // Agregar el output del container
        data: response.data,
      };
    } catch (error) {
      console.error(
        `❌ Error obteniendo estado del agente ${containerId}:`,
        error.message
      );

      // Manejar errores específicos de Phantombuster
      if (error.response) {
        const { status, data } = error.response;

        if (status === 400 && data && data.error === "Agent not found") {
          throw new Error("Agent not found");
        } else if (status === 401) {
          throw new Error("Unauthorized access to agent");
        } else if (status === 403) {
          throw new Error("Forbidden access to agent");
        } else if (status === 404) {
          throw new Error("Agent not found");
        } else {
          throw new Error(
            `Phantombuster API error: ${status} - ${JSON.stringify(data)}`
          );
        }
      } else if (error.request) {
        throw new Error("No response from Phantombuster API");
      } else {
        throw new Error(`Error: ${error.message}`);
      }
    }
  }

  processSearchParameters(searchParams) {
    const { sectors = [], roles = [], countries = [], companySizes = [] } = searchParams;

    const sectorMapping = {
      tech: "technology",
      finance: "financial-services",
      health: "hospital-health-care",
      education: "education-management",
      retail: "retail",
    };

    const roleMapping = {
      ceo: "Chief Executive Officer",
      cto: "Chief Technology Officer",
      operations: "Operations Manager",
      sales: "Sales Manager",
      manager: "Manager",
    };

    const countryMapping = {
      fr: "France",
      de: "Germany",
      es: "Spain",
      it: "Italy",
      nl: "Netherlands",
    };

    // Manejar arrays vacíos o valores undefined
    const sectorList = sectors && sectors.length > 0
      ? (Array.isArray(sectors) ? sectors : sectors.split(",").map((s) => s.trim()))
      : [];
    const roleList = roles && roles.length > 0
      ? (Array.isArray(roles) ? roles : roles.split(",").map((r) => r.trim()))
      : [];
    const countryList = countries && countries.length > 0
      ? (Array.isArray(countries) ? countries : countries.split(",").map((c) => c.trim()))
      : [];

    const jobTitles = roleList.length > 0
      ? roleList.map((role) => roleMapping[role] || role).join(" OR ")
      : "CEO OR Founder OR Director"; // Valor por defecto si no hay roles
    const locations = countryList.length > 0
      ? countryList.map((country) => countryMapping[country] || country).join(" OR ")
      : "France OR Germany OR Spain"; // Valor por defecto si no hay países
    const industryCodes = sectorList.length > 0
      ? sectorList.map((sector) => sectorMapping[sector] || sector)
      : ["technology", "financial-services"]; // Valores por defecto si no hay sectores

    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
      jobTitles
    )}&location=${encodeURIComponent(locations)}&industry=${encodeURIComponent(
      industryCodes.join(",")
    )}`;

    return [searchUrl];
  }

  async getAgentResults(containerId) {
    try {
      console.log(`📥 Obteniendo resultados del agente: ${containerId}`);
      // Usar el endpoint correcto de la API v2 de Phantombuster
      const response = await axios.get(
        `${this.baseUrl}/containers/fetch-output`,
        {
          headers: {
            "X-Phantombuster-Key": this.apiKey,
          },
          params: {
            id: containerId,
          },
        }
      );
      if (response.data.status === "finished") {
        const results = response.data.resultObject || [];
        console.log(`✅ Resultados obtenidos: ${results.length} perfiles`);
        return {
          success: true,
          results,
          message: "Resultados obtenidos exitosamente",
          data: response.data,
        };
      } else {
        return {
          success: false,
          results: [],
          message: "Agente aún no ha terminado",
          data: response.data,
        };
      }
    } catch (error) {
      console.error(
        `❌ Error obteniendo resultados del agente ${containerId}:`,
        error.message
      );
      throw error;
    }
  }

  async getAgentResultsWithFetchResultObject(containerId) {
    try {
      console.log(`📥 Obteniendo resultados con fetch-result-object: ${containerId}`);

      // Usar el endpoint fetch-result-object de Phantombuster
      const response = await axios.get(
        `${this.baseUrl}/containers/fetch-result-object`,
        {
          headers: {
            "X-Phantombuster-Key": this.apiKey,
          },
          params: {
            id: containerId,
          },
          timeout: 30000,
        }
      );

      console.log(`✅ Respuesta de fetch-result-object recibida`);

      if (response.data && response.data.resultObject) {
        let results;

        // Procesar diferentes formatos de resultObject
        if (typeof response.data.resultObject === "string") {
          try {
            const parsedObject = JSON.parse(response.data.resultObject);
            console.log(`✅ Objeto parseado desde string:`, parsedObject);

            // Si el objeto contiene URLs (como csvURL o jsonUrl), descargar desde ahí
            if (parsedObject.jsonUrl) {
              console.log(`🔗 Descargando resultados desde jsonUrl: ${parsedObject.jsonUrl}`);
              const jsonResponse = await axios.get(parsedObject.jsonUrl, {
                timeout: 30000,
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                }
              });

              if (jsonResponse.data) {
                results = Array.isArray(jsonResponse.data) ? jsonResponse.data : jsonResponse.data.results || jsonResponse.data.data || [];
                console.log(`✅ Resultados descargados desde jsonUrl: ${results.length} perfiles`);
              } else {
                throw new Error("No se pudieron obtener datos desde jsonUrl");
              }
            } else if (Array.isArray(parsedObject)) {
              results = parsedObject;
              console.log(`✅ Resultados parseados desde string: ${results.length} perfiles`);
            } else {
              // Buscar array en el objeto parseado
              const possibleArrayKeys = ["results", "data", "profiles", "items", "leads"];
              let foundArray = null;

              for (const key of possibleArrayKeys) {
                if (parsedObject[key] && Array.isArray(parsedObject[key])) {
                  foundArray = parsedObject[key];
                  console.log(`✅ Array encontrado en propiedad '${key}': ${foundArray.length} elementos`);
                  break;
                }
              }

              if (foundArray) {
                results = foundArray;
              } else {
                throw new Error("No se encontró array de resultados en el objeto parseado");
              }
            }
          } catch (parseError) {
            console.error(`❌ Error parseando resultados:`, parseError.message);
            throw new Error("Error parseando resultados JSON");
          }
        } else if (Array.isArray(response.data.resultObject)) {
          results = response.data.resultObject;
          console.log(`✅ Resultados obtenidos directamente: ${results.length} perfiles`);
        } else if (typeof response.data.resultObject === "object") {
          // Buscar array en propiedades conocidas
          const possibleArrayKeys = ["results", "data", "profiles", "items", "leads"];
          let foundArray = null;

          for (const key of possibleArrayKeys) {
            if (response.data.resultObject[key] && Array.isArray(response.data.resultObject[key])) {
              foundArray = response.data.resultObject[key];
              console.log(`✅ Array encontrado en propiedad '${key}': ${foundArray.length} elementos`);
              break;
            }
          }

          if (foundArray) {
            results = foundArray;
          } else {
            // Si no hay array, usar el objeto como resultado único
            results = [response.data.resultObject];
            console.log(`⚠️ Usando objeto como resultado único`);
          }
        } else {
          results = response.data.resultObject;
        }

        // Validar que results sea un array
        if (!Array.isArray(results)) {
          console.error(`❌ Los resultados no son un array:`, typeof results);
          throw new Error("Formato de resultados inválido");
        }

        console.log(`✅ Resultados finales: ${results.length} perfiles`);

        return {
          success: true,
          results,
          message: "Resultados obtenidos exitosamente con fetch-result-object",
          data: response.data,
          source: "fetch_result_object",
        };
      } else if (response.data && Array.isArray(response.data)) {
        // Respuesta directa como array
        console.log(`✅ Resultados (array directo): ${response.data.length} perfiles`);

        return {
          success: true,
          results: response.data,
          message: "Resultados obtenidos (array directo)",
          data: response.data,
          source: "fetch_result_object_array",
        };
      } else {
        console.log(`⚠️ No se encontraron resultados en fetch-result-object`);
        return {
          success: false,
          results: [],
          message: "No se encontraron resultados",
          data: response.data,
          source: "fetch_result_object_empty",
        };
      }
    } catch (error) {
      console.error(`❌ Error obteniendo resultados con fetch-result-object para ${containerId}:`, error.message);

      // Si es un error de "not found", intentar con método alternativo
      if (error.response && (error.response.status === 404 || error.response.status === 400)) {
        console.log(`🔄 fetch-result-object falló, intentando método alternativo...`);
        return await this.getAgentResultsDirectly(containerId);
      }

      throw error;
    }
  }



  async getAgentResultsDirectly(containerId) {
    try {
      console.log(
        `🔍 Intentando obtener resultados directamente para: ${containerId}`
      );

      // Primero intentar obtener el estado del agente
      try {
        const statusResponse = await axios.get(
          `${this.baseUrl}/containers/fetch`,
          {
            headers: {
              "X-Phantombuster-Key": this.apiKey,
            },
            params: {
              id: containerId,
            },
            timeout: 30000, // 30 segundos de timeout
          }
        );

        console.log(
          `📊 Estado del agente ${containerId}: ${statusResponse.data.status}`
        );

        // Si el agente está terminado, intentar obtener resultados
        if (statusResponse.data.status === "finished") {
          console.log(
            `✅ Agente ${containerId} está terminado, obteniendo resultados...`
          );

          const resultsResponse = await axios.get(
            `${this.baseUrl}/containers/fetch-output`,
            {
              headers: {
                "X-Phantombuster-Key": this.apiKey,
              },
              params: {
                id: containerId,
              },
              timeout: 30000,
            }
          );

          if (
            resultsResponse.data &&
            (resultsResponse.data.resultObject || resultsResponse.data.results)
          ) {
            const results =
              resultsResponse.data.resultObject ||
              resultsResponse.data.results ||
              [];
            console.log(
              `✅ Resultados obtenidos directamente: ${results.length} perfiles`
            );

            return {
              success: true,
              results,
              message: "Resultados obtenidos exitosamente (agente terminado)",
              data: resultsResponse.data,
              source: "direct_fetch",
            };
          } else {
            throw new Error("No se encontraron resultados para este agente");
          }
        } else {
          throw new Error(
            `Agente no está terminado, estado actual: ${statusResponse.data.status}`
          );
        }
      } catch (statusError) {
        console.log(
          `⚠️ Error obteniendo estado del agente: ${statusError.message}`
        );

        // Si falla el estado, intentar obtener resultados directamente
        const response = await axios.get(
          `${this.baseUrl}/containers/fetch-output`,
          {
            headers: {
              "X-Phantombuster-Key": this.apiKey,
            },
            params: {
              id: containerId,
            },
            timeout: 30000, // 30 segundos de timeout
          }
        );

        // Si obtenemos respuesta, procesar los resultados
        if (
          response.data &&
          (response.data.resultObject || response.data.results)
        ) {
          const results =
            response.data.resultObject || response.data.results || [];
          console.log(
            `✅ Resultados obtenidos directamente: ${results.length} perfiles`
          );

          return {
            success: true,
            results,
            message:
              "Resultados obtenidos exitosamente (agente expirado pero datos disponibles)",
            data: response.data,
            source: "direct_fetch",
          };
        } else {
          throw new Error("No se encontraron resultados para este agente");
        }
      }
    } catch (error) {
      console.error(
        `❌ Error obteniendo resultados directamente para ${containerId}:`,
        error.message
      );

      // Si es un error de "Agent not found", intentar con el endpoint de resultados
      if (
        error.message.includes("Agent not found") ||
        error.message.includes("404")
      ) {
        console.log(
          `🔄 Intentando obtener resultados desde S3 para: ${containerId}`
        );
        return await this.getResultsFromS3(containerId);
      }

      throw error;
    }
  }

  async getResultsFromS3(containerId) {
    try {
      console.log(
        `🌐 Intentando obtener resultados desde S3 para: ${containerId}`
      );

      // Intentar obtener el archivo JSON desde S3 usando las URLs específicas del log
      const baseUrl =
        "https://phantombuster.s3.amazonaws.com/h8SI1hCqW0g/vbuCD48nPSttgv806HYPow/";

      // Intentar diferentes patrones de nombres de archivo
      const possibleFiles = [
        `europbots_search_${containerId}.json`,
        `europbots_search_*.json`,
        `search_results_${containerId}.json`,
        `phantombuster_results_${containerId}.json`,
      ];

      for (const fileName of possibleFiles) {
        try {
          const s3Url = `${baseUrl}${fileName}`;
          console.log(`🔍 Intentando URL: ${s3Url}`);

          const response = await axios.get(s3Url, {
            timeout: 10000,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          if (response.status === 200 && response.data) {
            console.log(`✅ Resultados encontrados en S3: ${s3Url}`);

            // Procesar los resultados
            const results = Array.isArray(response.data)
              ? response.data
              : response.data.results || response.data.data || [];

            return {
              success: true,
              results,
              message: "Resultados recuperados desde S3 exitosamente",
              data: {
                containerId,
                status: "recovered_from_s3",
                s3Url,
                source: "s3_direct",
              },
              source: "s3_direct",
            };
          }
        } catch (s3Error) {
          console.log(`⚠️ No se pudo acceder a: ${fileName}`);
          continue;
        }
      }

      // Si no se encontraron archivos, devolver información útil
      return {
        success: false,
        results: [],
        message:
          "Agente expirado. Los resultados pueden estar disponibles en S3 pero requieren acceso directo.",
        data: {
          containerId,
          status: "expired",
          s3BaseUrl: baseUrl,
          note: "Verificar manualmente en Phantombuster dashboard",
          possibleFiles,
        },
        source: "s3_fallback",
      };
    } catch (error) {
      console.error(
        `❌ Error obteniendo resultados desde S3 para ${containerId}:`,
        error.message
      );

      return {
        success: false,
        results: [],
        message: "Error accediendo a resultados en S3",
        data: {
          containerId,
          status: "s3_error",
          error: error.message,
        },
        source: "s3_error",
      };
    }
  }

  processPhantombusterResults(results, searchParams = {}) {
    try {
      console.log(
        `🔄 Procesando ${results.length} resultados de Phantombuster`
      );

      if (!Array.isArray(results)) {
        console.error("❌ Los resultados no son un array:", typeof results);
        return [];
      }

      const processedResults = results.map((profile, index) => {
        try {
          // Extraer todos los campos disponibles de Phantombuster
          const processedProfile = {
            // Campos básicos - formato exacto de Phantombuster
            profileUrl: profile.profileUrl || profile.linkedinUrl || "",
            fullName:
              profile.fullName ||
              profile.name ||
              profile.firstName + " " + profile.lastName ||
              "N/A",
            firstName:
              profile.firstName || profile.name?.split(" ")[0] || "N/A",
            lastName:
              profile.lastName ||
              profile.name?.split(" ").slice(1).join(" ") ||
              "N/A",
            headline:
              profile.headline || profile.jobTitle || profile.title || "N/A",
            location: profile.location || "N/A",
            connectionDegree: this.correctConnectionDegree(profile.connectionDegree) || "N/A",
            profileImageUrl: profile.profileImageUrl || "",
            vmid: profile.vmid || "",

            // Información adicional
            additionalInfo: profile.additionalInfo || "",
            sharedConnections: profile.sharedConnections || "",

            // Información de consulta
            query: profile.query || "",
            category: profile.category || "People",
            timestamp: profile.timestamp || new Date().toISOString(),

            // Información laboral principal
            company: profile.company || profile.companyName || "N/A",
            companyUrl: profile.companyUrl || "N/A",
            industry: profile.industry || "N/A",
            jobTitle:
              profile.jobTitle || profile.title || profile.headline || "N/A",
            jobDateRange: profile.jobDateRange || "N/A",

            // Información laboral secundaria
            company2: profile.company2 || "N/A",
            companyUrl2: profile.companyUrl2 || "N/A",
            jobTitle2: profile.jobTitle2 || "N/A",
            jobDateRange2: profile.jobDateRange2 || "N/A",

            // Información educativa
            school: profile.school || "N/A",
            schoolDegree: profile.schoolDegree || "N/A",
            schoolDateRange: profile.schoolDateRange || "N/A",
            school2: profile.school2 || "N/A",
            schoolDegree2: profile.schoolDegree2 || "N/A",
            schoolDateRange2: profile.schoolDateRange2 || "N/A",

            // Campos de procesamiento
            extractedAt: new Date().toISOString(),
            searchParams: searchParams,

            // Campos calculados para análisis
            hasCompany: !!(profile.company || profile.companyName),
            hasIndustry: !!profile.industry,
            hasTitle: !!(profile.headline || profile.jobTitle || profile.title),
            hasLocation: !!profile.location,
            isComplete: !!(
              profile.company &&
              profile.industry &&
              profile.headline
            ),
          };

          // Limpiar campos vacíos o "undefined"
          Object.keys(processedProfile).forEach((key) => {
            if (
              processedProfile[key] === "undefined" ||
              processedProfile[key] === "N/A"
            ) {
              processedProfile[key] = "";
            }
          });

          return processedProfile;
        } catch (profileError) {
          console.error(
            `❌ Error procesando perfil ${index}:`,
            profileError.message
          );
          return {
            profileUrl: profile.profileUrl || "",
            name: "Error en procesamiento",
            title: "N/A",
            location: "N/A",
            connectionDegree: "N/A",
            linkedinUrl: profile.profileUrl || "",
            company: "N/A",
            industry: "N/A",
            extractedAt: new Date().toISOString(),
            searchParams: searchParams,
            error: profileError.message,
          };
        }
      });

      console.log(
        `✅ Procesamiento completado: ${processedResults.length} perfiles`
      );

      // Estadísticas del procesamiento
      const stats = {
        total: processedResults.length,
        withCompany: processedResults.filter((p) => p.hasCompany).length,
        withIndustry: processedResults.filter((p) => p.hasIndustry).length,
        withTitle: processedResults.filter((p) => p.hasTitle).length,
        withLocation: processedResults.filter((p) => p.hasLocation).length,
        complete: processedResults.filter((p) => p.isComplete).length,
      };

      console.log(`📊 Estadísticas:`, stats);

      return processedResults;
    } catch (error) {
      console.error("❌ Error procesando resultados:", error.message);
      return [];
    }
  }

  mapConnectionDegree(degree) {
    const mapping = {
      1: "1st",
      2: "2nd",
      "3+": "3rd+",
    };
    return mapping[degree] || degree;
  }

  /**
   * Método para corregir connectionDegree
   * Cambia "3rd" por "3rd+" para cumplir con la restricción de la base de datos
   */
  correctConnectionDegree(degree) {
    if (!degree) return degree;

    // Si es "3rd", cambiarlo a "3rd+"
    if (degree === "3rd") {
      return "3rd+";
    }

    return degree;
  }

  parseCSVToJSON(csvText) {
    try {
      const lines = csvText.split("\n");
      const headers = lines[0]
        .split(",")
        .map((h) => h.trim().replace(/"/g, ""));
      const results = [];

      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
          const values = lines[i]
            .split(",")
            .map((v) => v.trim().replace(/"/g, ""));
          const obj = {};
          headers.forEach((header, index) => {
            obj[header] = values[index] || "";
          });
          results.push(obj);
        }
      }

      return results;
    } catch (error) {
      console.error("❌ Error parseando CSV:", error);
      return [];
    }
  }

  // ============================================================================
  // MÉTODOS ESPECÍFICOS PARA LINKEDIN AUTOCONNECT
  // ============================================================================

  /**
   * Lanza un agente de LinkedIn Autoconnect con configuración simplificada
   * @param {Object} config - Configuración del autoconnect
   * @returns {Object} Resultado del lanzamiento
   */
  async launchAutoconnectAgent(config) {
    try {
      console.log("🤝 Iniciando LinkedIn Autoconnect...");

      const {
        agentId,
        sessionCookie,
        userAgent,
        profileUrls,
        connectionMessage,
        numberOfProfilesPerLaunch,
        delayBetweenConnections,
        personalizeMessage,
        rateLimiting,
        retryPolicy
      } = config;

      // Validaciones
      if (!agentId) {
        throw new Error("Agent ID es requerido para Autoconnect");
      }

      if (!sessionCookie) {
        throw new Error("LinkedIn session cookie es requerida");
      }

      if (!profileUrls || !Array.isArray(profileUrls) || profileUrls.length === 0) {
        throw new Error("profileUrls debe ser un array con al menos una URL");
      }

      // Preparar argumentos para el phantom
      const autoconnectArguments = {
        // Configuración de LinkedIn
        sessionCookie,
        userAgent,

        // URLs de perfiles para conectar
        profileUrls: profileUrls.slice(0, numberOfProfilesPerLaunch), // Limitar por seguridad

        // Mensaje de conexión
        message: connectionMessage,
        personalizeMessage: personalizeMessage || true,

        // Configuración de velocidad y límites
        numberOfProfilesPerLaunch: Math.min(numberOfProfilesPerLaunch || 5, profileUrls.length),
        delayBetweenConnections: delayBetweenConnections || 45,

        // Límites de LinkedIn
        maxConnectionsPerDay: rateLimiting?.maxConnectionsPerDay || 25,
        respectLinkedInLimits: rateLimiting?.respectLinkedInLimits !== false,

        // Configuración adicional de seguridad
        randomDelay: rateLimiting?.randomDelay !== false,
        stopOnError: false,

        // Configuración de reintentos
        maxRetries: retryPolicy?.maxRetries || 3,
        retryDelay: retryPolicy?.retryDelay || 60000,

        // Configuración de logging
        verbose: true,
        debug: process.env.NODE_ENV === 'development',

        // Nombre único del CSV
        csvName: `europbots_autoconnect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      console.log("🔧 Configuración de Autoconnect:", {
        profileCount: profileUrls.length,
        numberOfProfilesPerLaunch: autoconnectArguments.numberOfProfilesPerLaunch,
        delayBetweenConnections: autoconnectArguments.delayBetweenConnections,
        maxConnectionsPerDay: autoconnectArguments.maxConnectionsPerDay,
        personalizeMessage: autoconnectArguments.personalizeMessage
      });

      // Lanzar el phantom usando circuit breaker
      const response = await this.circuitBreaker.execute(async () => {
        console.log("📤 Enviando petición de Autoconnect a Phantombuster...");

        return await axios.post(
          `${this.baseUrl}/agents/launch`,
          {
            id: agentId,
            argument: autoconnectArguments,
          },
          {
            headers: {
              "X-Phantombuster-Key": this.apiKey,
              "Content-Type": "application/json",
            },
            timeout: 30000, // 30 segundos
          }
        );
      });

      if (response.status === 200 && response.data) {
        const containerId = response.data.containerId;

        console.log(`✅ Autoconnect lanzado exitosamente: ${containerId}`);

        return {
          success: true,
          containerId,
          status: "launched",
          agentId,
          profileCount: profileUrls.length,
          estimatedDuration: Math.ceil(profileUrls.length * (delayBetweenConnections / 60) + 5),
          launchedAt: new Date().toISOString()
        };
      } else {
        throw new Error(`Respuesta inesperada de Phantombuster: ${response.status}`);
      }

    } catch (error) {
      console.error("❌ Error lanzando Autoconnect:", error.message);

      // Manejar errores específicos de Phantombuster
      if (error.response) {
        const { status, data } = error.response;

        if (status === 402) {
          return {
            success: false,
            error: `Request failed with status code 402`,
            message: "No monthly execution time remaining",
            data: data,
            timestamp: new Date().toISOString()
          };
        } else {
          return {
            success: false,
            error: `Request failed with status code ${status}`,
            message: data?.error || "Error de Phantombuster API",
            data: data,
            timestamp: new Date().toISOString()
          };
        }
      } else if (error.request) {
        return {
          success: false,
          error: "No response from Phantombuster API",
          message: "Error de conectividad con Phantombuster",
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          success: false,
          error: error.message,
          message: "Error interno del servicio",
          timestamp: new Date().toISOString()
        };
      }
    }
  }

  /**
   * Obtiene el estado de un agente de Autoconnect
   * @param {string} containerId - ID del container
   * @returns {Object} Estado del agente
   */
  async getAutoconnectStatus(containerId) {
    try {
      console.log(`📊 Obteniendo estado de Autoconnect: ${containerId}`);

      const response = await this.circuitBreaker.execute(async () => {
        return await axios.get(
          `${this.baseUrl}/containers/fetch?id=${containerId}`,
          {
            headers: {
              "X-Phantombuster-Key": this.apiKey,
            },
            timeout: 15000,
          }
        );
      });

      if (response.status === 200 && response.data) {
        const containerData = response.data;

        // Procesar el estado específico para Autoconnect
        const autoconnectStatus = {
          status: containerData.status,
          progress: this.calculateAutoconnectProgress(containerData),
          connectionsRequested: containerData.connectionsRequested || 0,
          connectionsSent: containerData.connectionsSent || 0,
          connectionsAccepted: containerData.connectionsAccepted || 0,
          errors: containerData.errors || [],
          duration: containerData.endedAt ? containerData.endedAt - containerData.launchedAt : Date.now() - containerData.launchedAt,
          estimatedTimeRemaining: this.calculateEstimatedTimeRemaining(containerData),
          message: this.getAutoconnectStatusMessage(containerData)
        };

        return {
          success: true,
          data: autoconnectStatus
        };
      } else {
        throw new Error(`Error obteniendo estado: ${response.status}`);
      }

    } catch (error) {
      console.error(`❌ Error obteniendo estado de Autoconnect ${containerId}:`, error.message);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Obtiene los resultados de un Autoconnect completado
   * @param {string} containerId - ID del container
   * @returns {Object} Resultados del autoconnect
   */
  async getAutoconnectResults(containerId) {
    try {
      console.log(`📥 Obteniendo resultados de Autoconnect: ${containerId}`);

      // Primero verificar que el agente esté terminado
      const statusResult = await this.getAutoconnectStatus(containerId);
      if (!statusResult.success || statusResult.data.status !== 'finished') {
        throw new Error("El Autoconnect aún no ha terminado");
      }

      // Obtener resultados usando fetch-result-object
      const resultsResult = await this.getAgentResultsWithFetchResultObject(containerId);

      if (resultsResult.success) {
        // Procesar resultados específicos para Autoconnect
        const processedResults = this.processAutoconnectResults(resultsResult.results);

        // Extraer S3 URLs si están disponibles en los resultados
        const s3FileUrl = this.extractS3FileUrl(resultsResult.rawData);

        return {
          success: true,
          results: processedResults.connections,
          summary: {
            connectionsRequested: processedResults.summary.connectionsRequested,
            connectionsSent: processedResults.summary.connectionsSent,
            connectionsAccepted: processedResults.summary.connectionsAccepted,
            alreadyConnected: processedResults.summary.alreadyConnected,
            connectionsPending: processedResults.summary.connectionsPending,
            actualAttempts: processedResults.summary.actualAttempts,
            successRate: processedResults.summary.successRate,
            totalSuccessRate: processedResults.summary.totalSuccessRate,
            errors: processedResults.summary.errors,
            warnings: processedResults.summary.warnings,
            totalDuration: processedResults.summary.totalDuration,
            breakdown: processedResults.summary.breakdown
          },
          s3FileUrl,
          interpretation: this.generateAutoconnectInterpretation(processedResults.summary)
        };
      } else {
        throw new Error("No se pudieron obtener los resultados");
      }

    } catch (error) {
      console.error(`❌ Error obteniendo resultados de Autoconnect ${containerId}:`, error.message);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Detiene un agente de Autoconnect en ejecución
   * @param {string} containerId - ID del container
   * @returns {Object} Resultado de la operación
   */
  async stopAutoconnectAgent(containerId) {
    try {
      console.log(`🛑 Deteniendo Autoconnect: ${containerId}`);

      const response = await this.circuitBreaker.execute(async () => {
        return await axios.post(
          `${this.baseUrl}/containers/erase`,
          { id: containerId },
          {
            headers: {
              "X-Phantombuster-Key": this.apiKey,
              "Content-Type": "application/json",
            },
            timeout: 15000,
          }
        );
      });

      if (response.status === 200) {
        console.log(`✅ Autoconnect detenido exitosamente: ${containerId}`);

        return {
          success: true,
          message: "Autoconnect detenido exitosamente",
          stoppedAt: new Date().toISOString()
        };
      } else {
        throw new Error(`Error deteniendo agente: ${response.status}`);
      }

    } catch (error) {
      console.error(`❌ Error deteniendo Autoconnect ${containerId}:`, error.message);

      return {
        success: false,
        error: error.message
      };
    }
  }

  // ============================================================================
  // MÉTODOS AUXILIARES PARA AUTOCONNECT
  // ============================================================================

  /**
   * Calcula el progreso de un Autoconnect basado en los datos del container
   */
  calculateAutoconnectProgress(containerData) {
    if (containerData.status === 'finished') return 100;
    if (containerData.status === 'running') {
      // Estimar progreso basado en conexiones enviadas vs objetivo
      const sent = containerData.connectionsSent || 0;
      const target = containerData.targetConnections || containerData.numberOfProfiles || 10;
      return Math.min(90, Math.round((sent / target) * 100));
    }
    return 0;
  }

  /**
   * Calcula el tiempo estimado restante para un Autoconnect
   */
  calculateEstimatedTimeRemaining(containerData) {
    if (containerData.status === 'finished') return "Completado";

    const sent = containerData.connectionsSent || 0;
    const target = containerData.targetConnections || containerData.numberOfProfiles || 10;
    const remaining = Math.max(0, target - sent);

    if (remaining === 0) return "Finalizando...";

    const avgTimePerConnection = 45; // segundos
    const estimatedSeconds = remaining * avgTimePerConnection;

    if (estimatedSeconds < 60) return `${estimatedSeconds} segundos`;
    if (estimatedSeconds < 3600) return `${Math.ceil(estimatedSeconds / 60)} minutos`;
    return `${Math.ceil(estimatedSeconds / 3600)} horas`;
  }

  /**
   * Genera un mensaje de estado amigable para Autoconnect
   */
  getAutoconnectStatusMessage(containerData) {
    const status = containerData.status;
    const sent = containerData.connectionsSent || 0;
    const errors = containerData.errors || [];

    switch (status) {
      case 'running':
        return `Enviando conexiones... (${sent} enviadas)`;
      case 'finished':
        if (errors.length > 0) {
          return `Completado con ${errors.length} errores (${sent} conexiones enviadas)`;
        }
        return `Completado exitosamente (${sent} conexiones enviadas)`;
      case 'launch error':
        return "Error al iniciar el Autoconnect";
      default:
        return `Estado: ${status}`;
    }
  }

  /**
   * Procesa los resultados específicos de Autoconnect
   */
  processAutoconnectResults(rawResults) {
    try {
      const connections = [];
      let connectionsRequested = 0;
      let connectionsSent = 0;
      let connectionsAccepted = 0;
      let alreadyConnected = 0;
      let connectionsPending = 0;
      const errors = [];
      const warnings = [];

      if (Array.isArray(rawResults)) {
        rawResults.forEach(result => {
          if (result.profileUrl || result.linkedinProfileUrl || result.url) {
            // Determinar el estado de la conexión basado en el análisis profundo del slot PhantomBuster
            let connectionStatus = "unknown";
            let isError = false;
            let isWarning = false;

            // Análisis mejorado basado en patrones reales de PhantomBuster
            if (result.error) {
              // Caso específico: "Already in network" - Es una advertencia, no un error
              if (result.error === "Already in network") {
                connectionStatus = "already_connected";
                isError = false;  // Importante: NO es un error
                isWarning = true; // Es una advertencia
                alreadyConnected++;
                warnings.push(`${result.fullName || result.firstName + ' ' + result.lastName}: Ya conectado`);
              }
              // Otros casos de "already connected" con variaciones de texto
              else if (result.error.toLowerCase().includes("already") ||
                       result.error.toLowerCase().includes("network") ||
                       result.error.toLowerCase().includes("connected")) {
                connectionStatus = "already_connected";
                isWarning = true;
                alreadyConnected++;
                warnings.push(`${result.fullName}: Ya conectado - ${result.error}`);
              }
              // Límites de LinkedIn
              else if (result.error.includes("invitation limit") ||
                        result.error.includes("limit reached") ||
                        result.error.includes("weekly limit") ||
                        result.error.includes("daily limit")) {
                connectionStatus = "limit_reached";
                isError = true;
                errors.push(`Límite alcanzado: ${result.error}`);
              }
              // Invitaciones pendientes
              else if (result.error.includes("pending") ||
                        result.error.includes("invitation pending") ||
                        result.error.includes("awaiting response")) {
                connectionStatus = "pending";
                isWarning = true;
                connectionsPending++;
                warnings.push(`${result.fullName}: Invitación pendiente`);
              }
              // Perfiles no accesibles o bloqueados
              else if (result.error.includes("profile not found") ||
                        result.error.includes("access denied") ||
                        result.error.includes("private profile")) {
                connectionStatus = "inaccessible";
                isError = true;
                errors.push(`${result.fullName}: Perfil no accesible - ${result.error}`);
              }
              // Otros errores reales
              else {
                connectionStatus = "error";
                isError = true;
                errors.push(`${result.fullName}: ${result.error}`);
              }
            } else {
              // Sin error = conexión enviada exitosamente
              connectionStatus = "sent";
              connectionsSent++;
            }

            // Estructura de conexión enriquecida basada en datos reales de PhantomBuster
            const connection = {
              profileUrl: result.profileUrl || result.linkedinProfileUrl || result.url,
              profileId: result.profileId || this.extractProfileIdFromUrl(result.profileUrl || result.linkedinProfileUrl || result.url),
              fullName: result.fullName || (result.firstName && result.lastName ? `${result.firstName} ${result.lastName}` : "Nombre no disponible"),
              firstName: result.firstName || "",
              lastName: result.lastName || "",
              connectionDegree: result.connectionDegree || "unknown",
              connectionStatus,
              message: result.message || "",
              timestamp: result.timestamp || new Date().toISOString(),
              error: result.error || null,
              isError,
              isWarning,
              // Datos adicionales extraídos del análisis del slot
              inviterName: result.inviterName || "",
              inviterProfileUrl: result.inviterProfileUrl || "",
              // Metadatos adicionales disponibles en PhantomBuster
              location: result.location || "",
              headline: result.headline || "",
              company: result.company || "",
              imageUrl: result.imageUrl || result.profilePicture || ""
            };

            connections.push(connection);
            connectionsRequested++;
          }
        });
      }

      // Calcular tasa de éxito real (excluyendo ya conectados)
      const actualAttempts = connectionsRequested - alreadyConnected;
      const successRate = actualAttempts > 0
        ? `${Math.round((connectionsSent / actualAttempts) * 100)}%`
        : "0%";

      // Tasa de éxito total (incluyendo ya conectados como "éxito")
      const totalSuccessRate = connectionsRequested > 0
        ? `${Math.round(((connectionsSent + alreadyConnected) / connectionsRequested) * 100)}%`
        : "0%";

      return {
        connections,
        summary: {
          connectionsRequested,
          connectionsSent,
          connectionsAccepted,
          alreadyConnected,
          connectionsPending,
          actualAttempts,
          successRate, // Tasa de éxito de conexiones nuevas
          totalSuccessRate, // Tasa de éxito incluyendo ya conectados
          errors: [...new Set(errors)], // Eliminar duplicados
          warnings: [...new Set(warnings)], // Eliminar duplicados
          totalDuration: 0, // Se calculará desde el container
          breakdown: {
            sent: connectionsSent,
            alreadyConnected: alreadyConnected,
            pending: connectionsPending,
            errors: errors.length,
            total: connectionsRequested
          }
        }
      };

    } catch (error) {
      console.error("❌ Error procesando resultados de Autoconnect:", error.message);
      return {
        connections: [],
        summary: {
          connectionsRequested: 0,
          connectionsSent: 0,
          connectionsAccepted: 0,
          alreadyConnected: 0,
          connectionsPending: 0,
          actualAttempts: 0,
          successRate: "0%",
          totalSuccessRate: "0%",
          errors: [error.message],
          warnings: [],
          totalDuration: 0,
          breakdown: {
            sent: 0,
            alreadyConnected: 0,
            pending: 0,
            errors: 1,
            total: 0
          }
        }
      };
    }
  }

  /**
   * Extrae el ID del perfil de una URL de LinkedIn
   */
  extractProfileIdFromUrl(url) {
    if (!url) return "unknown";
    const match = url.match(/\/in\/([a-zA-Z0-9\-]+)\/?/);
    return match ? match[1] : "unknown";
  }

  /**
   * Extrae URLs de archivos S3 de los datos raw de PhantomBuster
   */
  extractS3FileUrl(rawData) {
    if (!rawData) return null;

    // Buscar URLs de S3 en diferentes formatos posibles
    const s3UrlPatterns = [
      /https:\/\/phantombuster\.s3\.amazonaws\.com\/[\w\-\/\.]+/g,
      /https:\/\/s3\.amazonaws\.com\/phantombuster[\w\-\/\.]+/g
    ];

    const dataString = JSON.stringify(rawData);

    for (const pattern of s3UrlPatterns) {
      const matches = dataString.match(pattern);
      if (matches && matches.length > 0) {
        return matches[0]; // Devolver la primera URL S3 encontrada
      }
    }

    return null;
  }

  /**
   * Genera interpretación inteligente de los resultados de Autoconnect
   */
  generateAutoconnectInterpretation(summary) {
    const {
      connectionsRequested,
      connectionsSent,
      alreadyConnected,
      actualAttempts,
      errors,
      warnings
    } = summary;

    let status = "unknown";
    let message = "";
    const recommendations = [];
    const nextSteps = [];

    // Determinar estado general
    if (errors.length === 0 && warnings.length === 0) {
      status = "success";
      message = `Proceso completado exitosamente. ${connectionsSent} de ${connectionsRequested} conexiones enviadas.`;
    } else if (errors.length === 0 && warnings.length > 0) {
      status = "success_with_warnings";
      if (alreadyConnected > 0) {
        message = `Proceso completado. ${alreadyConnected} de ${connectionsRequested} perfiles ya estaban conectados.`;
      } else {
        message = `Proceso completado con ${warnings.length} advertencias.`;
      }
    } else {
      status = "partial_success";
      message = `Proceso completado con ${errors.length} errores y ${warnings.length} advertencias.`;
    }

    // Generar recomendaciones basadas en el análisis
    if (alreadyConnected > 0) {
      recommendations.push("Verificar grado de conexión antes de enviar invitaciones");
      recommendations.push("Usar filtros para excluir conexiones existentes");
      recommendations.push("Considerar usar LinkedIn Sales Navigator para mejores filtros");
    }

    if (actualAttempts === 0) {
      recommendations.push("Revisar la lista de perfiles objetivo - todos ya estaban conectados");
      recommendations.push("Expandir criterios de búsqueda para encontrar nuevos prospectos");
    }

    if (errors.length > 0) {
      recommendations.push("Revisar y actualizar los perfiles que generaron errores");
      recommendations.push("Verificar la validez de las URLs de LinkedIn proporcionadas");
    }

    // Generar próximos pasos
    if (alreadyConnected > 0) {
      nextSteps.push("Revisar la lista de contactos existentes");
      nextSteps.push("Buscar perfiles de 2nd o 3rd+ grado para nuevas conexiones");
      nextSteps.push("Personalizar mensajes para diferentes tipos de conexión");
    }

    if (connectionsSent > 0) {
      nextSteps.push("Monitorear respuestas a las invitaciones enviadas");
      nextSteps.push("Preparar mensajes de seguimiento para conexiones aceptadas");
    }

    return {
      status,
      message,
      recommendations,
      nextSteps
    };
  }

  // ============================================================================
  // MÉTODOS ESPECÍFICOS PARA LINKEDIN MESSAGE SENDER
  // ============================================================================

  /**
   * Lanza un agente de LinkedIn Message Sender en PhantomBuster
   * @param {Object} config - Configuración del Message Sender
   * @returns {Object} Resultado de la operación
   */
  async launchMessageSenderAgent(config) {
    try {
      console.log("📩 Iniciando LinkedIn Message Sender...");

      const {
        agentId,
        sessionCookie,
        userAgent,
        profileUrls,
        message,
        numberOfProfilesPerLaunch,
        delayBetweenMessages,
        personalizeMessage,
        rateLimiting,
        retryPolicy
      } = config;

      // Validaciones
      if (!agentId) {
        throw new Error("Agent ID es requerido para Message Sender");
      }

      if (!sessionCookie) {
        throw new Error("LinkedIn session cookie es requerida");
      }

      if (!profileUrls || !Array.isArray(profileUrls) || profileUrls.length === 0) {
        throw new Error("profileUrls debe ser un array con al menos una URL");
      }

      if (!message || message.trim().length === 0) {
        throw new Error("message es requerido y no puede estar vacío");
      }

      // Preparar argumentos para el phantom
      const messageSenderArguments = {
        // Configuración de LinkedIn
        sessionCookie,
        userAgent,

        // URLs de perfiles para enviar mensajes
        profileUrls: profileUrls.slice(0, numberOfProfilesPerLaunch), // Limitar por seguridad

        // Mensaje a enviar
        message: message.trim(),
        personalizeMessage: personalizeMessage || true,

        // Configuración de velocidad y límites
        numberOfProfilesPerLaunch: Math.min(numberOfProfilesPerLaunch || 3, profileUrls.length),
        delayBetweenMessages: delayBetweenMessages || 60,

        // Límites de LinkedIn para mensajes
        maxMessagesPerDay: rateLimiting?.maxMessagesPerDay || 20,
        respectLinkedInLimits: rateLimiting?.respectLinkedInLimits !== false,
        randomDelay: rateLimiting?.randomDelay !== false,

        // Configuración de reintentos
        maxRetries: retryPolicy?.maxRetries || 3,
        retryDelay: retryPolicy?.retryDelay || 120000, // 2 minutos

        // Configuración adicional específica para Message Sender
        waitBeforeSending: 3000, // 3 segundos antes de enviar cada mensaje
        onlyFirstDegreeConnections: true, // Solo enviar a conexiones de 1er grado
        skipIfNoSendButton: true, // Saltar si no hay botón de enviar (no es conexión 1er grado)
        markAsRead: false, // No marcar mensajes como leídos automáticamente

        // Nombre único del CSV
        csvName: `europbots_messages_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      console.log(`🚀 Lanzando Message Sender para ${profileUrls.length} perfil(es) con argumentos:`, {
        profileCount: profileUrls.length,
        messageLength: message.length,
        delayBetweenMessages: messageSenderArguments.delayBetweenMessages,
        maxMessagesPerDay: messageSenderArguments.maxMessagesPerDay
      });

      // Lanzar el agente usando el circuit breaker
      const response = await this.circuitBreaker.execute(async () => {
        return await axios.post(
          `${this.baseUrl}/agents/launch`,
          {
            id: agentId,
            argument: messageSenderArguments,
            bonusArgument: {
              executionId: `message_sender_${Date.now()}`,
              launchedAt: new Date().toISOString(),
              apiVersion: "v1"
            }
          },
          {
            headers: {
              "X-Phantombuster-Key": this.apiKey,
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        );
      });

      if (response.status === 200 && response.data) {
        const containerId = response.data.containerId || response.data.id;

        console.log(`✅ Message Sender lanzado exitosamente. Container ID: ${containerId}`);

        return {
          success: true,
          containerId,
          message: "LinkedIn Message Sender iniciado correctamente",
          profileCount: profileUrls.length,
          estimatedDuration: profileUrls.length * 60 + 180, // segundos
          launchedAt: new Date().toISOString()
        };
      } else {
        throw new Error(`Response no exitosa: ${response.status}`);
      }

    } catch (error) {
      console.error(`❌ Error lanzando Message Sender:`, error.message);

      // Manejar errores específicos de Phantombuster
      if (error.response) {
        const { status, data } = error.response;

        if (status === 402) {
          return {
            success: false,
            error: `Request failed with status code 402`,
            message: "No monthly execution time remaining",
            data: data,
            timestamp: new Date().toISOString()
          };
        } else {
          return {
            success: false,
            error: `Request failed with status code ${status}`,
            message: data?.error || "Error de Phantombuster API",
            data: data,
            timestamp: new Date().toISOString()
          };
        }
      } else if (error.request) {
        return {
          success: false,
          error: "No response from Phantombuster API",
          message: "Error de conectividad con Phantombuster",
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          success: false,
          error: error.message,
          message: "Error interno del servicio",
          timestamp: new Date().toISOString()
        };
      }
    }
  }

  /**
   * Obtiene los resultados de un Message Sender completado
   * @param {string} containerId - ID del container
   * @returns {Object} Resultados del Message Sender
   */
  async getMessageSenderResults(containerId) {
    try {
      console.log(`📥 Obteniendo resultados de Message Sender: ${containerId}`);

      // Primero verificar que el agente esté terminado
      const statusResult = await this.getAgentStatus(containerId, "message_sender");
      if (!statusResult.success || statusResult.data.status !== 'finished') {
        throw new Error("El Message Sender aún no ha terminado");
      }

      // Obtener resultados usando fetch-result-object
      const resultsResult = await this.getAgentResultsWithFetchResultObject(containerId);

      if (resultsResult.success) {
        // Procesar resultados específicos para Message Sender
        const processedResults = this.processMessageSenderResults(resultsResult.results);

        // Extraer S3 URLs si están disponibles
        const s3FileUrl = this.extractS3FileUrl(resultsResult.rawData);

        return {
          success: true,
          results: processedResults.messages,
          summary: {
            messagesRequested: processedResults.summary.messagesRequested,
            messagesSent: processedResults.summary.messagesSent,
            messagesDelivered: processedResults.summary.messagesDelivered,
            messagesRead: processedResults.summary.messagesRead,
            successRate: processedResults.summary.successRate,
            deliveryRate: processedResults.summary.deliveryRate,
            errors: processedResults.summary.errors,
            warnings: processedResults.summary.warnings,
            totalDuration: processedResults.summary.totalDuration,
            breakdown: processedResults.summary.breakdown
          },
          s3FileUrl,
          interpretation: this.generateMessageSenderInterpretation(processedResults.summary)
        };
      } else {
        throw new Error("No se pudieron obtener los resultados");
      }

    } catch (error) {
      console.error(`❌ Error obteniendo resultados de Message Sender ${containerId}:`, error.message);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Procesa los resultados específicos de Message Sender
   */
  processMessageSenderResults(rawResults) {
    try {
      const messages = [];
      let messagesRequested = 0;
      let messagesSent = 0;
      let messagesDelivered = 0;
      let messagesRead = 0;
      const errors = [];
      const warnings = [];

      if (Array.isArray(rawResults)) {
        rawResults.forEach(result => {
          if (result.profileUrl || result.linkedinProfileUrl || result.url) {
            // Determinar el estado del mensaje basado en PhantomBuster
            let messageStatus = "unknown";
            let isError = false;
            let isWarning = false;

            if (result.error) {
              // Análisis de errores específicos de Message Sender
              if (result.error.includes("not a 1st degree connection") ||
                  result.error.includes("cannot send message") ||
                  result.error.includes("no send button")) {
                messageStatus = "not_allowed";
                isWarning = true;
                warnings.push(`${result.fullName}: No es conexión de 1er grado`);
              } else if (result.error.includes("message limit") ||
                        result.error.includes("daily limit reached")) {
                messageStatus = "limit_reached";
                isError = true;
                errors.push(`Límite de mensajes alcanzado: ${result.error}`);
              } else if (result.error.includes("profile not found") ||
                        result.error.includes("profile unavailable")) {
                messageStatus = "profile_unavailable";
                isError = true;
                errors.push(`${result.fullName}: Perfil no disponible`);
              } else {
                messageStatus = "error";
                isError = true;
                errors.push(`${result.fullName}: ${result.error}`);
              }
            } else {
              // Sin error = mensaje enviado exitosamente
              messageStatus = "sent";
              messagesSent++;

              // Verificar si fue entregado/leído
              if (result.delivered || result.messageDelivered) {
                messagesDelivered++;
              }

              if (result.read || result.messageRead) {
                messagesRead++;
              }
            }

            const message = {
              profileUrl: result.profileUrl || result.linkedinProfileUrl || result.url,
              profileId: this.extractProfileIdFromUrl(result.profileUrl || result.linkedinProfileUrl || result.url),
              fullName: result.fullName || (result.firstName && result.lastName ? `${result.firstName} ${result.lastName}` : "Nombre no disponible"),
              firstName: result.firstName || "",
              lastName: result.lastName || "",
              messageStatus,
              messageContent: result.message || result.messageContent || "",
              timestamp: result.timestamp || new Date().toISOString(),
              error: result.error || null,
              isError,
              isWarning,
              delivered: result.delivered || false,
              read: result.read || false,
              conversationUrl: result.conversationUrl || "",
              // Metadatos adicionales
              location: result.location || "",
              headline: result.headline || "",
              company: result.company || ""
            };

            messages.push(message);
            messagesRequested++;
          }
        });
      }

      // Calcular tasas de éxito
      const successRate = messagesRequested > 0
        ? `${Math.round((messagesSent / messagesRequested) * 100)}%`
        : "0%";

      const deliveryRate = messagesSent > 0
        ? `${Math.round((messagesDelivered / messagesSent) * 100)}%`
        : "0%";

      return {
        messages,
        summary: {
          messagesRequested,
          messagesSent,
          messagesDelivered,
          messagesRead,
          successRate,
          deliveryRate,
          errors: [...new Set(errors)], // Eliminar duplicados
          warnings: [...new Set(warnings)], // Eliminar duplicados
          totalDuration: 0, // Se calculará desde el container
          breakdown: {
            sent: messagesSent,
            notAllowed: warnings.length,
            errors: errors.length,
            total: messagesRequested
          }
        }
      };

    } catch (error) {
      console.error("❌ Error procesando resultados de Message Sender:", error.message);
      return {
        messages: [],
        summary: {
          messagesRequested: 0,
          messagesSent: 0,
          messagesDelivered: 0,
          messagesRead: 0,
          successRate: "0%",
          deliveryRate: "0%",
          errors: [error.message],
          warnings: [],
          totalDuration: 0,
          breakdown: {
            sent: 0,
            notAllowed: 0,
            errors: 1,
            total: 0
          }
        }
      };
    }
  }

  /**
   * Genera interpretación inteligente de los resultados de Message Sender
   */
  generateMessageSenderInterpretation(summary) {
    const {
      messagesRequested,
      messagesSent,
      messagesDelivered,
      errors,
      warnings
    } = summary;

    let status = "unknown";
    let message = "";
    const recommendations = [];
    const nextSteps = [];

    // Determinar estado general
    if (errors.length === 0 && warnings.length === 0) {
      status = "success";
      message = `Proceso completado exitosamente. ${messagesSent} de ${messagesRequested} mensajes enviados.`;
    } else if (errors.length === 0 && warnings.length > 0) {
      status = "success_with_warnings";
      message = `Proceso completado con ${warnings.length} advertencias. ${messagesSent} mensajes enviados.`;
    } else {
      status = "partial_success";
      message = `Proceso completado con ${errors.length} errores y ${warnings.length} advertencias.`;
    }

    // Generar recomendaciones basadas en el análisis
    if (warnings.length > 0) {
      recommendations.push("Verificar que los perfiles objetivo sean conexiones de 1er grado");
      recommendations.push("Filtrar la lista para incluir solo conexiones existentes");
      recommendations.push("Considerar usar LinkedIn Sales Navigator para mejores filtros");
    }

    if (errors.length > 0) {
      recommendations.push("Revisar los perfiles que generaron errores");
      recommendations.push("Verificar límites diarios de mensajes de LinkedIn");
      recommendations.push("Considerar reducir la velocidad de envío");
    }

    if (messagesSent === 0) {
      recommendations.push("Revisar la lista de contactos - ningún mensaje pudo ser enviado");
      recommendations.push("Verificar configuración de LinkedIn y permisos de mensajería");
    }

    // Generar próximos pasos
    if (messagesSent > 0) {
      nextSteps.push("Monitorear respuestas a los mensajes enviados");
      nextSteps.push("Preparar seguimiento para mensajes no respondidos");
      nextSteps.push("Analizar tasas de apertura y respuesta");
    }

    if (messagesDelivered > 0) {
      nextSteps.push("Trackear engagement y respuestas");
      nextSteps.push("Optimizar mensajes basado en performance");
    }

    return {
      status,
      message,
      recommendations,
      nextSteps
    };
  }
}

module.exports = PhantombusterService;
