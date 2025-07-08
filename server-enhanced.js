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

// ============================================================================
// SERVICIO LINKEDIN PROFILE VISITOR
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
// SERVICIO PHANTOMBUSTER (BÚSQUEDAS)
// ============================================================================

class PhantombusterService {
    constructor() {
        this.apiKey = process.env.PHANTOMBUSTER_API_KEY;
        this.searchAgentId = process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID;
        this.profileVisitorAgentId = process.env.PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID;
        this.baseUrl = 'https://api.phantombuster.com/api/v2';
    }

    // ✅ MÉTODO CORREGIDO PARA BÚSQUEDAS
    async launchSearchAgent(searchUrls, options = {}) {
        try {
            if (!this.apiKey || !this.searchAgentId) {
                throw new Error('API Key y Search Agent ID de Phantombuster son requeridos');
            }

            const containerId = `container_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            console.log('🚀 Lanzando LinkedIn Search Export...');
            console.log('📋 URLs de búsqueda:', searchUrls);

            // ✅ CONFIGURACIÓN CORRECTA según la documentación oficial
            const agentArguments = {
                // Tipo de búsqueda - usar 'linkedInSearchUrl' para URLs de LinkedIn
                searchType: 'linkedInSearchUrl',

                // URL de búsqueda de LinkedIn (primera URL)
                linkedInSearchUrl: searchUrls[0],

                // Si hay múltiples URLs, usar spreadsheet
                ...(searchUrls.length > 1 && {
                    searchType: 'spreadsheetUrl',
                    search: this.createSpreadsheetFromUrls(searchUrls)
                }),

                // Configuración de resultados
                numberOfResultsPerLaunch: options.numberOfResultsPerLaunch || 1000,
                numberOfResultsPerSearch: options.numberOfResultsPerSearch || 1000,

                // Categoría (People es la más común)
                category: 'People',

                // Grados de conexión a extraer
                connectionDegreesToScrape: ['2', '3+'],

                // Enriquecimiento de leads
                enrichLeadsWithAdditionalInformation: true,

                // Eliminar duplicados
                removeDuplicateProfiles: options.removeDuplicateProfiles || true,

                // ✅ CREDENCIALES DE LINKEDIN (REQUERIDAS)
                sessionCookie: process.env.LINKEDIN_SESSION_COOKIE,
                userAgent: process.env.LINKEDIN_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
            };

            // Validar credenciales de LinkedIn
            if (!agentArguments.sessionCookie) {
                throw new Error('LINKEDIN_SESSION_COOKIE es requerido para usar el agente');
            }

            console.log('⚙️ Argumentos del agente:', JSON.stringify(agentArguments, null, 2));

            // ✅ LLAMADA CORRECTA A LA API
            const response = await fetch(`${this.baseUrl}/agents/launch`, {
                method: 'POST',
                headers: {
                    'X-Phantombuster-Key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: this.searchAgentId, // ✅ Usar Agent ID correcto
                    argument: agentArguments  // ✅ Pasar objeto directamente, no stringify
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Error de Phantombuster API: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const result = await response.json();

            return {
                containerId: result.containerId || containerId,
                status: 'launched',
                message: 'LinkedIn Search Export lanzado exitosamente',
                phantombusterResult: result
            };

        } catch (error) {
            console.error('❌ Error lanzando LinkedIn Search Export:', error);
            throw error;
        }
    }

    // ✅ MÉTODO CORREGIDO PARA PROFILE VISITOR
    async launchProfileVisitor(profileUrls, options = {}) {
        try {
            if (!this.apiKey || !this.profileVisitorAgentId) {
                throw new Error('API Key y Profile Visitor Agent ID de Phantombuster son requeridos');
            }

            console.log('🎯 Lanzando LinkedIn Profile Visitor...');
            console.log('👥 Perfiles a visitar:', profileUrls);

            // ✅ CONFIGURACIÓN CORRECTA para Profile Visitor
            const agentArguments = {
                // URLs de perfiles (puede ser string único o array)
                ...(Array.isArray(profileUrls)
                    ? { spreadsheetUrl: this.createSpreadsheetFromUrls(profileUrls) }
                    : { profileUrls: profileUrls }
                ),

                // Número de perfiles por lanzamiento (máximo recomendado: 80)
                numberOfAddsPerLaunch: Math.min(options.numberOfAddsPerLaunch || 10, 80),

                // Configuración de comportamiento
                dwellTime: options.dwellTime || false, // Simular tiempo de permanencia

                // Servicios de email discovery
                emailChooser: options.emailChooser || 'phantombuster',

                // Screenshots y datos adicionales
                saveImg: options.saveImg || false,
                takeScreenshot: options.takeScreenshot || false,
                scrapeInterests: options.scrapeInterests || false,
                scrapeAccomplishments: options.scrapeAccomplishments || false,

                // ✅ CREDENCIALES DE LINKEDIN (REQUERIDAS)
                sessionCookie: process.env.LINKEDIN_SESSION_COOKIE,
                userAgent: process.env.LINKEDIN_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
            };

            // Validar credenciales
            if (!agentArguments.sessionCookie) {
                throw new Error('LINKEDIN_SESSION_COOKIE es requerido para usar el agente');
            }

            const response = await fetch(`${this.baseUrl}/agents/launch`, {
                method: 'POST',
                headers: {
                    'X-Phantombuster-Key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: this.profileVisitorAgentId, // ✅ Usar Agent ID correcto
                    argument: agentArguments
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Error de Phantombuster API: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const result = await response.json();

            return {
                containerId: result.containerId,
                status: 'launched',
                message: 'LinkedIn Profile Visitor lanzado exitosamente',
                phantombusterResult: result
            };

        } catch (error) {
            console.error('❌ Error lanzando Profile Visitor:', error);
            throw error;
        }
    }

    // ✅ MÉTODO PARA CREAR SPREADSHEET TEMPORAL
    createSpreadsheetFromUrls(urls) {
        // En un entorno real, necesitarías crear un Google Sheet o CSV público
        // Por ahora, retornamos la primera URL y logeamos el resto
        console.log('⚠️ Múltiples URLs detectadas. Usando la primera:', urls[0]);
        console.log('📝 URLs adicionales (crear spreadsheet):', urls.slice(1));
        return urls[0];
    }

    // ✅ MÉTODO CORREGIDO PARA OBTENER ESTADO
    async getAgentStatus(containerId, agentType = 'search') {
        try {
            const agentId = agentType === 'search' ? this.searchAgentId : this.profileVisitorAgentId;

            const response = await fetch(`${this.baseUrl}/agents/fetch-output?id=${agentId}&containerId=${containerId}`, {
                headers: {
                    'X-Phantombuster-Key': this.apiKey
                }
            });

            if (!response.ok) {
                throw new Error(`Error obteniendo estado: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('❌ Error obteniendo estado del agente:', error);
            throw error;
        }
    }

    // ✅ MÉTODO PARA PROCESAR PARÁMETROS DE BÚSQUEDA
    processSearchParameters(searchParams) {
        const searchUrls = [];

        // Construir URLs de búsqueda de LinkedIn basadas en parámetros
        let baseUrl = 'https://www.linkedin.com/search/results/people/?';
        const params = new URLSearchParams();

        if (searchParams.job_title) {
            params.append('keywords', searchParams.job_title);
        }

        if (searchParams.location) {
            // LinkedIn usa geoUrn para ubicaciones específicas
            params.append('geoUrn', `["102174003"]`); // Ejemplo para Francia
        }

        if (searchParams.industry_codes && searchParams.industry_codes.length > 0) {
            // LinkedIn usa industryCompanyUrn para industrias
            const industryUrns = searchParams.industry_codes.map(code => `"${code}"`);
            params.append('industryCompanyUrn', `[${industryUrns.join(',')}]`);
        }

        // Agregar filtros de conexión por defecto
        params.append('network', '["S","O"]'); // 2nd y 3rd+ connections

        const finalUrl = baseUrl + params.toString();
        searchUrls.push(finalUrl);

        console.log('🔍 URL de búsqueda generada:', finalUrl);

        return searchUrls;
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

// ============================================================================
// ENDPOINTS DE BÚSQUEDA (LinkedIn Search Export)
// ============================================================================

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
        if (!process.env.PHANTOMBUSTER_API_KEY || !process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID || !process.env.PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID) {
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
            const launchResult = await phantombusterService.launchSearchAgent(searchUrls, options);

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

// Endpoint para obtener historial de búsquedas
app.get('/api/search/history', authenticateApiKey, async (req, res) => {
    try {
        const { limit = 50, offset = 0, status } = req.query;

        // Obtener todas las búsquedas del store
        const allSearches = [];
        for (const [searchId, search] of searchStore.entries()) {
            allSearches.push({
                searchId: search.searchId,
                containerId: search.containerId,
                status: search.status,
                progress: search.progress,
                createdAt: search.createdAt,
                completedAt: search.completedAt,
                searchParams: search.searchParams,
                totalResults: search.results ? search.results.length : 0,
                keywords: search.searchParams?.job_title || 'N/A',
                location: search.searchParams?.location || 'N/A'
            });
        }

        // Filtrar por status si se especifica
        let filteredSearches = allSearches;
        if (status) {
            filteredSearches = allSearches.filter(search => search.status === status);
        }

        // Ordenar por fecha de creación (más recientes primero)
        filteredSearches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Aplicar paginación
        const total = filteredSearches.length;
        const paginatedSearches = filteredSearches.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

        res.json({
            success: true,
            data: {
                searches: paginatedSearches,
                pagination: {
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: parseInt(offset) + parseInt(limit) < total
                },
                summary: {
                    totalSearches: allSearches.length,
                    completedSearches: allSearches.filter(s => s.status === 'completed').length,
                    runningSearches: allSearches.filter(s => s.status === 'running').length,
                    failedSearches: allSearches.filter(s => s.status === 'failed').length,
                    totalResults: allSearches.reduce((sum, s) => sum + s.totalResults, 0)
                }
            }
        });
    } catch (error) {
        console.error('❌ Error obteniendo historial:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo historial de búsquedas',
            error: error.message
        });
    }
});

// Endpoint para obtener detalles de una búsqueda específica
app.get('/api/search/details/:searchId', authenticateApiKey, async (req, res) => {
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

        res.json({
            success: true,
            data: {
                searchId: search.searchId,
                containerId: search.containerId,
                status: search.status,
                progress: search.progress,
                createdAt: search.createdAt,
                completedAt: search.completedAt,
                searchParams: search.searchParams,
                totalResults: search.results ? search.results.length : 0,
                keywords: search.searchParams?.job_title || 'N/A',
                location: search.searchParams?.location || 'N/A',
                industryCodes: search.searchParams?.industry_codes || [],
                connectionDegree: search.searchParams?.connection_degree || [],
                resultsPerLaunch: search.searchParams?.results_per_launch || 0,
                totalResultsRequested: search.searchParams?.total_results || 0
            }
        });
    } catch (error) {
        console.error('❌ Error obteniendo detalles:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo detalles de búsqueda',
            error: error.message
        });
    }
});

// ============================================================================
// ENDPOINTS DE PROFILE VISITOR (LinkedIn Profile Visitor)
// ============================================================================

// Visitar perfil individual
app.post('/api/profile-visitor/visit-single', authenticateApiKey, async (req, res) => {
    try {
        const { profileUrl, options = {} } = req.body;

        if (!profileUrl) {
            return res.status(400).json({
                success: false,
                message: 'URL de perfil es requerida',
                error: 'MISSING_PROFILE_URL'
            });
        }

        console.log('🎯 Visitando perfil individual:', profileUrl);

        // Lanzar Profile Visitor
        const launchResult = await phantombusterService.launchProfileVisitor(profileUrl, options);

        res.json({
            success: true,
            message: 'Visita de perfil iniciada',
            data: {
                visitId: `visit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                containerId: launchResult.containerId,
                profileUrl,
                status: 'launched',
                options
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

// Visitar lista de perfiles
app.post('/api/profile-visitor/visit-list', authenticateApiKey, async (req, res) => {
    try {
        const { profileUrls, options = {} } = req.body;

        if (!profileUrls || !Array.isArray(profileUrls) || profileUrls.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Lista de URLs de perfiles es requerida',
                error: 'MISSING_PROFILE_URLS'
            });
        }

        console.log('🎯 Visitando lista de perfiles:', profileUrls.length, 'perfiles');

        // Lanzar Profile Visitor
        const launchResult = await phantombusterService.launchProfileVisitor(profileUrls, options);

        res.json({
            success: true,
            message: 'Visita de perfiles iniciada',
            data: {
                visitId: `visit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                containerId: launchResult.containerId,
                profileCount: profileUrls.length,
                profileUrls,
                status: 'launched',
                options
            }
        });

    } catch (error) {
        console.error('❌ Error visitando perfiles:', error);
        res.status(500).json({
            success: false,
            message: 'Error visitando perfiles',
            error: error.message
        });
    }
});

// Estado de visita
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
            data: visit
        });

    } catch (error) {
        console.error('❌ Error obteniendo estado de visita:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estado de visita',
            error: error.message
        });
    }
});

// Límites diarios
app.get('/api/profile-visitor/limits', authenticateApiKey, (req, res) => {
    try {
        const limits = profileVisitorService.checkDailyLimits();

        res.json({
            success: true,
            data: limits
        });

    } catch (error) {
        console.error('❌ Error obteniendo límites:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo límites',
            error: error.message
        });
    }
});

// ============================================================================
// ESTADÍSTICAS Y MONITOREO
// ============================================================================

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

// Endpoint para verificar estado de un container específico
app.get('/api/agents/status/:agentId/:containerId', async (req, res) => {
    try {
        const { agentId, containerId } = req.params;

        const response = await fetch(`https://api.phantombuster.com/api/v2/agents/fetch-output?id=${agentId}&containerId=${containerId}`, {
            headers: {
                'X-Phantombuster-Key': process.env.PHANTOMBUSTER_API_KEY
            }
        });

        const data = await response.json();

        res.json({
            success: true,
            agentId,
            containerId,
            status: data.status,
            isRunning: data.isAgentRunning,
            progress: data.progress || 0,
            output: data.output,
            lastUpdate: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error checking agent status:', error);
        res.status(500).json({
            success: false,
            error: 'Error checking agent status',
            details: error.message
        });
    }
});

// Endpoint para listar todos los agentes
app.get('/api/agents/list', async (req, res) => {
    try {
        const response = await fetch('https://api.phantombuster.com/api/v2/agents/fetch-all', {
            headers: {
                'X-Phantombuster-Key': process.env.PHANTOMBUSTER_API_KEY
            }
        });

        const agents = await response.json();

        // Filtrar solo nuestros agentes
        const ourAgents = agents.filter(agent =>
            agent.id === process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID ||
            agent.id === process.env.PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID
        );

        res.json({
            success: true,
            agents: ourAgents.map(agent => ({
                id: agent.id,
                name: agent.name,
                type: agent.id === process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID ? 'search' : 'visitor',
                isRunning: agent.isRunning,
                lastLaunch: agent.lastLaunch,
                lastLaunchAt: agent.lastLaunchAt
            }))
        });
    } catch (error) {
        console.error('Error listing agents:', error);
        res.status(500).json({
            success: false,
            error: 'Error listing agents',
            details: error.message
        });
    }
});

// Endpoint para obtener detalles de un agente específico
app.get('/api/agents/details/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;

        const response = await fetch(`https://api.phantombuster.com/api/v2/agents/fetch?id=${agentId}`, {
            headers: {
                'X-Phantombuster-Key': process.env.PHANTOMBUSTER_API_KEY
            }
        });

        const agent = await response.json();

        res.json({
            success: true,
            agent: {
                id: agent.id,
                name: agent.name,
                type: agent.id === process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID ? 'search' : 'visitor',
                isRunning: agent.isRunning,
                lastLaunch: agent.lastLaunch,
                lastLaunchAt: agent.lastLaunchAt,
                status: agent.status,
                createdAt: agent.createdAt,
                updatedAt: agent.updatedAt
            }
        });
    } catch (error) {
        console.error('Error getting agent details:', error);
        res.status(500).json({
            success: false,
            error: 'Error getting agent details',
            details: error.message
        });
    }
});

// Endpoint para monitoreo en tiempo real (WebSocket-like polling)
app.get('/api/agents/monitor', async (req, res) => {
    try {
        const { agentId, containerId } = req.query;

        if (!agentId || !containerId) {
            return res.status(400).json({
                success: false,
                error: 'agentId and containerId are required'
            });
        }

        const response = await fetch(`https://api.phantombuster.com/api/v2/agents/fetch-output?id=${agentId}&containerId=${containerId}`, {
            headers: {
                'X-Phantombuster-Key': process.env.PHANTOMBUSTER_API_KEY
            }
        });

        const data = await response.json();

        // Determinar el tipo de agente
        const agentType = agentId === process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID ? 'search' : 'visitor';

        res.json({
            success: true,
            monitoring: {
                agentId,
                agentType,
                containerId,
                status: data.status,
                isRunning: data.isAgentRunning,
                progress: data.progress || 0,
                output: data.output,
                lastUpdate: new Date().toISOString(),
                canSoftAbort: data.canSoftAbort || false
            }
        });
    } catch (error) {
        console.error('Error monitoring agent:', error);
        res.status(500).json({
            success: false,
            error: 'Error monitoring agent',
            details: error.message
        });
    }
});

// Endpoint para obtener historial de búsquedas desde Phantombuster
app.get('/api/search/phantombuster-history', authenticateApiKey, async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        // Obtener información del agente desde Phantombuster
        const agentResponse = await fetch(`https://api.phantombuster.com/api/v2/agents/fetch?id=${process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID}`, {
            headers: {
                'X-Phantombuster-Key': process.env.PHANTOMBUSTER_API_KEY
            }
        });

        const agentData = await agentResponse.json();

        // Obtener las últimas ejecuciones
        const recentContainers = [];

        // Intentar obtener información de las últimas ejecuciones
        // Nota: Phantombuster no proporciona un endpoint directo para historial
        // pero podemos usar el estado actual del agente

        res.json({
            success: true,
            data: {
                agent: {
                    id: agentData.id,
                    name: agentData.name,
                    status: agentData.status,
                    lastLaunch: agentData.lastLaunch,
                    lastLaunchAt: agentData.lastLaunchAt
                },
                recentExecutions: recentContainers,
                message: "Para obtener el historial completo, consulta el panel de Phantombuster directamente"
            }
        });
    } catch (error) {
        console.error('❌ Error obteniendo historial de Phantombuster:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo historial de Phantombuster',
            error: error.message
        });
    }
});

// Endpoint para obtener información de un container específico
app.get('/api/search/container/:containerId', authenticateApiKey, async (req, res) => {
    try {
        const { containerId } = req.params;

        const response = await fetch(`https://api.phantombuster.com/api/v2/agents/fetch-output?id=${process.env.PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID}&containerId=${containerId}`, {
            headers: {
                'X-Phantombuster-Key': process.env.PHANTOMBUSTER_API_KEY
            }
        });

        const data = await response.json();

        // Extraer información relevante del output
        const outputLines = data.output ? data.output.split('\r\n') : [];
        const keywords = outputLines.find(line => line.includes('Input:'))?.replace('[info_]ℹ️ Input:', '').trim();
        const totalResults = outputLines.find(line => line.includes('Total results count:'))?.match(/\d+/)?.[0];
        const resultsFound = outputLines.find(line => line.includes('Got') && line.includes('profiles'))?.match(/\d+/)?.[0];

        res.json({
            success: true,
            data: {
                containerId: data.containerId,
                status: data.status,
                isRunning: data.isAgentRunning,
                progress: data.progress || 0,
                keywords: keywords || 'N/A',
                totalResults: totalResults || 0,
                resultsFound: resultsFound || 0,
                startedAt: data.mostRecentEndedAt ? new Date(data.mostRecentEndedAt).toISOString() : null,
                output: data.output,
                canSoftAbort: data.canSoftAbort || false
            }
        });
    } catch (error) {
        console.error('❌ Error obteniendo información del container:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo información del container',
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