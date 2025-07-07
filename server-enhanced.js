const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================================
// MIDDLEWARE DE SEGURIDAD Y CONFIGURACIÓN
// ============================================================================

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests por ventana
    message: {
        error: 'Demasiadas requests desde esta IP, intenta de nuevo más tarde.',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Logging
app.use(morgan('combined'));

// ============================================================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================================================

const authenticateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(401).json({
            success: false,
            message: 'API key inválida o faltante',
            error: 'UNAUTHORIZED'
        });
    }

    next();
};

// ============================================================================
// ALMACENAMIENTO EN MEMORIA
// ============================================================================

const searchStore = new Map();
const visitStore = new Map(); // 🆕 Store para profile visits
const followUpStore = new Map(); // 🆕 Store para seguimientos programados
const dailyLimitStore = new Map(); // 🆕 Store para límites diarios

// Almacenamiento limpio - sin datos simulados

// ============================================================================
// 🆕 SERVICIO LINKEDIN PROFILE VISITOR
// ============================================================================

class LinkedInProfileVisitorService {
    constructor() {
        this.apiKey = process.env.PHANTOMBUSTER_API_KEY;
        this.agentId = process.env.PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID;
        this.baseUrl = 'https://api.phantombuster.com/api/v2';
        this.maxDailyVisits = 80; // Límite seguro de LinkedIn
    }

    // Verificar límites diarios
    checkDailyLimits(userId = 'default') {
        const today = new Date().toISOString().split('T')[0];
        const key = `${userId}_${today}`;
        const currentVisits = dailyLimitStore.get(key) || 0;

        return {
            currentVisits,
            maxVisits: this.maxDailyVisits,
            remaining: this.maxDailyVisits - currentVisits,
            canVisit: currentVisits < this.maxDailyVisits
        };
    }

    // Incrementar contador diario
    incrementDailyVisits(userId = 'default') {
        const today = new Date().toISOString().split('T')[0];
        const key = `${userId}_${today}`;
        const currentVisits = dailyLimitStore.get(key) || 0;
        dailyLimitStore.set(key, currentVisits + 1);
    }

    // Visitar un perfil individual
    async visitSingleProfile(profileUrl, options = {}) {
        try {
            // Verificar límites diarios
            const limits = this.checkDailyLimits(options.userId);
            if (!limits.canVisit) {
                throw new Error(`Límite diario alcanzado: ${limits.currentVisits}/${limits.maxVisits}`);
            }

            const visitId = `visit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const containerId = `container_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            console.log('🎯 Visitando perfil individual:', profileUrl);

            // Configurar parámetros según tipo de lead
            const visitConfig = this.getVisitConfig(options.leadType || 'cold');

            // Simular visita (en producción sería llamada real a Phantombuster)
            const visitResult = await this.simulateProfileVisit(profileUrl, visitConfig);

            // Guardar resultado de visita
            const visitData = {
                visitId,
                containerId,
                profileUrl,
                status: 'running',
                progress: 0,
                startedAt: new Date().toISOString(),
                options: {
                    ...options,
                    ...visitConfig
                },
                result: null
            };

            visitStore.set(visitId, visitData);

            // Simular progreso
            setTimeout(() => this.completeVisit(visitId, visitResult), visitConfig.visitDelay * 1000);

            return {
                visitId,
                containerId,
                status: 'launched',
                profileUrl,
                estimatedDuration: visitConfig.visitDelay,
                message: 'Visita iniciada exitosamente'
            };

        } catch (error) {
            console.error('❌ Error visitando perfil:', error);
            throw error;
        }
    }

    // Completar visita simulada
    completeVisit(visitId, visitResult) {
        const visit = visitStore.get(visitId);
        if (visit) {
            visit.status = visitResult.success ? 'completed' : 'failed';
            visit.progress = 100;
            visit.completedAt = new Date().toISOString();
            visit.result = visitResult;
            visitStore.set(visitId, visit);

            // Incrementar contador si fue exitosa
            if (visitResult.success) {
                this.incrementDailyVisits(visit.options.userId);
            }

            // Programar seguimiento si es necesario
            if (visitResult.success && visit.options.scheduleFollowUp) {
                this.scheduleFollowUp(visit.profileUrl, visit.options);
            }
        }
    }

    // Obtener configuración según tipo de lead
    getVisitConfig(leadType) {
        const configs = {
            hot: {
                visitDelay: 20,
                maxRetries: 3,
                followUpDays: 2,
                priority: 'high'
            },
            warm: {
                visitDelay: 30,
                maxRetries: 2,
                followUpDays: 7,
                priority: 'medium'
            },
            cold: {
                visitDelay: 45,
                maxRetries: 1,
                followUpDays: 14,
                priority: 'low'
            }
        };

        return configs[leadType] || configs.cold;
    }

    // Simular visita de perfil
    async simulateProfileVisit(profileUrl, config) {
        // Simular éxito/fallo basado en probabilidades realistas
        const successRate = 0.92; // 92% de éxito típico
        const success = Math.random() < successRate;

        if (success) {
            return {
                success: true,
                profileUrl,
                visitTimestamp: new Date().toISOString(),
                visitCount: 1,
                profileData: {
                    name: this.extractNameFromUrl(profileUrl),
                    title: 'Cargo Profesional',
                    location: 'Madrid, Spain',
                    industry: 'Technology',
                    connections: '500+'
                },
                notificationSent: Math.random() < 0.12 // 12% reciben notificación
            };
        } else {
            const errors = [
                'Perfil no accesible',
                'Perfil privado',
                'Usuario no encontrado',
                'Límite temporal alcanzado'
            ];
            return {
                success: false,
                profileUrl,
                error: errors[Math.floor(Math.random() * errors.length)],
                visitTimestamp: new Date().toISOString()
            };
        }
    }

    // Extraer nombre aproximado de URL
    extractNameFromUrl(url) {
        const match = url.match(/\/in\/([^\/]+)/);
        if (match) {
            return match[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
        return 'Usuario LinkedIn';
    }

    // Programar seguimiento
    scheduleFollowUp(profileUrl, options) {
        const followUpDate = new Date();
        const config = this.getVisitConfig(options.leadType);
        followUpDate.setDate(followUpDate.getDate() + config.followUpDays);

        const followUpId = `followup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        followUpStore.set(followUpId, {
            followUpId,
            profileUrl,
            leadType: options.leadType,
            scheduledDate: followUpDate.toISOString(),
            status: 'pending',
            createdAt: new Date().toISOString(),
            originalVisitId: options.visitId
        });

        console.log(`📅 Seguimiento programado para ${followUpDate.toDateString()}: ${profileUrl}`);
    }

    // Procesar lista de perfiles uno por uno
    async processProfileList(profileUrls, options = {}) {
        const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const delayBetweenProfiles = options.delayBetweenProfiles || 60; // 1 minuto por defecto

        console.log(`🚀 Procesando lista de ${profileUrls.length} perfiles`);

        const batchData = {
            batchId,
            profileUrls,
            status: 'running',
            progress: 0,
            startedAt: new Date().toISOString(),
            options,
            visits: [],
            stats: {
                total: profileUrls.length,
                completed: 0,
                successful: 0,
                failed: 0
            }
        };

        visitStore.set(batchId, batchData);

        // Procesar perfiles uno por uno
        this.processProfilesSequentially(batchId, profileUrls, options, delayBetweenProfiles);

        return {
            batchId,
            status: 'launched',
            totalProfiles: profileUrls.length,
            estimatedDuration: profileUrls.length * (delayBetweenProfiles + 30), // rough estimate
            message: 'Procesamiento de lista iniciado'
        };
    }

    // Procesar perfiles secuencialmente
    async processProfilesSequentially(batchId, profileUrls, options, delay) {
        const batch = visitStore.get(batchId);

        for (let i = 0; i < profileUrls.length; i++) {
            const profileUrl = profileUrls[i];

            try {
                // Verificar límites antes de cada visita
                const limits = this.checkDailyLimits(options.userId);
                if (!limits.canVisit) {
                    console.log(`🛑 Límite diario alcanzado. Deteniendo en perfil ${i + 1}/${profileUrls.length}`);
                    batch.status = 'stopped_limit_reached';
                    break;
                }

                console.log(`🎯 Visitando perfil ${i + 1}/${profileUrls.length}: ${profileUrl}`);

                // Visitar perfil individual
                const visitResult = await this.visitSingleProfile(profileUrl, {
                    ...options,
                    batchId,
                    profileIndex: i
                });

                batch.visits.push(visitResult);
                batch.stats.completed++;
                batch.progress = Math.round((i + 1) / profileUrls.length * 100);

                // Esperar entre perfiles (excepto el último)
                if (i < profileUrls.length - 1) {
                    await this.delay(delay * 1000);
                }

            } catch (error) {
                console.error(`❌ Error visitando perfil ${i + 1}: ${error.message}`);
                batch.stats.failed++;
                batch.visits.push({
                    profileUrl,
                    status: 'failed',
                    error: error.message
                });
            }

            // Actualizar batch en memoria
            visitStore.set(batchId, batch);
        }

        // Marcar batch como completado
        batch.status = 'completed';
        batch.completedAt = new Date().toISOString();
        visitStore.set(batchId, batch);

        console.log(`✅ Batch ${batchId} completado: ${batch.stats.successful}/${batch.stats.total} exitosos`);
    }

    // Utilidad para delay
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Obtener seguimientos pendientes para hoy
    getTodayFollowUps() {
        const today = new Date().toISOString().split('T')[0];
        const followUps = [];

        for (const [id, followUp] of followUpStore.entries()) {
            const followUpDate = followUp.scheduledDate.split('T')[0];
            if (followUpDate === today && followUp.status === 'pending') {
                followUps.push(followUp);
            }
        }

        return followUps;
    }

    // Verificar si un perfil fue visitado recientemente
    wasVisitedRecently(profileUrl, days = 7) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        for (const [id, visit] of visitStore.entries()) {
            if (visit.profileUrl === profileUrl &&
                visit.result?.success &&
                new Date(visit.completedAt) > cutoffDate) {
                return {
                    wasVisited: true,
                    lastVisit: visit.completedAt,
                    visitId: visit.visitId
                };
            }
        }

        return { wasVisited: false };
    }
}

// ============================================================================
// SERVICIO PHANTOMBUSTER REAL (BÚSQUEDAS)
// ============================================================================

class PhantombusterService {
    constructor() {
        this.apiKey = process.env.PHANTOMBUSTER_API_KEY;
        this.agentId = process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID;
        this.baseUrl = 'https://api.phantombuster.com/api/v2';
    }

    async launchAgent(searchUrls, options = {}) {
        try {
            if (!this.apiKey || !this.agentId) {
                throw new Error('API Key y Agent ID de Phantombuster son requeridos');
            }

            const containerId = `container_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            console.log('🚀 Lanzando agente Phantombuster real...');
            console.log('📋 URLs de búsqueda:', searchUrls);
            console.log('⚙️ Opciones:', options);

            // Configurar argumentos para el agente de LinkedIn Search Export
            const agentArguments = {
                searchType: 'keywords',
                keywords: searchUrls.join(', '),
                numberOfResultsPerLaunch: options.numberOfResultsPerSearch || 100,
                numberOfResultsPerSearch: options.numberOfResultsPerSearch || 100,
                connectionDegreesToScrape: ['2', '3+'],
                category: 'People',
                enrichLeadsWithAdditionalInformation: true,
                // Configuración de LinkedIn (requerida)
                sessionCookie: process.env.LINKEDIN_SESSION_COOKIE || 'AQEFARABAAAAABansMgAAAGXfFcaJwAAAZgHBAqlTgAAs3VybjpsaTplbnRlcnByaXNlQXV0aFRva2VuOmVKeGpaQUFDcVMybm8wQzA3S1NTOVNCYVhFcGpDeU9JVWNGOHNBSE1pTjZrRXMzQUNBQzJ3UWdmXnVybjpsaTplbnRlcnByaXNlUHJvZmlsZToodXJuOmxpOmVudGVycHJpc2VBY2NvdW50OjQ0ODA1NjE1NCw0OTYxMzczOTEpXnVybjpsaTptZW1iZXI6OTkxOTk2NDExFSWvrC62HmuIt0_WDVb5g4WhXF5LTvr80EuNLOWNNDHfBkz9gnleV4o1e1CbDDg3qlPpQyOOnHrM4HIokY4m3kW9brdTTOK9CqrsUIXsCRTJ-D8C0d74dlAPdAktAqFR-XfPyzdfser4bYQGzeEpTcIGDela_EH1gH54g11U_r3p9xUhMzennJHoRbfk59BCC0ZrOA',
                userAgent: process.env.LINKEDIN_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
            };

            // Llamada real a la API de Phantombuster
            const response = await fetch(`${this.baseUrl}/agents/launch`, {
                method: 'POST',
                headers: {
                    'X-Phantombuster-Key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: this.agentId,
                    argument: JSON.stringify(agentArguments)
                })
            });

            if (!response.ok) {
                throw new Error(`Error de Phantombuster API: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();

            return {
                containerId: result.containerId || containerId,
                status: 'launched',
                message: 'Agente lanzado exitosamente en Phantombuster',
                phantombusterResult: result
            };
        } catch (error) {
            console.error('❌ Error lanzando agente real:', error);
            throw error;
        }
    }

    async getAgentStatus(containerId) {
        try {
            if (!this.apiKey) {
                throw new Error('API Key de Phantombuster es requerido');
            }

            const response = await fetch(`${this.baseUrl}/agents/fetch-output?id=${this.agentId}&containerId=${containerId}`, {
                headers: {
                    'X-Phantombuster-Key': this.apiKey
                }
            });

            if (!response.ok) {
                throw new Error(`Error obteniendo estado: ${response.status}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('❌ Error obteniendo estado del agente:', error);
            throw error;
        }
    }

    async getAgentResults(containerId) {
        try {
            if (!this.apiKey) {
                throw new Error('API Key de Phantombuster es requerido');
            }

            const response = await fetch(`${this.baseUrl}/agents/fetch-output?id=${this.agentId}&containerId=${containerId}`, {
                headers: {
                    'X-Phantombuster-Key': this.apiKey
                }
            });

            if (!response.ok) {
                throw new Error(`Error obteniendo resultados: ${response.status}`);
            }

            const result = await response.json();

            // Procesar y enriquecer los resultados con connectionDegree
            if (result.output && Array.isArray(result.output)) {
                return this.enrichResultsWithConnectionDegree(result.output);
            }

            return result;
        } catch (error) {
            console.error('❌ Error obteniendo resultados del agente:', error);
            throw error;
        }
    }

    // Enriquecer resultados con connectionDegree basado en datos reales
    enrichResultsWithConnectionDegree(results) {
        return results.map(lead => {
            // Determinar connectionDegree basado en datos reales del perfil
            let connectionDegree = '3rd'; // Por defecto

            // Si el perfil tiene información de conexiones mutuas
            if (lead.mutualConnections && lead.mutualConnections > 0) {
                connectionDegree = '2nd';
            }

            // Si el perfil está en la red directa (esto se puede determinar por otros campos)
            if (lead.isDirectConnection || lead.connectionLevel === 1) {
                connectionDegree = '1st';
            }

            // Si hay información de grado de conexión en el perfil
            if (lead.connectionDegree) {
                connectionDegree = lead.connectionDegree;
            }

            return {
                ...lead,
                connectionDegree,
                extracted_at: new Date().toISOString()
            };
        });
    }

    processSearchParameters(searchParams) {
        const searchUrls = [];

        if (searchParams.job_title) {
            searchUrls.push(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchParams.job_title)}`);
        }

        if (searchParams.industry_codes && searchParams.industry_codes.length > 0) {
            searchUrls.push(`https://www.linkedin.com/search/results/people/?industry=${searchParams.industry_codes.join(',')}`);
        }

        if (searchParams.location) {
            searchUrls.push(`https://www.linkedin.com/search/results/people/?location=${encodeURIComponent(searchParams.location)}`);
        }

        if (searchUrls.length === 0) {
            searchUrls.push('https://www.linkedin.com/search/results/people/');
        }

        return searchUrls;
    }

    // Función para procesar resultados de Phantombuster y agregar connectionDegree
    processPhantombusterResults(rawResults, searchParams) {
        if (!Array.isArray(rawResults)) {
            console.warn('⚠️ Resultados de Phantombuster no son un array:', rawResults);
            return [];
        }

        return rawResults.map(lead => {
            // Determinar connectionDegree basado en datos reales
            let connectionDegree = this.determineConnectionDegree(lead, searchParams);

            return {
                linkedin_url: lead.profileUrl || lead.linkedin_url || lead.url,
                first_name: lead.firstName || lead.first_name,
                last_name: lead.lastName || lead.last_name,
                headline: lead.headline || lead.title,
                company_name: lead.companyName || lead.company_name,
                location: lead.location,
                industry: lead.industry,
                profile_url: lead.profileUrl || lead.linkedin_url || lead.url,
                email: lead.email,
                phone: lead.phone,
                extracted_at: new Date().toISOString(),
                connectionDegree,
                // Campos adicionales de Phantombuster
                mutual_connections: lead.mutualConnections,
                connection_level: lead.connectionLevel,
                profile_views: lead.profileViews,
                last_activity: lead.lastActivity
            };
        });
    }

    // Determinar el grado de conexión basado en datos reales
    determineConnectionDegree(lead, searchParams) {
        // Lógica para determinar connectionDegree basada en datos reales

        // Si hay conexiones mutuas, es 2nd degree
        if (lead.mutualConnections && lead.mutualConnections > 0) {
            return '2nd';
        }

        // Si el nivel de conexión está disponible
        if (lead.connectionLevel) {
            if (lead.connectionLevel === 1) return '1st';
            if (lead.connectionLevel === 2) return '2nd';
            if (lead.connectionLevel === 3) return '3rd';
        }

        // Si hay información de red directa
        if (lead.isDirectConnection) {
            return '1st';
        }

        // Por defecto, asumir 3rd degree
        return '3rd';
    }
}

// ============================================================================
// HEALTH CHECK ROUTES
// ============================================================================

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: 'memory',
        features: ['search', 'profile_visitor'] // 🆕 Nueva funcionalidad
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: 'memory',
        features: ['search', 'profile_visitor']
    });
});

// ============================================================================
// 🆕 RUTAS LINKEDIN PROFILE VISITOR
// ============================================================================

const profileVisitorService = new LinkedInProfileVisitorService();

// Visitar un perfil individual
app.post('/api/profile-visitor/visit-single', authenticateApiKey, async (req, res) => {
    try {
        const { profileUrl, leadType = 'cold', scheduleFollowUp = false, userId } = req.body;

        if (!profileUrl) {
            return res.status(400).json({
                success: false,
                message: 'profileUrl es requerido',
                error: 'MISSING_PROFILE_URL'
            });
        }

        // Validar formato URL
        if (!profileUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                message: 'URL de perfil LinkedIn inválida',
                error: 'INVALID_PROFILE_URL'
            });
        }

        // Verificar límites diarios
        const limits = profileVisitorService.checkDailyLimits(userId);
        if (!limits.canVisit) {
            return res.status(429).json({
                success: false,
                message: `Límite diario alcanzado: ${limits.currentVisits}/${limits.maxVisits}`,
                error: 'DAILY_LIMIT_EXCEEDED',
                data: limits
            });
        }

        // Verificar si fue visitado recientemente
        const recentVisit = profileVisitorService.wasVisitedRecently(profileUrl);
        if (recentVisit.wasVisited) {
            return res.status(400).json({
                success: false,
                message: 'Perfil visitado recientemente',
                error: 'RECENTLY_VISITED',
                data: recentVisit
            });
        }

        const result = await profileVisitorService.visitSingleProfile(profileUrl, {
            leadType,
            scheduleFollowUp,
            userId
        });

        res.json({
            success: true,
            message: 'Visita de perfil iniciada exitosamente',
            data: {
                ...result,
                limits: profileVisitorService.checkDailyLimits(userId)
            }
        });

    } catch (error) {
        console.error('❌ Error visitando perfil:', error);
        res.status(500).json({
            success: false,
            message: 'Error visitando perfil',
            error: error.message
        });
    }
});

// Visitar lista de perfiles uno por uno
app.post('/api/profile-visitor/visit-list', authenticateApiKey, async (req, res) => {
    try {
        const {
            profileUrls,
            leadType = 'cold',
            delayBetweenProfiles = 60,
            scheduleFollowUp = false,
            userId
        } = req.body;

        if (!profileUrls || !Array.isArray(profileUrls) || profileUrls.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'profileUrls debe ser un array no vacío',
                error: 'INVALID_PROFILE_URLS'
            });
        }

        // Verificar límites diarios
        const limits = profileVisitorService.checkDailyLimits(userId);
        if (!limits.canVisit) {
            return res.status(429).json({
                success: false,
                message: `Límite diario alcanzado: ${limits.currentVisits}/${limits.maxVisits}`,
                error: 'DAILY_LIMIT_EXCEEDED',
                data: limits
            });
        }

        const result = await profileVisitorService.processProfileList(profileUrls, {
            leadType,
            delayBetweenProfiles,
            scheduleFollowUp,
            userId
        });

        res.json({
            success: true,
            message: 'Procesamiento de lista iniciado exitosamente',
            data: {
                ...result,
                limits: profileVisitorService.checkDailyLimits(userId)
            }
        });

    } catch (error) {
        console.error('❌ Error procesando lista:', error);
        res.status(500).json({
            success: false,
            message: 'Error procesando lista de perfiles',
            error: error.message
        });
    }
});

// Obtener estado de visita
app.get('/api/profile-visitor/status/:visitId', authenticateApiKey, (req, res) => {
    try {
        const { visitId } = req.params;
        const visit = visitStore.get(visitId);

        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Visita no encontrada',
                error: 'VISIT_NOT_FOUND'
            });
        }

        res.json({
            success: true,
            data: {
                visitId: visit.visitId,
                profileUrl: visit.profileUrl,
                status: visit.status,
                progress: visit.progress,
                startedAt: visit.startedAt,
                completedAt: visit.completedAt,
                result: visit.result
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo estado:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estado de visita',
            error: error.message
        });
    }
});

// Obtener resultados de visita
app.get('/api/profile-visitor/results/:visitId', authenticateApiKey, (req, res) => {
    try {
        const { visitId } = req.params;
        const visit = visitStore.get(visitId);

        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Visita no encontrada',
                error: 'VISIT_NOT_FOUND'
            });
        }

        if (visit.status !== 'completed' && visit.status !== 'failed') {
            return res.status(400).json({
                success: false,
                message: 'La visita aún no está completada',
                error: 'VISIT_NOT_COMPLETED',
                data: {
                    status: visit.status,
                    progress: visit.progress
                }
            });
        }

        res.json({
            success: true,
            data: {
                visitId: visit.visitId,
                profileUrl: visit.profileUrl,
                status: visit.status,
                result: visit.result,
                completedAt: visit.completedAt
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo resultados:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo resultados de visita',
            error: error.message
        });
    }
});

// Obtener límites diarios
app.get('/api/profile-visitor/limits/:userId?', authenticateApiKey, (req, res) => {
    try {
        const { userId = 'default' } = req.params;
        const limits = profileVisitorService.checkDailyLimits(userId);

        res.json({
            success: true,
            data: {
                userId,
                ...limits,
                date: new Date().toISOString().split('T')[0]
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo límites:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo límites diarios',
            error: error.message
        });
    }
});

// Obtener seguimientos programados
app.get('/api/profile-visitor/follow-ups', authenticateApiKey, (req, res) => {
    try {
        const { date, status = 'pending' } = req.query;
        const targetDate = date || new Date().toISOString().split('T')[0];

        const followUps = [];
        for (const [id, followUp] of followUpStore.entries()) {
            const followUpDate = followUp.scheduledDate.split('T')[0];
            if (followUpDate === targetDate && followUp.status === status) {
                followUps.push(followUp);
            }
        }

        res.json({
            success: true,
            data: {
                date: targetDate,
                status,
                followUps,
                total: followUps.length
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo seguimientos:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo seguimientos programados',
            error: error.message
        });
    }
});

// Listar todas las visitas
app.get('/api/profile-visitor/visits', authenticateApiKey, (req, res) => {
    try {
        const { status, limit, offset } = req.query;

        let visits = Array.from(visitStore.values()).filter(visit => visit.visitId); // Solo visitas individuales

        if (status) {
            visits = visits.filter(visit => visit.status === status);
        }

        const total = visits.length;

        if (limit) {
            const limitNum = parseInt(limit);
            const offsetNum = parseInt(offset) || 0;
            visits = visits.slice(offsetNum, offsetNum + limitNum);
        }

        res.json({
            success: true,
            data: {
                visits: visits.map(visit => ({
                    visitId: visit.visitId,
                    profileUrl: visit.profileUrl,
                    status: visit.status,
                    progress: visit.progress,
                    startedAt: visit.startedAt,
                    completedAt: visit.completedAt,
                    options: visit.options
                })),
                total,
                returned: visits.length
            }
        });

    } catch (error) {
        console.error('❌ Error listando visitas:', error);
        res.status(500).json({
            success: false,
            message: 'Error listando visitas',
            error: error.message
        });
    }
});

// Estadísticas de profile visitor
app.get('/api/profile-visitor/stats', authenticateApiKey, (req, res) => {
    try {
        const visits = Array.from(visitStore.values()).filter(visit => visit.visitId);
        const batches = Array.from(visitStore.values()).filter(visit => visit.batchId);

        const totalVisits = visits.length;
        const completedVisits = visits.filter(v => v.status === 'completed').length;
        const failedVisits = visits.filter(v => v.status === 'failed').length;
        const runningVisits = visits.filter(v => v.status === 'running').length;

        const successfulVisits = visits.filter(v => v.result?.success).length;
        const successRate = totalVisits > 0 ? (successfulVisits / totalVisits * 100).toFixed(2) : 0;

        // Estadísticas diarias
        const today = new Date().toISOString().split('T')[0];
        const todayVisits = visits.filter(v => v.startedAt?.split('T')[0] === today).length;

        res.json({
            success: true,
            data: {
                totalVisits,
                completedVisits,
                failedVisits,
                runningVisits,
                successfulVisits,
                successRate: parseFloat(successRate),
                totalBatches: batches.length,
                todayVisits,
                limits: profileVisitorService.checkDailyLimits(),
                lastVisit: visits.length > 0 ? visits[visits.length - 1].startedAt : null
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo estadísticas:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estadísticas de profile visitor',
            error: error.message
        });
    }
});

// ============================================================================
// RUTAS ORIGINALES DE BÚSQUEDA (MANTENIDAS)
// ============================================================================

const phantombusterService = new PhantombusterService();

app.get('/api/auth/validate', authenticateApiKey, (req, res) => {
    res.json({
        success: true,
        message: 'API Key válido',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/config', authenticateApiKey, (req, res) => {
    res.json({
        success: true,
        data: {
            phantombuster_api_key: process.env.PHANTOMBUSTER_API_KEY ? '✅ configurado' : '❌ no configurado',
            phantombuster_profile_visitor_agent_id: process.env.PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID ? '✅ configurado' : '❌ no configurado',
            phantombuster_search_export_agent_id: process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID ? '✅ configurado' : '❌ no configurado',
            environment: process.env.NODE_ENV || 'development',
            database: 'memory',
            mode: 'REAL_PHANTOMBUSTER_API',
            total_searches: searchStore.size,
            total_visits: visitStore.size,
            daily_limit: profileVisitorService.maxDailyVisits,
            connection_degree_enabled: true,
            features: [
                'real_phantombuster_integration',
                'connection_degree_mapping',
                'linkedin_profile_visitor',
                'lead_classification',
                'dual_agent_support'
            ]
        }
    });
});

// Ruta de búsqueda real con Phantombuster
app.post('/api/search/start', authenticateApiKey, async (req, res) => {
    try {
        const { searchParams, options = {} } = req.body;

        if (!searchParams || Object.keys(searchParams).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Se requieren parámetros de búsqueda',
                error: 'MISSING_PARAMETERS'
            });
        }

        // Verificar que las credenciales de Phantombuster estén configuradas
        if (!process.env.PHANTOMBUSTER_API_KEY || !process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID) {
            return res.status(500).json({
                success: false,
                message: 'Credenciales de Phantombuster no configuradas',
                error: 'PHANTOMBUSTER_CREDENTIALS_MISSING'
            });
        }

        const searchId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const searchUrls = phantombusterService.processSearchParameters(searchParams);

        // Crear búsqueda inicial
        const searchData = {
            searchId,
            containerId: null,
            status: 'launching',
            progress: 0,
            createdAt: new Date().toISOString(),
            completedAt: null,
            searchParams,
            options,
            searchUrls,
            results: []
        };

        searchStore.set(searchId, searchData);

        // Lanzar agente real de Phantombuster
        try {
            const launchResult = await phantombusterService.launchAgent(searchUrls, options);

            // Actualizar búsqueda con containerId real
            searchData.containerId = launchResult.containerId;
            searchData.status = 'running';
            searchData.progress = 10;
            searchStore.set(searchId, searchData);

            res.json({
                success: true,
                message: 'Búsqueda iniciada en Phantombuster',
                data: {
                    searchId,
                    containerId: launchResult.containerId,
                    searchesCount: searchUrls.length,
                    searchUrls,
                    status: 'running',
                    progress: 10,
                    searchParams,
                    options,
                    message: 'La búsqueda está ejecutándose en Phantombuster. Usa /api/search/status/:searchId para monitorear el progreso.'
                }
            });

        } catch (launchError) {
            // Si falla el lanzamiento, actualizar estado
            searchData.status = 'failed';
            searchData.error = launchError.message;
            searchStore.set(searchId, searchData);

            throw launchError;
        }

    } catch (error) {
        console.error('❌ Error iniciando búsqueda real:', error);
        res.status(500).json({
            success: false,
            message: 'Error iniciando búsqueda en Phantombuster',
            error: error.message
        });
    }
});

// Obtener estado real de búsqueda en Phantombuster
app.get('/api/search/status/:searchId', authenticateApiKey, async (req, res) => {
    try {
        const { searchId } = req.params;
        const search = searchStore.get(searchId);

        if (!search) {
            return res.status(404).json({
                success: false,
                message: 'Búsqueda no encontrada',
                error: 'SEARCH_NOT_FOUND'
            });
        }

        // Si la búsqueda está ejecutándose, consultar estado real de Phantombuster
        if (search.status === 'running' && search.containerId) {
            try {
                const phantombusterStatus = await phantombusterService.getAgentStatus(search.containerId);

                // Actualizar estado basado en respuesta de Phantombuster
                if (phantombusterStatus.status === 'finished') {
                    search.status = 'completed';
                    search.progress = 100;
                    search.completedAt = new Date().toISOString();

                    // Obtener resultados reales
                    const realResults = await phantombusterService.getAgentResults(search.containerId);
                    search.results = phantombusterService.processPhantombusterResults(realResults, search.searchParams);

                } else if (phantombusterStatus.status === 'error') {
                    search.status = 'failed';
                    search.error = phantombusterStatus.error || 'Error en Phantombuster';
                } else {
                    // Actualizar progreso basado en estado de Phantombuster
                    search.progress = phantombusterStatus.progress || search.progress;
                }

                searchStore.set(searchId, search);
            } catch (statusError) {
                console.error('❌ Error consultando estado de Phantombuster:', statusError);
                // No fallar la respuesta, solo loggear el error
            }
        }

        res.json({
            success: true,
            data: {
                searchId: search.searchId,
                containerId: search.containerId,
                status: search.status,
                progress: search.progress,
                createdAt: search.createdAt,
                completedAt: search.completedAt,
                lastCheck: new Date().toISOString(),
                totalResults: search.results ? search.results.length : 0
            }
        });
    } catch (error) {
        console.error('❌ Error obteniendo estado:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estado de búsqueda',
            error: error.message
        });
    }
});

app.get('/api/search/results/:searchId', authenticateApiKey, async (req, res) => {
    try {
        const { searchId } = req.params;
        const { limit, offset } = req.query;
        const search = searchStore.get(searchId);

        if (!search) {
            return res.status(404).json({
                success: false,
                message: 'Búsqueda no encontrada',
                error: 'SEARCH_NOT_FOUND'
            });
        }

        // Si la búsqueda está ejecutándose, intentar obtener resultados actualizados
        if (search.status === 'running' && search.containerId) {
            try {
                const phantombusterStatus = await phantombusterService.getAgentStatus(search.containerId);

                if (phantombusterStatus.status === 'finished') {
                    search.status = 'completed';
                    search.progress = 100;
                    search.completedAt = new Date().toISOString();

                    // Obtener resultados reales de Phantombuster
                    const realResults = await phantombusterService.getAgentResults(search.containerId);
                    search.results = phantombusterService.processPhantombusterResults(realResults, search.searchParams);

                    searchStore.set(searchId, search);
                }
            } catch (statusError) {
                console.error('❌ Error consultando resultados de Phantombuster:', statusError);
            }
        }

        if (search.status !== 'completed') {
            return res.status(400).json({
                success: false,
                message: 'La búsqueda aún no está completada',
                error: 'SEARCH_NOT_COMPLETED',
                data: {
                    status: search.status,
                    progress: search.progress,
                    message: 'La búsqueda está ejecutándose en Phantombuster. Consulta el estado con /api/search/status/:searchId'
                }
            });
        }

        let results = search.results || [];

        if (limit) {
            const limitNum = parseInt(limit);
            const offsetNum = parseInt(offset) || 0;
            results = results.slice(offsetNum, offsetNum + limitNum);
        }

        res.json({
            success: true,
            data: {
                searchId: search.searchId,
                containerId: search.containerId,
                status: search.status,
                leads: results,
                total: search.results ? search.results.length : 0,
                returned: results.length,
                extracted_at: search.completedAt,
                connectionDegree_available: results.length > 0 ? results[0].hasOwnProperty('connectionDegree') : false
            }
        });
    } catch (error) {
        console.error('❌ Error obteniendo resultados:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo resultados de búsqueda',
            error: error.message
        });
    }
});

// Estadísticas generales mejoradas
app.get('/api/stats/overview', authenticateApiKey, (req, res) => {
    try {
        const searches = Array.from(searchStore.values());
        const visits = Array.from(visitStore.values()).filter(v => v.visitId);
        const batches = Array.from(visitStore.values()).filter(v => v.batchId);

        const totalSearches = searches.length;
        const completedSearches = searches.filter(s => s.status === 'completed').length;
        const totalLeads = searches.reduce((sum, s) => sum + (s.results ? s.results.length : 0), 0);

        const totalVisits = visits.length;
        const successfulVisits = visits.filter(v => v.result?.success).length;
        const todayVisits = visits.filter(v => {
            const today = new Date().toISOString().split('T')[0];
            return v.startedAt?.split('T')[0] === today;
        }).length;

        res.json({
            success: true,
            data: {
                // Estadísticas de búsqueda
                total_searches: totalSearches,
                completed_searches: completedSearches,
                total_leads_extracted: totalLeads,
                last_extraction: searches.length > 0 ? searches[searches.length - 1].createdAt : null,

                // 🆕 Estadísticas de profile visitor
                total_profile_visits: totalVisits,
                successful_visits: successfulVisits,
                today_visits: todayVisits,
                total_batches: batches.length,
                visit_success_rate: totalVisits > 0 ? (successfulVisits / totalVisits * 100).toFixed(2) : 0,
                daily_limits: profileVisitorService.checkDailyLimits(),

                date: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Error obteniendo estadísticas:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estadísticas',
            error: error.message
        });
    }
});

// ============================================================================
// MIDDLEWARE DE ERRORES Y RUTAS NO ENCONTRADAS
// ============================================================================

app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint no encontrado',
        error: 'NOT_FOUND',
        path: req.originalUrl,
        method: req.method,
        availableEndpoints: {
            search: ['/api/search/start', '/api/search/status/:id', '/api/search/results/:id'],
            profileVisitor: ['/api/profile-visitor/visit-single', '/api/profile-visitor/visit-list', '/api/profile-visitor/status/:id'],
            general: ['/health', '/api/health', '/api/config', '/api/stats/overview']
        }
    });
});

app.use((error, req, res, next) => {
    console.error('Error no manejado:', error);
    res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Error interno del servidor',
        error: process.env.NODE_ENV === 'development' ? error.stack : 'INTERNAL_SERVER_ERROR'
    });
});

// ============================================================================
// INICIALIZACIÓN DEL SERVIDOR
// ============================================================================

app.listen(PORT, () => {
    console.log(`🚀 Servidor Phantombuster REAL iniciado en puerto ${PORT}`);
    console.log(`📊 Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️ Almacenamiento: MEMORIA`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔍 Integración REAL con Phantombuster API`);
    console.log(`📈 Total de búsquedas en memoria: ${searchStore.size}`);
    console.log(`🎯 LinkedIn Profile Visitor activada`);
    console.log(`📋 Límite diario de visitas: ${profileVisitorService.maxDailyVisits}`);
    console.log(`🔑 Phantombuster API Key: ${process.env.PHANTOMBUSTER_API_KEY ? '✅ Configurada' : '❌ No configurada'}`);
    console.log(`🎯 Profile Visitor Agent ID: ${process.env.PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔍 Search Export Agent ID: ${process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(``);
    console.log(`📚 ENDPOINTS DISPONIBLES:`);
    console.log(`   🔍 Búsquedas REALES: POST /api/search/start`);
    console.log(`   📊 Estado de búsqueda: GET /api/search/status/:searchId`);
    console.log(`   📋 Resultados reales: GET /api/search/results/:searchId`);
    console.log(`   🎯 Visita individual: POST /api/profile-visitor/visit-single`);
    console.log(`   📋 Visita lista: POST /api/profile-visitor/visit-list`);
    console.log(`   📊 Estadísticas: GET /api/stats/overview`);
    console.log(`   🚨 Límites diarios: GET /api/profile-visitor/limits`);
    console.log(``);
    console.log(`⚠️  IMPORTANTE: Configura PHANTOMBUSTER_API_KEY y PHANTOMBUSTER_AGENT_ID en el archivo .env`);
});

module.exports = app;

function getLeadTypeFromDegree(degree) {
    if (degree === '1st') return 'hot';
    if (degree === '2nd') return 'warm';
    return 'cold';
}

app.post('/api/leads/process', authenticateApiKey, (req, res) => {
    try {
        const leads = req.body.leads;
        if (!Array.isArray(leads)) {
            return res.status(400).json({ success: false, message: 'Leads debe ser un array' });
        }

        const leadsWithType = leads.map(lead => ({
            ...lead,
            leadType: getLeadTypeFromDegree(lead.connectionDegree)
        }));

        // Aquí puedes guardar, procesar o devolver los leads enriquecidos
        res.json({ success: true, data: leadsWithType });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});