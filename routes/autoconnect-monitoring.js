const express = require('express');
const router = express.Router();
const { authenticateApiKey } = require('../middleware/authentication');
const { logInfo, logError } = require('../utils/logger');
const { createSuccessResponse, createErrorResponse } = require('../utils/responseHelpers');

// Middleware para validar container ID
const validateContainerId = (req, res, next) => {
    const { containerId } = req.params;
    if (!containerId || typeof containerId !== 'string' || containerId.trim() === '') {
        return res.status(400).json(createErrorResponse('Container ID inválido'));
    }
    req.containerId = containerId.trim();
    next();
};

// Middleware para validar opciones de monitoreo
const validateMonitoringOptions = (req, res, next) => {
    const { checkInterval, maxDuration, autoStop } = req.body;

    const options = {};

    if (checkInterval !== undefined) {
        const interval = parseInt(checkInterval);
        if (isNaN(interval) || interval < 5000 || interval > 300000) {
            return res.status(400).json(createErrorResponse('checkInterval debe estar entre 5000 y 300000 ms'));
        }
        options.checkInterval = interval;
    }

    if (maxDuration !== undefined) {
        const duration = parseInt(maxDuration);
        if (isNaN(duration) || duration < 60000 || duration > 7200000) {
            return res.status(400).json(createErrorResponse('maxDuration debe estar entre 60000 y 7200000 ms'));
        }
        options.maxDuration = duration;
    }

    if (autoStop !== undefined) {
        if (typeof autoStop !== 'boolean') {
            return res.status(400).json(createErrorResponse('autoStop debe ser un booleano'));
        }
        options.autoStop = autoStop;
    }

    req.monitoringOptions = options;
    next();
};

module.exports = function(autoconnectResponseMonitor) {

    /**
     * POST /api/autoconnect-monitoring/start/:containerId
     * Iniciar monitoreo de respuestas para un container específico
     */
    router.post('/start/:containerId',
        authenticateApiKey,
        validateContainerId,
        validateMonitoringOptions,
        async (req, res) => {
            try {
                const { containerId } = req.params;
                const options = req.monitoringOptions;

                logInfo(`🚀 Iniciando monitoreo para container: ${containerId}`);

                const success = await autoconnectResponseMonitor.startMonitoring(
                    containerId,
                    options
                );

                if (success) {
                    const monitoringStatus = autoconnectResponseMonitor.getMonitoringStatus(containerId);

                    res.json(createSuccessResponse({
                        message: 'Monitoreo iniciado exitosamente',
                        containerId,
                        monitoringInfo: {
                            startTime: monitoringStatus.startTime,
                            checkInterval: monitoringStatus.checkInterval,
                            maxDuration: monitoringStatus.maxDuration,
                            autoStop: monitoringStatus.autoStop
                        }
                    }));
                } else {
                    res.status(400).json(createErrorResponse('No se pudo iniciar el monitoreo'));
                }

            } catch (error) {
                logError('Error iniciando monitoreo:', error.message);
                res.status(500).json(createErrorResponse('Error interno del servidor'));
            }
        }
    );

    /**
     * POST /api/autoconnect-monitoring/stop/:containerId
     * Detener monitoreo de un container específico
     */
    router.post('/stop/:containerId',
        authenticateApiKey,
        validateContainerId,
        async (req, res) => {
            try {
                const { containerId } = req.params;

                logInfo(`⏹️ Deteniendo monitoreo para container: ${containerId}`);

                const success = autoconnectResponseMonitor.stopMonitoring(containerId);

                if (success) {
                    res.json(createSuccessResponse({
                        message: 'Monitoreo detenido exitosamente',
                        containerId
                    }));
                } else {
                    res.status(404).json(createErrorResponse('Container no encontrado en monitoreo'));
                }

            } catch (error) {
                logError('Error deteniendo monitoreo:', error.message);
                res.status(500).json(createErrorResponse('Error interno del servidor'));
            }
        }
    );

    /**
     * GET /api/autoconnect-monitoring/status/:containerId
     * Obtener estado de monitoreo de un container específico
     */
    router.get('/status/:containerId',
        authenticateApiKey,
        validateContainerId,
        async (req, res) => {
            try {
                const { containerId } = req.params;

                const monitoringStatus = autoconnectResponseMonitor.getMonitoringStatus(containerId);

                if (monitoringStatus) {
                    res.json(createSuccessResponse({
                        containerId,
                        isActive: monitoringStatus.isActive,
                        startTime: monitoringStatus.startTime,
                        lastCheck: monitoringStatus.lastCheck,
                        lastStatus: monitoringStatus.lastStatus,
                        attempts: monitoringStatus.attempts,
                        hasResults: !!monitoringStatus.results,
                        options: {
                            checkInterval: monitoringStatus.checkInterval,
                            maxDuration: monitoringStatus.maxDuration,
                            autoStop: monitoringStatus.autoStop
                        }
                    }));
                } else {
                    res.status(404).json(createErrorResponse('Container no encontrado en monitoreo'));
                }

            } catch (error) {
                logError('Error obteniendo estado de monitoreo:', error.message);
                res.status(500).json(createErrorResponse('Error interno del servidor'));
            }
        }
    );

    /**
     * GET /api/autoconnect-monitoring/all
     * Obtener estado de todos los containers monitoreados
     */
    router.get('/all',
        authenticateApiKey,
        async (req, res) => {
            try {
                const allStatus = autoconnectResponseMonitor.getAllMonitoringStatus();

                res.json(createSuccessResponse({
                    totalContainers: allStatus.length,
                    activeContainers: allStatus.filter(s => s.isActive).length,
                    containers: allStatus
                }));

            } catch (error) {
                logError('Error obteniendo estado de todos los monitoreos:', error.message);
                res.status(500).json(createErrorResponse('Error interno del servidor'));
            }
        }
    );

    /**
     * POST /api/autoconnect-monitoring/cleanup
     * Limpiar monitoreo de containers antiguos
     */
    router.post('/cleanup',
        authenticateApiKey,
        async (req, res) => {
            try {
                const { maxAge } = req.body;
                const maxAgeMs = maxAge ? parseInt(maxAge) : 24 * 60 * 60 * 1000; // Default 24 horas

                if (isNaN(maxAgeMs) || maxAgeMs < 0) {
                    return res.status(400).json(createErrorResponse('maxAge debe ser un número positivo'));
                }

                logInfo(`🧹 Limpiando monitoreo de containers antiguos (maxAge: ${maxAgeMs}ms)`);

                autoconnectResponseMonitor.cleanupOldMonitoring(maxAgeMs);

                const remainingContainers = autoconnectResponseMonitor.getAllMonitoringStatus();

                res.json(createSuccessResponse({
                    message: 'Limpieza completada',
                    remainingContainers: remainingContainers.length
                }));

            } catch (error) {
                logError('Error en limpieza de monitoreo:', error.message);
                res.status(500).json(createErrorResponse('Error interno del servidor'));
            }
        }
    );

    /**
     * POST /api/autoconnect-monitoring/launch-and-monitor
     * Lanzar Autoconnect y monitorear respuestas automáticamente
     */
    router.post('/launch-and-monitor',
        authenticateApiKey,
        async (req, res) => {
            try {
                const { profileUrl, connectionMessage, monitoringOptions } = req.body;

                // Validar parámetros requeridos
                if (!profileUrl || typeof profileUrl !== 'string') {
                    return res.status(400).json(createErrorResponse('profileUrl es requerido y debe ser una cadena'));
                }

                if (!connectionMessage || typeof connectionMessage !== 'string') {
                    return res.status(400).json(createErrorResponse('connectionMessage es requerido y debe ser una cadena'));
                }

                // Lanzar Autoconnect
                const autoconnectConfig = {
                    profileUrl,
                    connectionMessage
                };
                const launchResponse = await req.app.locals.phantombusterService.launchAutoconnectAgent(autoconnectConfig);

                if (!launchResponse.success) {
                    return res.status(400).json(createErrorResponse(launchResponse.message));
                }

                const containerId = launchResponse.data.containerId;

                // Iniciar monitoreo automáticamente
                const monitoringSuccess = await autoconnectResponseMonitor.startMonitoring(
                    containerId,
                    monitoringOptions || {}
                );

                if (!monitoringSuccess) {
                    logError(`No se pudo iniciar monitoreo para container: ${containerId}`);
                }

                res.json(createSuccessResponse({
                    message: 'Autoconnect lanzado y monitoreo iniciado',
                    containerId,
                    launchData: launchResponse.data,
                    monitoringActive: monitoringSuccess
                }));

            } catch (error) {
                logError('Error en launch-and-monitor:', error.message);
                res.status(500).json(createErrorResponse('Error interno del servidor'));
            }
        }
    );

    /**
     * GET /api/autoconnect-monitoring/analytics
     * Obtener analytics de monitoreo
     */
    router.get('/analytics',
        authenticateApiKey,
        async (req, res) => {
            try {
                const allStatus = autoconnectResponseMonitor.getAllMonitoringStatus();

                // Calcular analytics
                const totalContainers = allStatus.length;
                const activeContainers = allStatus.filter(s => s.isActive).length;
                const completedContainers = allStatus.filter(s => s.hasResults).length;
                const errorContainers = allStatus.filter(s => s.attempts >= 5).length;

                const avgAttempts = totalContainers > 0 ?
                    allStatus.reduce((sum, s) => sum + s.attempts, 0) / totalContainers : 0;

                res.json(createSuccessResponse({
                    analytics: {
                        totalContainers,
                        activeContainers,
                        completedContainers,
                        errorContainers,
                        averageAttempts: Math.round(avgAttempts * 100) / 100,
                        completionRate: totalContainers > 0 ?
                            ((completedContainers / totalContainers) * 100).toFixed(1) + '%' : '0%'
                    },
                    containers: allStatus
                }));

            } catch (error) {
                logError('Error obteniendo analytics:', error.message);
                res.status(500).json(createErrorResponse('Error interno del servidor'));
            }
        }
    );

    return router;
};
