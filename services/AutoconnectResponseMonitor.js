const axios = require('axios');
const { logInfo, logError, logWarn } = require('../utils/logger');

class AutoconnectResponseMonitor {
    constructor(phantombusterService, dbService) {
        this.phantombusterService = phantombusterService;
        this.dbService = dbService;
        this.monitoringContainers = new Map(); // Container ID -> Monitoring Info
        this.responseCallbacks = new Map(); // Container ID -> Callback functions
        this.monitoringInterval = null;
        this.isMonitoring = false;
    }

    /**
     * Iniciar monitoreo de respuestas para un container específico
     * @param {string} containerId - ID del container de Autoconnect
     * @param {Object} options - Opciones de monitoreo
     * @param {Function} callback - Callback para notificar cambios
     */
    async startMonitoring(containerId, options = {}, callback = null) {
        const {
            checkInterval = 30000, // 30 segundos por defecto
            maxDuration = 3600000, // 1 hora máximo
            autoStop = true
        } = options;

        if (this.monitoringContainers.has(containerId)) {
            logWarn(`Monitoreo ya activo para container: ${containerId}`);
            return false;
        }

        const monitoringInfo = {
            containerId,
            startTime: Date.now(),
            checkInterval,
            maxDuration,
            autoStop,
            lastCheck: null,
            lastStatus: null,
            attempts: 0,
            maxAttempts: Math.floor(maxDuration / checkInterval),
            results: null,
            isActive: true
        };

        this.monitoringContainers.set(containerId, monitoringInfo);

        if (callback) {
            this.responseCallbacks.set(containerId, callback);
        }

        logInfo(`🔍 Iniciando monitoreo para container: ${containerId}`);

        // Iniciar monitoreo global si no está activo
        if (!this.isMonitoring) {
            this.startGlobalMonitoring();
        }

        return true;
    }

    /**
     * Detener monitoreo de un container específico
     * @param {string} containerId - ID del container
     */
    stopMonitoring(containerId) {
        if (this.monitoringContainers.has(containerId)) {
            const info = this.monitoringContainers.get(containerId);
            info.isActive = false;
            this.monitoringContainers.delete(containerId);
            this.responseCallbacks.delete(containerId);

            logInfo(`⏹️ Monitoreo detenido para container: ${containerId}`);

            // Si no hay más containers, detener monitoreo global
            if (this.monitoringContainers.size === 0) {
                this.stopGlobalMonitoring();
            }

            return true;
        }
        return false;
    }

    /**
     * Iniciar monitoreo global de todos los containers activos
     */
    startGlobalMonitoring() {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        logInfo('🔄 Iniciando monitoreo global de respuestas Autoconnect');

        this.monitoringInterval = setInterval(async () => {
            await this.checkAllContainers();
        }, 10000); // Check cada 10 segundos
    }

    /**
     * Detener monitoreo global
     */
    stopGlobalMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            this.isMonitoring = false;
            logInfo('⏹️ Monitoreo global detenido');
        }
    }

    /**
     * Verificar estado de todos los containers activos
     */
    async checkAllContainers() {
        const containersToCheck = Array.from(this.monitoringContainers.entries());

        for (const [containerId, info] of containersToCheck) {
            if (!info.isActive) continue;

            try {
                await this.checkContainerStatus(containerId, info);
            } catch (error) {
                logError(`Error verificando container ${containerId}:`, error.message);
                info.attempts++;

                // Si hay demasiados errores, detener monitoreo
                if (info.attempts >= 5) {
                    logWarn(`Demasiados errores para container ${containerId}, deteniendo monitoreo`);
                    this.stopMonitoring(containerId);
                }
            }
        }
    }

    /**
     * Verificar estado de un container específico
     * @param {string} containerId - ID del container
     * @param {Object} info - Información de monitoreo
     */
    async checkContainerStatus(containerId, info) {
        // Verificar si ha excedido el tiempo máximo
        if (Date.now() - info.startTime > info.maxDuration) {
            logWarn(`Container ${containerId} excedió tiempo máximo de monitoreo`);
            if (info.autoStop) {
                this.stopMonitoring(containerId);
            }
            return;
        }

        // Verificar si es momento de hacer check
        if (info.lastCheck && Date.now() - info.lastCheck < info.checkInterval) {
            return;
        }

        info.lastCheck = Date.now();
        info.attempts = 0;

        try {
            // Obtener estado del container
            const statusResponse = await this.phantombusterService.getContainerStatus(containerId);

            if (!statusResponse.success) {
                logError(`Error obteniendo estado de container ${containerId}:`, statusResponse.message);
                return;
            }

            const status = statusResponse.data.status;
            info.lastStatus = status;

            logInfo(`📊 Container ${containerId}: ${status}`);

            // Si el container está terminado, obtener resultados
            if (status === 'finished' || status === 'completed') {
                await this.processContainerResults(containerId, info);
            } else if (status === 'error' || status === 'failed') {
                logError(`Container ${containerId} falló: ${statusResponse.data.message || 'Error desconocido'}`);
                this.notifyCallback(containerId, {
                    type: 'error',
                    containerId,
                    status,
                    message: statusResponse.data.message || 'Error desconocido'
                });

                if (info.autoStop) {
                    this.stopMonitoring(containerId);
                }
            }

        } catch (error) {
            logError(`Error verificando container ${containerId}:`, error.message);
            info.attempts++;
        }
    }

    /**
     * Procesar resultados de un container completado
     * @param {string} containerId - ID del container
     * @param {Object} info - Información de monitoreo
     */
    async processContainerResults(containerId, info) {
        try {
            // Obtener resultados detallados
            const resultsResponse = await this.phantombusterService.getContainerResults(containerId);

            if (!resultsResponse.success) {
                logError(`Error obteniendo resultados de container ${containerId}:`, resultsResponse.message);
                return;
            }

            const results = resultsResponse.data;
            info.results = results;

            // Analizar resultados
            const analysis = this.analyzeResults(results);

            // Guardar en base de datos si está disponible
            if (this.dbService) {
                await this.saveResultsToDatabase(containerId, results, analysis);
            }

            // Notificar callback
            this.notifyCallback(containerId, {
                type: 'completed',
                containerId,
                results,
                analysis,
                timestamp: new Date().toISOString()
            });

            logInfo(`✅ Container ${containerId} completado. Análisis:`, analysis.summary);

            // Detener monitoreo si está configurado
            if (info.autoStop) {
                this.stopMonitoring(containerId);
            }

        } catch (error) {
            logError(`Error procesando resultados de container ${containerId}:`, error.message);
        }
    }

    /**
     * Analizar resultados de Autoconnect
     * @param {Object} results - Resultados del container
     * @returns {Object} Análisis de los resultados
     */
    analyzeResults(results) {
        const summary = results.summary || {};
        const individualResults = results.results || [];

        // Calcular métricas adicionales
        const totalProfiles = summary.totalResults || 0;
        const connectionsSent = summary.connectionsSent || 0;
        const connectionsAccepted = summary.connectionsAccepted || 0;
        const alreadyConnected = summary.alreadyConnected || 0;
        const pendingConnections = summary.connectionsPending || 0;

        // Tasa de éxito real (excluyendo ya conectados)
        const realSuccessRate = connectionsSent > 0 ?
            ((connectionsAccepted / connectionsSent) * 100).toFixed(1) + '%' : '0%';

        // Análisis de perfiles individuales
        const profileAnalysis = individualResults.map(profile => ({
            name: profile.fullName || 'Sin nombre',
            status: profile.connectionStatus || 'unknown',
            error: profile.error || null,
            isError: profile.isError || false,
            isWarning: profile.isWarning || false,
            timestamp: profile.timestamp || null
        }));

        // Clasificar resultados
        const successful = profileAnalysis.filter(p => p.status === 'accepted');
        const pending = profileAnalysis.filter(p => p.status === 'pending');
        const alreadyConnectedProfiles = profileAnalysis.filter(p => p.status === 'already_connected');
        const errors = profileAnalysis.filter(p => p.isError);

        return {
            summary: {
                totalProfiles,
                connectionsSent,
                connectionsAccepted,
                alreadyConnected,
                pendingConnections,
                realSuccessRate,
                totalSuccessRate: summary.totalSuccessRate || '0%',
                errors: errors.length,
                warnings: profileAnalysis.filter(p => p.isWarning).length
            },
            breakdown: {
                successful,
                pending,
                alreadyConnected: alreadyConnectedProfiles,
                errors
            },
            recommendations: this.generateRecommendations(summary, profileAnalysis),
            status: this.determineOverallStatus(summary, profileAnalysis)
        };
    }

    /**
     * Generar recomendaciones basadas en los resultados
     * @param {Object} summary - Resumen de resultados
     * @param {Array} profileAnalysis - Análisis de perfiles individuales
     * @returns {Array} Lista de recomendaciones
     */
    generateRecommendations(summary, profileAnalysis) {
        const recommendations = [];

        const connectionsSent = summary.connectionsSent || 0;
        const connectionsAccepted = summary.connectionsAccepted || 0;
        const alreadyConnected = summary.alreadyConnected || 0;

        if (alreadyConnected > 0) {
            recommendations.push('Verificar grado de conexión antes de enviar invitaciones');
            recommendations.push('Usar filtros para excluir conexiones existentes');
        }

        if (connectionsSent > 0 && connectionsAccepted === 0) {
            recommendations.push('Revisar mensaje de conexión - puede ser muy genérico');
            recommendations.push('Personalizar mensajes según el perfil del destinatario');
        }

        if (profileAnalysis.some(p => p.isError)) {
            recommendations.push('Revisar lista de perfiles - algunos pueden ser inaccesibles');
            recommendations.push('Verificar que los perfiles no estén restringidos');
        }

        if (connectionsSent < 5) {
            recommendations.push('Considerar aumentar el número de perfiles objetivo');
            recommendations.push('Expandir criterios de búsqueda para encontrar más prospectos');
        }

        return recommendations;
    }

    /**
     * Determinar estado general de la campaña
     * @param {Object} summary - Resumen de resultados
     * @param {Array} profileAnalysis - Análisis de perfiles individuales
     * @returns {string} Estado general
     */
    determineOverallStatus(summary, profileAnalysis) {
        const connectionsSent = summary.connectionsSent || 0;
        const connectionsAccepted = summary.connectionsAccepted || 0;
        const hasErrors = profileAnalysis.some(p => p.isError);
        const hasWarnings = profileAnalysis.some(p => p.isWarning);

        if (hasErrors) {
            return 'error';
        } else if (connectionsAccepted > 0) {
            return 'success';
        } else if (hasWarnings) {
            return 'warning';
        } else if (connectionsSent > 0) {
            return 'pending';
        } else {
            return 'no_activity';
        }
    }

    /**
     * Guardar resultados en base de datos
     * @param {string} containerId - ID del container
     * @param {Object} results - Resultados completos
     * @param {Object} analysis - Análisis de resultados
     */
    async saveResultsToDatabase(containerId, results, analysis) {
        try {
            // Aquí puedes implementar el guardado en base de datos
            // Por ejemplo, guardar en una tabla de resultados de campañas
            const dataToSave = {
                container_id: containerId,
                results: JSON.stringify(results),
                analysis: JSON.stringify(analysis),
                created_at: new Date().toISOString()
            };

            // Ejemplo de guardado (ajustar según tu esquema de BD)
            // await this.dbService.query(
            //     'INSERT INTO autoconnect_results (container_id, results, analysis, created_at) VALUES (?, ?, ?, ?)',
            //     [dataToSave.container_id, dataToSave.results, dataToSave.analysis, dataToSave.created_at]
            // );

            logInfo(`💾 Resultados guardados en BD para container: ${containerId}`);
        } catch (error) {
            logError(`Error guardando resultados en BD para container ${containerId}:`, error.message);
        }
    }

    /**
     * Notificar callback con resultados
     * @param {string} containerId - ID del container
     * @param {Object} data - Datos a enviar
     */
    notifyCallback(containerId, data) {
        const callback = this.responseCallbacks.get(containerId);
        if (callback && typeof callback === 'function') {
            try {
                callback(data);
            } catch (error) {
                logError(`Error en callback para container ${containerId}:`, error.message);
            }
        }
    }

    /**
     * Obtener estado de monitoreo de un container
     * @param {string} containerId - ID del container
     * @returns {Object|null} Información de monitoreo
     */
    getMonitoringStatus(containerId) {
        return this.monitoringContainers.get(containerId) || null;
    }

    /**
     * Obtener estado de todos los containers monitoreados
     * @returns {Array} Lista de containers monitoreados
     */
    getAllMonitoringStatus() {
        return Array.from(this.monitoringContainers.entries()).map(([containerId, info]) => ({
            containerId,
            startTime: info.startTime,
            lastCheck: info.lastCheck,
            lastStatus: info.lastStatus,
            attempts: info.attempts,
            isActive: info.isActive,
            hasResults: !!info.results
        }));
    }

    /**
     * Limpiar monitoreo de containers antiguos
     * @param {number} maxAge - Edad máxima en milisegundos (default: 24 horas)
     */
    cleanupOldMonitoring(maxAge = 24 * 60 * 60 * 1000) {
        const now = Date.now();
        const containersToRemove = [];

        for (const [containerId, info] of this.monitoringContainers.entries()) {
            if (now - info.startTime > maxAge) {
                containersToRemove.push(containerId);
            }
        }

        containersToRemove.forEach(containerId => {
            this.stopMonitoring(containerId);
        });

        if (containersToRemove.length > 0) {
            logInfo(`🧹 Limpiados ${containersToRemove.length} containers antiguos del monitoreo`);
        }
    }
}

module.exports = AutoconnectResponseMonitor;
