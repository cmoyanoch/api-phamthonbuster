const axios = require("axios");
const LinkedInCookieManager = require("../cookie-manager");
const fs = require("fs");
const path = require("path");

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
  }

  ensureLogsDirectory() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
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

      await this.validateCookiesBeforeLaunch("search");

      await this.logExecution("launchSearchAgentWithUrl", {
        executionId,
        phase: "cookie_validated",
        message: "Cookies validadas exitosamente",
      });

      console.log("🚀 Lanzando LinkedIn Search Export con URL directa...");
      console.log("📋 URL de búsqueda:", linkedInSearchUrl);

      const agentArguments = {
        searchType: "linkedInSearchUrl",
        linkedInSearchUrl: linkedInSearchUrl,
        // 🎯 PARÁMETROS PARA DATOS NUEVOS (OPTIMIZACIÓN)
        useWatcherMode: true, // ✅ CRÍTICO: Solo buscar perfiles nuevos
        onlyGetNewProfiles: true, // ✅ CRÍTICO: Evitar perfiles ya vistos
        onlyGetFirstResult: false, // No limitarse al primer resultado
        // 🎛️ PARÁMETROS WATCHER MODE (NUEVOS - OPTIMIZACIÓN)
        watcherSettings: {
          checkNewProfilesOnly: true, // Solo perfiles completamente nuevos
          lookForUpdatedProfiles: true, // Incluir perfiles actualizados
          skipOldResults: true, // Saltar resultados antiguos
          maxDaysBack: 1, // Solo últimas 24 horas
          refreshMode: "new_content_only", // Modo de refresh optimizado
        },
        // 🚀 PARÁMETROS DE COMPORTAMIENTO DE BÚSQUEDA (NUEVOS)
        searchBehavior: {
          prioritizeNewContent: true, // Priorizar contenido nuevo
          useLatestAlgorithm: true, // Usar algoritmo más reciente
          bypassCache: true, // No usar cache
          forceRefresh: true, // Forzar refresh
          newDataOptimization: true, // Optimización para datos nuevos
        },
        // 📄 PARÁMETROS DE PAGINACIÓN (CRÍTICOS)
        numberOfPage: parseInt(numberOfPage), // Cuántas páginas extraer
        startPage: parseInt(startPage), // Desde qué página empezar
        numberOfResultsPerLaunch: parseInt(numberOfResults), // Líneas por ejecución
        numberOfResultsPerSearch: parseInt(numberOfResults), // Resultados por búsqueda
        numberOfLinesPerLaunch: parseInt(numberOfResults), // Líneas por ejecución
        // 👥 PARÁMETROS DE GRADOS DE CONEXIÓN
        circles: {
          first: true, // Incluir conexiones de 1er grado
          second: true, // Incluir conexiones de 2do grado
          third: true, // Incluir conexiones de 3er grado
        },
        connectionDegreesToScrape: ["1", "2", "3+"], // Array de grados a extraer
        category: "People", // Categoría de búsqueda
        csvName: `europbots_search_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 6)}`, // Nombre del archivo CSV
        onlyGetFirstResult: false, // No limitarse al primer resultado
        enrichLeadsWithAdditionalInformation: true, // Añadir información adicional
        // 🔄 PARÁMETROS DE DEDUPLICACIÓN (MUY IMPORTANTES)
        removeDuplicateProfiles: true, // ✅ false = permitir más variación
        deduplicationSettings: {
          enabled: true, // Activar deduplicación básica
          checkAgainstPreviousLaunches: false, // ✅ CRÍTICO: false = datos nuevos
          removeExactMatches: true, // Remover duplicados exactos
          removeSimilarProfiles: false, // ✅ CRÍTICO: false = más variación
          similarityThreshold: 0.99, // ✅ CRÍTICO: 0.99 = muy estricto
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
        // ⏱️ PARÁMETROS DE TIMING Y RATE LIMITING
        timeout: 15, // Timeout en segundos (15 para datos nuevos)
        waitBetweenActions: {
          min: 4000, // Mínimo 4 segundos entre acciones
          max: 8000, // Máximo 8 segundos entre acciones
        },
        rateLimiting: {
          delayBetweenSearches: 30, // 30 segundos entre búsquedas
          delayBetweenPages: 6, // 6 segundos entre páginas
          maxSearchesPerDay: 50, // Máximo 50 búsquedas por día
          respectLinkedInLimits: true, // Respetar límites de LinkedIn
          newDataMode: true, // Modo optimizado para datos nuevos
        },

        sessionCookie: process.env.LINKEDIN_SESSION_COOKIE,
        userAgent:
          process.env.LINKEDIN_USER_AGENT ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
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
      throw error;
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

      console.log(
        `✅ Estado del agente ${containerId}: ${response.data.status}`
      );

      return {
        success: true,
        status: response.data.status,
        progress: response.data.progress || 0,
        message: response.data.message,
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
    const { sectors, roles, countries, companySizes } = searchParams;

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

    const sectorList = Array.isArray(sectors)
      ? sectors
      : sectors.split(",").map((s) => s.trim());
    const roleList = Array.isArray(roles)
      ? roles
      : roles.split(",").map((r) => r.trim());
    const countryList = Array.isArray(countries)
      ? countries
      : countries.split(",").map((c) => c.trim());

    const jobTitles = roleList
      .map((role) => roleMapping[role] || role)
      .join(" OR ");
    const locations = countryList
      .map((country) => countryMapping[country] || country)
      .join(" OR ");
    const industryCodes = sectorList.map(
      (sector) => sectorMapping[sector] || sector
    );

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

  // Nuevo método usando fetch-result-object
  async getAgentResultsWithFetchResultObject(containerId) {
    try {
      console.log(
        `📥 Obteniendo resultados usando fetch-result-object: ${containerId}`
      );

      const response = await axios.get(
        `${this.baseUrl}/containers/fetch-result-object`,
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

      console.log(`✅ Respuesta de fetch-result-object recibida`);

      // Verificar si hay resultados
      if (response.data && response.data.resultObject) {
        let results;

        // El resultObject puede ser un string JSON o un objeto ya parseado
        if (typeof response.data.resultObject === "string") {
          try {
            results = JSON.parse(response.data.resultObject);
            console.log(
              `✅ Resultados parseados desde string JSON: ${results.length} perfiles`
            );
          } catch (parseError) {
            console.error(
              `❌ Error parseando JSON string:`,
              parseError.message
            );
            throw new Error("Error parseando resultados JSON");
          }
        } else {
          results = response.data.resultObject;
          console.log(
            `✅ Resultados obtenidos directamente: ${results.length} perfiles`
          );
        }

        // Asegurar que results es un array
        if (!Array.isArray(results)) {
          console.error(`❌ Los resultados no son un array:`, typeof results);
          throw new Error("Formato de resultados inválido");
        }

        return {
          success: true,
          results,
          message:
            "Resultados obtenidos exitosamente usando fetch-result-object",
          data: response.data,
          source: "fetch_result_object",
        };
      } else if (response.data && Array.isArray(response.data)) {
        // Si la respuesta es directamente un array
        console.log(
          `✅ Resultados obtenidos (array directo): ${response.data.length} perfiles`
        );

        return {
          success: true,
          results: response.data,
          message: "Resultados obtenidos exitosamente (array directo)",
          data: response.data,
          source: "fetch_result_object_array",
        };
      } else {
        console.log(`⚠️ No se encontraron resultados en fetch-result-object`);
        return {
          success: false,
          results: [],
          message: "No se encontraron resultados en fetch-result-object",
          data: response.data,
          source: "fetch_result_object_empty",
        };
      }
    } catch (error) {
      console.error(
        `❌ Error obteniendo resultados con fetch-result-object para ${containerId}:`,
        error.message
      );

      // Si es un error 404 o similar, intentar con el método anterior
      if (
        error.response &&
        (error.response.status === 404 || error.response.status === 400)
      ) {
        console.log(`🔄 Intentando método alternativo para ${containerId}...`);
        return await this.getAgentResults(containerId);
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
            connectionDegree: profile.connectionDegree || "N/A",
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
}

module.exports = PhantombusterService;
