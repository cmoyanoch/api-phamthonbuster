#!/usr/bin/env node

/**
 * Gestor de Distribución Secuencial para Phantombuster API
 *
 * Esta clase maneja la distribución secuencial de leads con rangos específicos
 * y persistencia de estado para continuar desde donde se quedó
 */

const axios = require("axios");

class SequentialDistributionManager {
  constructor(dbService, phantombusterService) {
    this.dbService = dbService;
    this.phantombusterService = phantombusterService;
    this.baseUrl = "https://api.phantombuster.com/api/v2";
  }

  /**
   * Inicializar o recuperar secuencia
   */
  async initializeOrResumeSequence(
    campaignId,
    urlsWithPriorities,
    totalLeadsLimit = 2000
  ) {
    try {
      console.log(
        `🔄 Inicializando/recuperando secuencia para campaña: ${campaignId}`
      );

      // Generar session ID único y corto
      const timestamp = Math.floor(Date.now() / 1000);
      const randomSuffix = Math.random().toString(36).substr(2, 4);
      const sessionId = `seq_${timestamp}_${randomSuffix}`;

      // Verificar si existe una secuencia activa para esta campaña
      const existingSession = await this.dbService.getSequentialSession(
        campaignId
      );

      if (existingSession && existingSession.status === "active") {
        console.log(
          `📂 Recuperando secuencia existente: ${existingSession.session_id}`
        );
        return await this.resumeExistingSequence(
          existingSession,
          urlsWithPriorities
        );
      } else {
        console.log(`🆕 Creando nueva secuencia: ${sessionId}`);
        return await this.createNewSequence(
          sessionId,
          campaignId,
          urlsWithPriorities,
          totalLeadsLimit
        );
      }
    } catch (error) {
      console.error(`❌ Error inicializando secuencia:`, error.message);
      throw error;
    }
  }

  /**
   * Crear nueva secuencia
   */
  async createNewSequence(
    sessionId,
    campaignId,
    urlsWithPriorities,
    totalLeadsLimit
  ) {
    try {
      // Calcular distribución secuencial
      const distribution = this.calculateSequentialDistribution(
        urlsWithPriorities,
        totalLeadsLimit
      );

      // Persistir estado inicial
      const sessionState = {
        session_id: sessionId,
        campaign_id: campaignId,
        total_leads_limit: totalLeadsLimit,
        current_offset: 0,
        total_distributed: 0,
        remaining_leads: totalLeadsLimit,
        current_sequence: 0,
        total_sequences: distribution.length,
        distribution_config: {
          urls: distribution,
          totalLeadsLimit,
          campaignId,
        },
        execution_history: [],
        status: "active",
      };

      await this.dbService.saveSequentialSession(sessionState);

      // Persistir estados de URLs
      for (let i = 0; i < distribution.length; i++) {
        const urlConfig = distribution[i];
        const urlState = {
          session_id: sessionId,
          url_id: urlConfig.id,
          url_template: urlConfig.url,
          priority: urlConfig.priority,
          sequence_order: i + 1,
          allocated_leads: urlConfig.distribution,
          range_start: urlConfig.range.start,
          range_end: urlConfig.range.end,
          // Guardar startPage y numberOfPage si están disponibles
          startPage: urlConfig.startPage,
          numberOfPage: urlConfig.numberOfPage,
          status: "pending",
        };

        await this.dbService.saveSequentialUrlState(urlState);
      }

      console.log(
        `✅ Nueva secuencia creada: ${sessionId} con ${distribution.length} URLs`
      );

      return {
        sessionId,
        campaignId,
        distribution,
        status: "new_sequence",
        nextUrl: distribution[0],
      };
    } catch (error) {
      console.error(`❌ Error creando nueva secuencia:`, error.message);
      throw error;
    }
  }

  /**
   * Recuperar secuencia existente
   */
  async resumeExistingSequence(existingSession, urlsWithPriorities) {
    try {
      console.log(`📂 Recuperando secuencia: ${existingSession.session_id}`);

      // Obtener estados de URLs
      const urlStates = await this.dbService.getSequentialUrlStates(
        existingSession.session_id
      );

      // Encontrar próxima URL pendiente
      const nextUrlState = urlStates.find((url) => url.status === "pending");

      if (!nextUrlState) {
        console.log(`✅ Secuencia completada: ${existingSession.session_id}`);
        await this.dbService.updateSequentialSessionStatus(
          existingSession.session_id,
          "completed"
        );

        return {
          sessionId: existingSession.session_id,
          campaignId: existingSession.campaign_id,
          status: "completed",
          totalDistributed: existingSession.total_distributed,
          message: "Secuencia completada",
        };
      }

      console.log(
        `🔄 Continuando desde URL: ${nextUrlState.url_id} (secuencia ${nextUrlState.sequence_order})`
      );

      return {
        sessionId: existingSession.session_id,
        campaignId: existingSession.campaign_id,
        distribution: existingSession.distribution_config,
        status: "resumed",
        nextUrl: {
          id: nextUrlState.url_id,
          url: nextUrlState.url_template,
          priority: nextUrlState.priority,
          distribution: nextUrlState.allocated_leads,
          range: {
            start: nextUrlState.range_start,
            end: nextUrlState.range_end,
          },
          sequenceOrder: nextUrlState.sequence_order,
        },
        currentOffset: existingSession.current_offset,
        remainingLeads: existingSession.remaining_leads,
      };
    } catch (error) {
      console.error(`❌ Error recuperando secuencia:`, error.message);
      throw error;
    }
  }

  // Función para calcular startPage basado en el rango
  calculateStartPageForRange(rangeStart, rangeEnd, resultsPerPage = 25) {
    return Math.floor(rangeStart / resultsPerPage) + 1;
  }

  /**
   * Calcular distribución secuencial
   */
  calculateSequentialDistribution(urlsWithPriorities, totalLeadsLimit) {
    // Validar que urlsWithPriorities sea un array
    if (!Array.isArray(urlsWithPriorities)) {
      console.error(
        `❌ urlsWithPriorities no es un array:`,
        typeof urlsWithPriorities,
        urlsWithPriorities
      );
      throw new Error(
        `urlsWithPriorities debe ser un array, recibido: ${typeof urlsWithPriorities}`
      );
    }

    if (urlsWithPriorities.length === 0) {
      throw new Error("urlsWithPriorities no puede estar vacío");
    }

    console.log(
      `📊 Calculando distribución secuencial para ${urlsWithPriorities.length} URLs`
    );

    // Verificar si las URLs ya tienen rangos calculados (desde N8N)
    const hasPreCalculatedRanges = urlsWithPriorities.some(
      (url) =>
        (url.rangeStart !== undefined && url.rangeEnd !== undefined) ||
        (url.distribution_info &&
          url.distribution_info.rangeStart !== undefined &&
          url.distribution_info.rangeEnd !== undefined)
    );

    if (hasPreCalculatedRanges) {
      console.log(`✅ Usando rangos pre-calculados desde N8N`);

      // Usar rangos pre-calculados
      const distribution = urlsWithPriorities.map((url, index) => {
        // Extraer valores de distribution_info si existe, sino usar valores directos
        const distributionInfo = url.distribution_info || {};
        const rangeStart =
          parseInt(distributionInfo.rangeStart || url.rangeStart) || 0;
        const rangeEnd =
          parseInt(distributionInfo.rangeEnd || url.rangeEnd) || 124;
        const allocatedLeads = rangeEnd - rangeStart + 1;

        const urlDistribution = {
          id: url.id,
          url: url.url_template || url.url, // Usar url_template de N8N o url como fallback
          priority: url.prioridad || url.priority, // Usar prioridad de N8N o priority como fallback
          distribution: allocatedLeads,
          range: {
            start: rangeStart,
            end: rangeEnd,
          },
          offset: rangeStart,
          limit: allocatedLeads,
          sequenceOrder: index + 1,
          // Preservar startPage y numberOfPage calculados en N8N
          startPage: parseInt(distributionInfo.startPage || url.startPage) || 1,
          numberOfPage:
            parseInt(distributionInfo.numberOfPage || url.numberOfPage) || 5,
        };

        return urlDistribution;
      });

      console.log(
        `✅ Distribución con rangos pre-calculados:`,
        distribution.map((d) => ({
          id: d.id,
          priority: d.priority,
          distribution: d.distribution,
          range: `${d.range.start}-${d.range.end}`,
          startPage: d.startPage,
          numberOfPage: d.numberOfPage,
        }))
      );

      return distribution;
    }

    // Si no hay rangos pre-calculados, usar distribución proporcional
    console.log(`📊 Usando distribución proporcional por prioridad`);

    // Ordenar por prioridad
    const sortedUrls = urlsWithPriorities.sort(
      (a, b) => a.priority - b.priority
    );

    // Calcular pesos totales
    const totalPriority = sortedUrls.reduce(
      (sum, url) => sum + 1 / url.priority,
      0
    );

    // Distribuir leads secuencialmente
    const distribution = [];
    let currentOffset = 0;

    sortedUrls.forEach((url, index) => {
      const weight = 1 / url.priority;
      const proportionalLeads = Math.round(
        (weight / totalPriority) * totalLeadsLimit
      );

      const urlDistribution = {
        id: url.id,
        url: url.url_template || url.url, // Usar url_template de N8N o url como fallback
        priority: url.prioridad || url.priority, // Usar prioridad de N8N o priority como fallback
        distribution: proportionalLeads,
        range: {
          start: currentOffset,
          end: currentOffset + proportionalLeads - 1,
        },
        offset: currentOffset,
        limit: proportionalLeads,
        sequenceOrder: index + 1,
      };

      distribution.push(urlDistribution);
      currentOffset += proportionalLeads;
    });

    console.log(
      `✅ Distribución proporcional calculada:`,
      distribution.map((d) => ({
        id: d.id,
        priority: d.priority,
        distribution: d.distribution,
        range: `${d.range.start}-${d.range.end}`,
      }))
    );

    return distribution;
  }

  /**
   * Ejecutar próxima URL en la secuencia
   */
  async executeNextUrlInSequence(sessionId, searchParams = {}) {
    try {
      console.log(`🚀 Ejecutando próxima URL en secuencia: ${sessionId}`);

      // Obtener estado actual
      const sessionState = await this.dbService.getSequentialSessionBySessionId(
        sessionId
      );
      const urlStates = await this.dbService.getSequentialUrlStates(sessionId);

      // Encontrar próxima URL pendiente
      const nextUrlState = urlStates.find((url) => url.status === "pending");

      if (!nextUrlState) {
        console.log(`✅ No hay más URLs pendientes en la secuencia`);
        await this.dbService.updateSequentialSessionStatus(
          sessionId,
          "completed"
        );
        return { status: "completed", message: "Secuencia completada" };
      }

      // Actualizar estado a 'running'
      await this.dbService.updateSequentialUrlStateStatus(
        sessionId,
        nextUrlState.url_id,
        "running"
      );

      // Configuración de indexación para esta URL
      const indexingConfig = {
        limit: nextUrlState.allocated_leads,
        offset: nextUrlState.range_start,
        format: "json",
        sortBy: "relevance",
        sortOrder: "desc",
        includeMetadata: true,
        deduplicate: true,
        enrichData: true,
      };

      console.log(
        `🚀 Lanzando URL ${nextUrlState.url_id} con rango ${nextUrlState.range_start}-${nextUrlState.range_end}`
      );

      // Lanzar agente con configuración específica
      // Usar startPage y numberOfPage pre-calculados si están disponibles
      let startPage, numberOfPage;

      if (
        nextUrlState.startPage !== undefined &&
        nextUrlState.numberOfPage !== undefined
      ) {
        // Usar valores pre-calculados desde N8N
        startPage = nextUrlState.startPage;
        numberOfPage = nextUrlState.numberOfPage;
        console.log(
          `✅ Usando startPage y numberOfPage pre-calculados: ${startPage}, ${numberOfPage}`
        );
      } else {
        // Calcular dinámicamente
        startPage = this.calculateStartPageForRange(
          nextUrlState.range_start,
          nextUrlState.range_end
        );
        numberOfPage = Math.ceil(nextUrlState.allocated_leads / 25);
        console.log(
          `📊 Calculando startPage y numberOfPage dinámicamente: ${startPage}, ${numberOfPage}`
        );
      }

      // Usar parámetros del body o valores por defecto
      const finalNumberOfResultsPerLaunch =
        searchParams.numberOfResultsPerLaunch || nextUrlState.allocated_leads;
      const finalNumberOfResultsPerSearch =
        searchParams.numberOfResultsPerSearch || nextUrlState.allocated_leads;
      const finalNumberOfLinesPerLaunch =
        searchParams.numberOfLinesPerLaunch || 100;

      console.log(`📊 Usando parámetros dinámicos del workflow:`);
      console.log(
        `   • numberOfResultsPerLaunch: ${finalNumberOfResultsPerLaunch}`
      );
      console.log(
        `   • numberOfResultsPerSearch: ${finalNumberOfResultsPerSearch}`
      );
      console.log(
        `   • numberOfLinesPerLaunch: ${finalNumberOfLinesPerLaunch}`
      );
      console.log(`   • startPage: ${startPage}`);
      console.log(`   • numberOfPage: ${numberOfPage}`);

      const launchResult =
        await this.phantombusterService.launchSearchAgentWithUrl(
          nextUrlState.url_template,
          finalNumberOfResultsPerLaunch,
          startPage,
          numberOfPage
        );

      // Actualizar estado con container ID
      await this.dbService.updateSequentialUrlStateContainer(
        sessionId,
        nextUrlState.url_id,
        launchResult.containerId
      );

      // Actualizar offset global
      const newOffset =
        sessionState.current_offset + nextUrlState.allocated_leads;
      const newDistributed =
        sessionState.total_distributed + nextUrlState.allocated_leads;
      const newRemaining =
        sessionState.remaining_leads - nextUrlState.allocated_leads;

      await this.dbService.updateSequentialSessionProgress(
        sessionId,
        newOffset,
        newDistributed,
        newRemaining,
        nextUrlState.sequence_order
      );

      return {
        status: "launched",
        sessionId,
        urlId: nextUrlState.url_id,
        containerId: launchResult.containerId,
        range: {
          start: nextUrlState.range_start,
          end: nextUrlState.range_end,
        },
        allocatedLeads: nextUrlState.allocated_leads,
        sequenceOrder: nextUrlState.sequence_order,
        remainingLeads: newRemaining,
      };
    } catch (error) {
      console.error(`❌ Error ejecutando próxima URL:`, error.message);

      // Marcar URL como fallida si nextUrlState está definido
      try {
        if (typeof nextUrlState !== "undefined" && nextUrlState) {
          await this.dbService.updateSequentialUrlStateStatus(
            sessionId,
            nextUrlState.url_id,
            "failed"
          );
        }
      } catch (updateError) {
        console.error(
          `❌ Error actualizando estado de URL fallida:`,
          updateError.message
        );
      }

      throw error;
    }
  }

  /**
   * Descargar resultados con rango específico
   */
  async downloadResultsWithSpecificRange(sessionId, urlId, containerId) {
    try {
      console.log(
        `📥 Descargando resultados con rango específico: ${sessionId} - ${urlId}`
      );

      // Obtener configuración de rango
      const urlState = await this.dbService.getSequentialUrlState(
        sessionId,
        urlId
      );

      if (!urlState) {
        throw new Error(`Estado de URL no encontrado: ${urlId}`);
      }

      // Configuración de indexación específica
      const indexingOptions = {
        limit: urlState.allocated_leads,
        offset: urlState.range_start,
        format: "json",
        sortBy: "relevance",
        sortOrder: "desc",
        includeMetadata: true,
        deduplicate: true,
        enrichData: true,
        filters: {
          rangeFilter: {
            start: urlState.range_start,
            end: urlState.range_end,
          },
        },
      };

      // Descargar resultados usando el método mejorado
      const results = await this.getAgentResultsWithIndexing(
        containerId,
        indexingOptions
      );

      if (results.success) {
        // Actualizar estado con resultados
        await this.dbService.updateSequentialUrlStateResults(
          sessionId,
          urlId,
          results.results.length,
          "completed"
        );

        // Agregar a historial de ejecución
        await this.dbService.addSequentialExecutionHistory(sessionId, {
          urlId,
          containerId,
          resultsCount: results.results.length,
          range: urlState.range_start + "-" + urlState.range_end,
          status: "completed",
          timestamp: new Date().toISOString(),
        });

        console.log(
          `✅ Resultados descargados: ${results.results.length} leads en rango ${urlState.range_start}-${urlState.range_end}`
        );

        return {
          success: true,
          results: results.results,
          metadata: {
            sessionId,
            urlId,
            range: {
              start: urlState.range_start,
              end: urlState.range_end,
            },
            resultsInRange: results.results.length,
            expectedResults: urlState.allocated_leads,
          },
        };
      } else {
        throw new Error(
          `No se pudieron obtener resultados: ${results.message}`
        );
      }
    } catch (error) {
      console.error(`❌ Error descargando resultados:`, error.message);

      // Marcar como fallido
      await this.dbService.updateSequentialUrlStateStatus(
        sessionId,
        urlId,
        "failed"
      );

      throw error;
    }
  }

  /**
   * Obtener estado completo de la secuencia
   */
  async getSequenceStatus(sessionId) {
    try {
      const sessionState = await this.dbService.getSequentialSessionBySessionId(
        sessionId
      );
      const urlStates = await this.dbService.getSequentialUrlStates(sessionId);

      const summary = {
        sessionId,
        campaignId: sessionState.campaign_id,
        status: sessionState.status,
        progress: {
          currentSequence: sessionState.current_sequence,
          totalSequences: sessionState.total_sequences,
          percentage: Math.round(
            (sessionState.current_sequence / sessionState.total_sequences) * 100
          ),
        },
        leads: {
          totalLimit: sessionState.total_leads_limit,
          distributed: sessionState.total_distributed,
          remaining: sessionState.remaining_leads,
        },
        urls: urlStates.map((url) => ({
          id: url.url_id,
          urlId: url.url_id, // Agregar urlId para compatibilidad con N8N
          status: url.status,
          sequenceOrder: url.sequence_order,
          allocatedLeads: url.allocated_leads,
          resultsCount: url.results_count,
          range: `${url.range_start}-${url.range_end}`,
          containerId: url.container_id,
        })),
      };

      return summary;
    } catch (error) {
      console.error(`❌ Error obteniendo estado de secuencia:`, error.message);
      throw error;
    }
  }

  /**
   * Método mejorado para obtener resultados con indexación
   */
  async getAgentResultsWithIndexing(containerId, options = {}) {
    try {
      console.log(`📥 Obteniendo resultados con indexación: ${containerId}`);

      // Parámetros de indexación por defecto
      const defaultOptions = {
        limit: 100,
        offset: 0,
        format: "json",
        sortBy: "relevance",
        sortOrder: "desc",
        includeMetadata: true,
        deduplicate: true,
        enrichData: true,
        filters: {},
        pagination: {
          page: 1,
          pageSize: 50,
          autoPaginate: true,
          maxPages: 20,
        },
      };

      // Combinar opciones
      const indexingOptions = { ...defaultOptions, ...options };

      console.log(
        `⚙️ Opciones de indexación:`,
        JSON.stringify(indexingOptions, null, 2)
      );

      // Construir parámetros de query
      const queryParams = {
        id: containerId,
        limit: indexingOptions.limit,
        offset: indexingOptions.offset,
        format: indexingOptions.format,
        sortBy: indexingOptions.sortBy,
        sortOrder: indexingOptions.sortOrder,
        includeMetadata: indexingOptions.includeMetadata,
        deduplicate: indexingOptions.deduplicate,
        enrichData: indexingOptions.enrichData,
        ...indexingOptions.filters,
      };

      // Realizar petición con indexación
      const response = await axios.get(
        `${this.baseUrl}/containers/fetch-result-object`,
        {
          headers: {
            "X-Phantombuster-Key": this.phantombusterService.apiKey,
            "Content-Type": "application/json",
          },
          params: queryParams,
          timeout: 60000, // 60 segundos de timeout para indexación
        }
      );

      console.log(`✅ Respuesta de indexación recibida`);

      // Procesar respuesta con indexación
      if (response.data && response.data.resultObject) {
        let results;

        console.log(`🔍 Estructura de response.data:`, {
          hasResultObject: !!response.data.resultObject,
          resultObjectType: typeof response.data.resultObject,
          isString: typeof response.data.resultObject === "string",
          isArray: Array.isArray(response.data.resultObject),
          keys:
            typeof response.data.resultObject === "object"
              ? Object.keys(response.data.resultObject)
              : null,
        });

        // Parsear resultados
        if (typeof response.data.resultObject === "string") {
          try {
            results = JSON.parse(response.data.resultObject);
            console.log(
              `✅ Resultados indexados parseados: ${
                Array.isArray(results) ? results.length : "no es array"
              } perfiles`
            );
          } catch (parseError) {
            console.error(
              `❌ Error parseando resultados indexados:`,
              parseError.message
            );
            throw new Error("Error parseando resultados JSON indexados");
          }
        } else if (Array.isArray(response.data.resultObject)) {
          results = response.data.resultObject;
          console.log(
            `✅ Resultados indexados obtenidos directamente: ${results.length} perfiles`
          );
        } else if (typeof response.data.resultObject === "object") {
          // El resultObject es un objeto, verificar si tiene una propiedad que contenga el array
          console.log(
            `🔍 resultObject es objeto, explorando propiedades:`,
            Object.keys(response.data.resultObject)
          );

          // Buscar posibles propiedades que contengan los resultados
          const possibleArrayKeys = [
            "results",
            "data",
            "profiles",
            "items",
            "leads",
          ];
          let foundArray = null;

          for (const key of possibleArrayKeys) {
            if (
              response.data.resultObject[key] &&
              Array.isArray(response.data.resultObject[key])
            ) {
              foundArray = response.data.resultObject[key];
              console.log(
                `✅ Array encontrado en propiedad '${key}': ${foundArray.length} elementos`
              );
              break;
            }
          }

          if (foundArray) {
            results = foundArray;
          } else {
            // Verificar si el objeto contiene URLs de resultados (caso especial de Phantombuster)
            if (
              response.data.resultObject.csvURL ||
              response.data.resultObject.jsonUrl
            ) {
              console.log(
                `🔗 Objeto contiene URLs de resultados, intentando descargar desde:`,
                response.data.resultObject.jsonUrl ||
                  response.data.resultObject.csvURL
              );

              // Intentar descargar desde la URL JSON primero, luego CSV como fallback
              let downloadUrl =
                response.data.resultObject.jsonUrl ||
                response.data.resultObject.csvURL;

              try {
                const downloadResponse = await axios.get(downloadUrl, {
                  timeout: 30000,
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  },
                });

                if (downloadResponse.data) {
                  // Intentar parsear como JSON
                  let downloadedData = downloadResponse.data;
                  if (typeof downloadedData === "string") {
                    try {
                      downloadedData = JSON.parse(downloadedData);
                    } catch (parseError) {
                      console.log(
                        `⚠️ No se pudo parsear como JSON, tratando como CSV`
                      );
                      // Aquí podrías agregar lógica para parsear CSV si es necesario
                      throw new Error(
                        "Formato de datos descargados no soportado"
                      );
                    }
                  }

                  if (Array.isArray(downloadedData)) {
                    results = downloadedData;
                    console.log(
                      `✅ Datos descargados exitosamente: ${results.length} perfiles`
                    );
                  } else {
                    throw new Error("Datos descargados no son un array");
                  }
                } else {
                  throw new Error(
                    "No se pudieron descargar datos desde la URL"
                  );
                }
              } catch (downloadError) {
                console.error(
                  `❌ Error descargando datos desde URL:`,
                  downloadError.message
                );
                throw new Error(
                  `Error descargando resultados: ${downloadError.message}`
                );
              }
            } else {
              // Si no encontramos un array en propiedades conocidas, usar todo el objeto como array de un elemento
              console.log(
                `⚠️ No se encontró array en propiedades conocidas, tratando objeto como resultado único`
              );
              results = [response.data.resultObject];
            }
          }
        } else {
          results = response.data.resultObject;
          console.log(
            `✅ Resultados indexados obtenidos: ${
              Array.isArray(results)
                ? results.length
                : "tipo: " + typeof results
            } perfiles`
          );
        }

        // Verificar si results es un objeto con URLs (caso especial después de parsear JSON string)
        if (!Array.isArray(results) && typeof results === "object") {
          // Verificar si el objeto contiene URLs de resultados (caso especial de Phantombuster)
          if (results.csvURL || results.jsonUrl) {
            console.log(
              `🔗 Objeto parseado contiene URLs de resultados, intentando descargar desde:`,
              results.jsonUrl || results.csvURL
            );

            // Intentar descargar desde la URL JSON primero, luego CSV como fallback
            let downloadUrl = results.jsonUrl || results.csvURL;

            try {
              const downloadResponse = await axios.get(downloadUrl, {
                timeout: 30000,
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
              });

              if (downloadResponse.data) {
                // Intentar parsear como JSON
                let downloadedData = downloadResponse.data;
                if (typeof downloadedData === "string") {
                  try {
                    downloadedData = JSON.parse(downloadedData);
                  } catch (parseError) {
                    console.log(
                      `⚠️ No se pudo parsear como JSON, tratando como CSV`
                    );
                    // Aquí podrías agregar lógica para parsear CSV si es necesario
                    throw new Error(
                      "Formato de datos descargados no soportado"
                    );
                  }
                }

                if (Array.isArray(downloadedData)) {
                  results = downloadedData;
                  console.log(
                    `✅ Datos descargados exitosamente: ${results.length} perfiles`
                  );
                } else {
                  throw new Error("Datos descargados no son un array");
                }
              } else {
                throw new Error("No se pudieron descargar datos desde la URL");
              }
            } catch (downloadError) {
              console.error(
                `❌ Error descargando datos desde URL:`,
                downloadError.message
              );
              throw new Error(
                `Error descargando resultados: ${downloadError.message}`
              );
            }
          }
        }

        // Validar y procesar resultados
        if (!Array.isArray(results)) {
          console.error(
            `❌ Los resultados indexados no son un array:`,
            typeof results,
            `Valor:`,
            JSON.stringify(results, null, 2).substring(0, 500)
          );
          throw new Error("Formato de resultados indexados inválido");
        }

        // Aplicar filtros adicionales si se especifican
        if (
          indexingOptions.filters &&
          Object.keys(indexingOptions.filters).length > 0
        ) {
          results = this.applyIndexingFilters(results, indexingOptions.filters);
          console.log(
            `🔍 Resultados después de filtros: ${results.length} perfiles`
          );
        }

        // Aplicar deduplicación si está habilitada
        if (indexingOptions.deduplicate) {
          results = this.deduplicateResults(results);
          console.log(
            `🔄 Resultados después de deduplicación: ${results.length} perfiles`
          );
        }

        // Enriquecer datos si está habilitado
        if (indexingOptions.enrichData) {
          results = this.enrichResultsData(results);
          console.log(`📊 Resultados enriquecidos: ${results.length} perfiles`);
        }

        // Metadata de indexación
        const indexingMetadata = {
          containerId,
          totalResults: results.length,
          indexingOptions,
          queryParams,
          timestamp: new Date().toISOString(),
          source: "fetch_result_object_indexed",
          pagination: {
            currentPage: indexingOptions.pagination.page,
            pageSize: indexingOptions.pagination.pageSize,
            hasMore: results.length >= indexingOptions.limit,
            totalPages: Math.ceil(
              results.length / indexingOptions.pagination.pageSize
            ),
          },
        };

        return {
          success: true,
          results,
          message: "Resultados indexados obtenidos exitosamente",
          data: response.data,
          metadata: indexingMetadata,
          source: "fetch_result_object_indexed",
        };
      } else if (response.data && Array.isArray(response.data)) {
        // Respuesta directa como array
        console.log(
          `✅ Resultados indexados (array directo): ${response.data.length} perfiles`
        );

        return {
          success: true,
          results: response.data,
          message: "Resultados indexados obtenidos (array directo)",
          data: response.data,
          metadata: {
            containerId,
            totalResults: response.data.length,
            indexingOptions,
            timestamp: new Date().toISOString(),
            source: "fetch_result_object_indexed_array",
          },
          source: "fetch_result_object_indexed_array",
        };
      } else {
        console.log(`⚠️ No se encontraron resultados indexados`);
        return {
          success: false,
          results: [],
          message: "No se encontraron resultados indexados",
          data: response.data,
          metadata: {
            containerId,
            indexingOptions,
            timestamp: new Date().toISOString(),
            source: "fetch_result_object_indexed_empty",
          },
          source: "fetch_result_object_indexed_empty",
        };
      }
    } catch (error) {
      console.error(
        `❌ Error obteniendo resultados indexados para ${containerId}:`,
        error.message
      );

      // Fallback a método anterior
      if (
        error.response &&
        (error.response.status === 404 || error.response.status === 400)
      ) {
        console.log(`🔄 Intentando método alternativo para ${containerId}...`);
        return await this.phantombusterService.getAgentResultsWithFetchResultObject(
          containerId
        );
      }

      throw error;
    }
  }

  /**
   * Método para aplicar filtros de indexación
   */
  applyIndexingFilters(results, filters) {
    console.log(`🔍 Aplicando filtros de indexación:`, filters);

    return results.filter((result) => {
      // Filtro por industria
      if (filters.industry && result.industry) {
        if (
          !result.industry
            .toLowerCase()
            .includes(filters.industry.toLowerCase())
        ) {
          return false;
        }
      }

      // Filtro por ubicación
      if (filters.location && result.location) {
        if (
          !result.location
            .toLowerCase()
            .includes(filters.location.toLowerCase())
        ) {
          return false;
        }
      }

      // Filtro por grado de conexión
      if (filters.connectionDegree && result.connectionDegree) {
        if (!filters.connectionDegree.includes(result.connectionDegree)) {
          return false;
        }
      }

      // Filtro por tamaño de empresa
      if (filters.companySize && result.companySize) {
        if (!filters.companySize.includes(result.companySize)) {
          return false;
        }
      }

      // Filtro por fecha de actividad
      if (filters.lastActive && result.lastActive) {
        const lastActiveDate = new Date(result.lastActive);
        const filterDate = new Date();
        filterDate.setDate(filterDate.getDate() - parseInt(filters.lastActive));

        if (lastActiveDate < filterDate) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Método para deduplicar resultados
   */
  deduplicateResults(results) {
    console.log(`🔄 Aplicando deduplicación a ${results.length} resultados`);

    const seen = new Set();
    const uniqueResults = [];

    for (const result of results) {
      // Crear clave única basada en perfil
      const uniqueKey = `${
        result.profileUrl || result.linkedInUrl || result.url || ""
      }_${result.fullName || result.name || ""}`;

      if (!seen.has(uniqueKey)) {
        seen.add(uniqueKey);
        uniqueResults.push(result);
      }
    }

    const duplicatesRemoved = results.length - uniqueResults.length;
    console.log(
      `✅ Deduplicación completada: ${duplicatesRemoved} duplicados removidos`
    );

    return uniqueResults;
  }

  /**
   * Método para enriquecer datos
   */
  enrichResultsData(results) {
    console.log(`📊 Enriqueciendo datos de ${results.length} resultados`);

    return results.map((result) => {
      const enriched = { ...result };

      // Enriquecer con datos de empresa
      if (result.currentCompany && !enriched.companyData) {
        enriched.companyData = {
          name: result.currentCompany,
          industry: result.industry || "Unknown",
          size: result.companySize || "Unknown",
          type: result.companyType || "Unknown",
        };
      }

      // Enriquecer con datos de perfil
      if (result.fullName && !enriched.profileData) {
        enriched.profileData = {
          fullName: result.fullName,
          firstName: result.firstName || result.fullName.split(" ")[0],
          lastName:
            result.lastName || result.fullName.split(" ").slice(1).join(" "),
          title: result.currentJobTitle || result.title || "Unknown",
          location: result.location || "Unknown",
          connectionDegree: result.connectionDegree || "Unknown",
        };
      }

      // Enriquecer con metadata de indexación
      enriched.indexingMetadata = {
        indexedAt: new Date().toISOString(),
        source: "phantombuster_api",
        version: "2.0.0",
        enrichmentLevel: "basic",
      };

      return enriched;
    });
  }
}

module.exports = SequentialDistributionManager;
