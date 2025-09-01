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
    // Distribución simplificada sin rangos pre-calculados
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
        // Usar startPage y numberOfPage si están disponibles
        startPage: parseInt(url.startPage) || 1,
        numberOfPage: parseInt(url.numberOfPage) || 5,
      };

      distribution.push(urlDistribution);
      currentOffset += proportionalLeads;
    });

    console.log(
      `✅ Distribución proporcional:`,
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

      console.log(
        `🚀 Lanzando URL ${nextUrlState.url_id} con ${nextUrlState.allocated_leads} leads asignados`
      );

      // Lanzar agente con configuración específica
      // Usar startPage y numberOfPage pre-calculados si están disponibles
      let startPage, numberOfPage;

      // PostgreSQL convierte nombres de columna a minúsculas
      const dbStartPage = nextUrlState.startpage !== undefined ? nextUrlState.startpage : nextUrlState.startPage;
      const dbNumberOfPage = nextUrlState.numberofpage !== undefined ? nextUrlState.numberofpage : nextUrlState.numberOfPage;

      console.log(`🔍 DEBUG - Valores desde DB:`, {
        'nextUrlState.startpage': nextUrlState.startpage,
        'nextUrlState.numberofpage': nextUrlState.numberofpage,
        'nextUrlState.startPage': nextUrlState.startPage,
        'nextUrlState.numberOfPage': nextUrlState.numberOfPage,
        dbStartPage,
        dbNumberOfPage
      });


        // Usar valores pre-calculados desde N8N
        startPage = dbStartPage;
        numberOfPage = dbNumberOfPage;
        console.log(
          `✅ Usando startPage y numberOfPage pre-calculados desde N8N: startPage=${startPage}, numberOfPage=${numberOfPage}`
        );

      // Usar parámetros del body o valores por defecto
      const finalNumberOfResultsPerLaunch = searchParams.numberOfResultsPerLaunch || nextUrlState.allocated_leads;
      const finalNumberOfResultsPerSearch = searchParams.numberOfResultsPerSearch || nextUrlState.allocated_leads;
      const finalNumberOfLinesPerLaunch = searchParams.numberOfLinesPerLaunch || 100;

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
          numberOfPage,  // Corregido: numberOfPage primero
          startPage      // Corregido: startPage segundo
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
   * Descargar resultados sin filtro de rango específico
   */
  async downloadResultsWithSpecificRange(sessionId, urlId, containerId) {
    try {
      console.log(
        `📥 Descargando todos los resultados disponibles: ${sessionId} - ${urlId}`
      );

      // Obtener configuración de URL (solo para validar que existe)
      const urlState = await this.dbService.getSequentialUrlState(
        sessionId,
        urlId
      );

      if (!urlState) {
        throw new Error(`Estado de URL no encontrado: ${urlId}`);
      }

      // Configuración sin filtros de rango - obtener todos los resultados disponibles
      const indexingOptions = {
        limit: 1000, // Límite alto para obtener todos los resultados
        offset: 0,   // Sin offset
        format: "json",
        sortBy: "relevance",
        sortOrder: "desc",
        includeMetadata: true,
        deduplicate: true,
        enrichData: true,
        // Sin filtros de rango
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
          status: "completed",
          timestamp: new Date().toISOString(),
        });

        console.log(
          `✅ Resultados descargados: ${results.results.length} leads (todos los disponibles)`
        );

        return {
          success: true,
          results: results.results,
          metadata: {
            sessionId,
            urlId,
            resultsCount: results.results.length,
            expectedResults: urlState.allocated_leads,
            note: "Se obtuvieron todos los resultados disponibles"
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

      // Usar el método estándar de PhantombusterService en lugar de indexación personalizada
      console.log(`🔄 Usando método estándar de PhantombusterService...`);

      // Intentar primero con getAgentResultsWithFetchResultObject
      try {
        const fetchResultObjectResult = await this.phantombusterService.getAgentResultsWithFetchResultObject(containerId);

        if (fetchResultObjectResult.success) {
          console.log(`✅ Resultados obtenidos con fetch-result-object: ${fetchResultObjectResult.results.length} perfiles`);

          // Aplicar filtros de rango si se especifican
          let filteredResults = fetchResultObjectResult.results;

          if (options.filters && options.filters.rangeFilter) {
            const { start, end } = options.filters.rangeFilter;
            console.log(`🔍 Aplicando filtro de rango: ${start}-${end}`);

            filteredResults = fetchResultObjectResult.results.slice(start, end + 1);
            console.log(`✅ Resultados filtrados por rango: ${filteredResults.length} perfiles`);
          }

          // Corregir connectionDegree en los resultados
          const correctedResults = filteredResults.map(result => ({
            ...result,
            connectionDegree: this.correctConnectionDegree(result.connectionDegree)
          }));

          return {
            success: true,
            results: correctedResults,
            message: "Resultados obtenidos exitosamente con fetch-result-object",
            data: fetchResultObjectResult.data,
            metadata: {
              containerId,
              totalResults: correctedResults.length,
              originalResults: fetchResultObjectResult.results.length,
              filters: options.filters,
              timestamp: new Date().toISOString(),
              source: "fetch_result_object_standard",
            },
            source: "fetch_result_object_standard",
          };
        }
      } catch (fetchError) {
        console.log(`⚠️ fetch-result-object falló: ${fetchError.message}`);
      }

      // Si fetch-result-object falla, intentar con getAgentResultsDirectly
      try {
        const directResults = await this.phantombusterService.getAgentResultsDirectly(containerId);

        if (directResults.success) {
          console.log(`✅ Resultados obtenidos con método directo: ${directResults.results.length} perfiles`);

          // Aplicar filtros de rango si se especifican
          let filteredResults = directResults.results;

          if (options.filters && options.filters.rangeFilter) {
            const { start, end } = options.filters.rangeFilter;
            console.log(`🔍 Aplicando filtro de rango: ${start}-${end}`);

            filteredResults = directResults.results.slice(start, end + 1);
            console.log(`✅ Resultados filtrados por rango: ${filteredResults.length} perfiles`);
          }

          // Corregir connectionDegree en los resultados
          const correctedResults = filteredResults.map(result => ({
            ...result,
            connectionDegree: this.correctConnectionDegree(result.connectionDegree)
          }));

          return {
            success: true,
            results: correctedResults,
            message: "Resultados obtenidos exitosamente con método directo",
            data: directResults.data,
            metadata: {
              containerId,
              totalResults: correctedResults.length,
              originalResults: directResults.results.length,
              filters: options.filters,
              timestamp: new Date().toISOString(),
              source: "direct_fetch_standard",
            },
            source: "direct_fetch_standard",
          };
        }
      } catch (directError) {
        console.log(`⚠️ método directo falló: ${directError.message}`);
      }

      // Si ambos métodos fallan, intentar con S3
      try {
        const s3Results = await this.phantombusterService.getResultsFromS3(containerId);

        if (s3Results.success) {
          console.log(`✅ Resultados obtenidos desde S3: ${s3Results.results.length} perfiles`);

          // Aplicar filtros de rango si se especifican
          let filteredResults = s3Results.results;

          if (options.filters && options.filters.rangeFilter) {
            const { start, end } = options.filters.rangeFilter;
            console.log(`🔍 Aplicando filtro de rango: ${start}-${end}`);

            filteredResults = s3Results.results.slice(start, end + 1);
            console.log(`✅ Resultados filtrados por rango: ${filteredResults.length} perfiles`);
          }

          // Corregir connectionDegree en los resultados
          const correctedResults = filteredResults.map(result => ({
            ...result,
            connectionDegree: this.correctConnectionDegree(result.connectionDegree)
          }));

          return {
            success: true,
            results: correctedResults,
            message: "Resultados obtenidos exitosamente desde S3",
            data: s3Results.data,
            metadata: {
              containerId,
              totalResults: correctedResults.length,
              originalResults: s3Results.results.length,
              filters: options.filters,
              timestamp: new Date().toISOString(),
              source: "s3_fallback_standard",
            },
            source: "s3_fallback_standard",
          };
        }
      } catch (s3Error) {
        console.log(`⚠️ S3 falló: ${s3Error.message}`);
      }

      // Si todos los métodos fallan
      console.log(`❌ Todos los métodos de obtención de resultados fallaron`);
      return {
        success: false,
        results: [],
        message: "No se pudieron obtener resultados con ningún método disponible",
        data: null,
        metadata: {
          containerId,
          timestamp: new Date().toISOString(),
          source: "all_methods_failed",
        },
        source: "all_methods_failed",
      };

    } catch (error) {
      console.error(
        `❌ Error obteniendo resultados indexados para ${containerId}:`,
        error.message
      );

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
          connectionDegree: this.correctConnectionDegree(result.connectionDegree) || "Unknown",
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
}

module.exports = SequentialDistributionManager;
