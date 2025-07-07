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

// Búsqueda específica existente
const specificSearch = {
    searchId: 'search_1751839620083_f7eljymfy',
    containerId: 'container_1751839620083_abc123',
    status: 'completed',
    progress: 100,
    createdAt: '2024-01-05T17:00:00.000Z',
    completedAt: '2024-01-05T17:12:00.000Z',
    searchParams: {
        job_title: 'CEO',
        industry_codes: ['4', '6'],
        location: 'San Francisco',
        company_size: '10-50'
    },
    options: {
        numberOfResultsPerSearch: 50,
        numberOfPagesPerSearch: 5,
        removeDuplicateProfiles: true,
        includeEmails: true
    },
    searchUrls: [
        'https://www.linkedin.com/search/results/people/?keywords=CEO',
        'https://www.linkedin.com/search/results/people/?industry=4,6'
    ],
    results: [
        {
            linkedin_url: 'https://linkedin.com/in/john-doe-ceo',
            first_name: 'John',
            last_name: 'Doe',
            headline: 'CEO at TechStartup Inc',
            company_name: 'TechStartup Inc',
            location: 'San Francisco, CA',
            industry: 'Technology',
            profile_url: 'https://linkedin.com/in/john-doe-ceo',
            email: 'john.doe@techstartup.com',
            phone: '+1 (415) 555-0101',
            extracted_at: '2024-01-05T17:12:00.000Z'
        }
        // ... más resultados
    ]
};

searchStore.set('search_1751839620083_f7eljymfy', specificSearch);

// ============================================================================
// 🆕 SERVICIO LINKEDIN PROFILE VISITOR
// ============================================================================

class LinkedInProfileVisitorService {
    constructor() {
        this.apiKey = process.env.PHANTOMBUSTER_API_KEY;
        this.agentId = process.env.PHANTOMBUSTER_AGENT_ID;
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
// SERVICIO PHANTOMBUSTER ORIGINAL (BÚSQUEDAS)
// ============================================================================

class PhantombusterService {
    constructor() {
        this.apiKey = process.env.PHANTOMBUSTER_API_KEY;
        this.agentId = process.env.PHANTOMBUSTER_AGENT_ID;
        this.baseUrl = 'https://api.phantombuster.com/api/v2';
    }

    async launchAgent(searchUrls, options = {}) {
        try {
            const containerId = `container_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            console.log('🚀 Lanzando agente Phantombuster...');
            console.log('📋 URLs de búsqueda:', searchUrls);
            console.log('⚙️ Opciones:', options);

            return {
                containerId,
                status: 'launched',
                message: 'Agente lanzado exitosamente'
            };
        } catch (error) {
            console.error('❌ Error lanzando agente:', error);
            throw error;
        }
    }

    processSearchParameters(searchParams) {
        const searchUrls = [];

        if (searchParams.job_title) {
            searchUrls.push(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchParams.job_title)}`);
        }

        if (searchParams.industry_codes && searchParams.industry_codes.length > 0) {
            searchUrls.push(`https://www.linkedin.com/search/results/people/?industry=${searchParams.industry_codes.join(',')}`);
        }

        if (searchUrls.length === 0) {
            searchUrls.push('https://www.linkedin.com/search/results/people/');
        }

        return searchUrls;
    }

    generateSimulatedResults(searchParams, options) {
        // ... (mantener código original de simulación)
        const numberOfResults = options.numberOfResultsPerSearch || 100;
        const results = [];

        // Código de simulación simplificado
        for (let i = 0; i < numberOfResults; i++) {
            const firstName = ['Juan', 'María', 'Carlos', 'Ana'][Math.floor(Math.random() * 4)];
            const lastName = ['García', 'Rodríguez', 'López', 'Martínez'][Math.floor(Math.random() * 4)];

            results.push({
                linkedin_url: `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-${i}`,
                first_name: firstName,
                last_name: lastName,
                headline: `Professional at Company ${i}`,
                company_name: `Company ${i}`,
                location: 'Madrid, Spain',
                industry: 'Technology',
                profile_url: `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-${i}`,
                email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@company${i}.com`,
                phone: `+34 ${Math.floor(Math.random() * 900) + 100} ${Math.floor(Math.random() * 900) + 100} ${Math.floor(Math.random() * 900) + 100}`,
                extracted_at: new Date().toISOString()
            });
        }

        return results;
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
            phantombuster_api_key: process.env.PHANTOMBUSTER_API_KEY ? 'configurado' : 'no configurado',
            phantombuster_agent_id: process.env.PHANTOMBUSTER_AGENT_ID || 'no configurado',
            environment: process.env.NODE_ENV || 'development',
            database: 'memory',
            total_searches: searchStore.size,
            total_visits: visitStore.size, // 🆕
            daily_limit: profileVisitorService.maxDailyVisits // 🆕
        }
    });
});

// Ruta de búsqueda original (simplificada para espacio)
app.post('/api/search/start', authenticateApiKey, (req, res) => {
    try {
        const { searchParams, options = {} } = req.body;

        if (!searchParams || Object.keys(searchParams).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Se requieren parámetros de búsqueda',
                error: 'MISSING_PARAMETERS'
            });
        }

        const searchId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const searchUrls = phantombusterService.processSearchParameters(searchParams);
        const simulatedResults = phantombusterService.generateSimulatedResults(searchParams, options);

        const searchData = {
            searchId,
            containerId: `container_${Date.now()}`,
            status: 'completed',
            progress: 100,
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            searchParams,
            options,
            searchUrls,
            results: simulatedResults
        };

        searchStore.set(searchId, searchData);

        res.json({
            success: true,
            message: 'Extracción completada exitosamente',
            data: {
                searchId,
                containerId: searchData.containerId,
                searchesCount: searchUrls.length,
                searchUrls,
                status: 'completed',
                progress: 100,
                totalResults: simulatedResults.length,
                searchParams,
                options
            }
        });
    } catch (error) {
        console.error('❌ Error iniciando extracción:', error);
        res.status(500).json({
            success: false,
            message: 'Error iniciando extracción',
            error: error.message
        });
    }
});

// Mantener otras rutas de búsqueda existentes...
app.get('/api/search/status/:searchId', authenticateApiKey, (req, res) => {
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
                lastCheck: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Error obteniendo estado:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estado de extracción',
            error: error.message
        });
    }
});

app.get('/api/search/results/:searchId', authenticateApiKey, (req, res) => {
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

        if (search.status !== 'completed') {
            return res.status(400).json({
                success: false,
                message: 'La búsqueda aún no está completada',
                error: 'SEARCH_NOT_COMPLETED',
                data: {
                    status: search.status,
                    progress: search.progress
                }
            });
        }

        let results = search.results;

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
                total: search.results.length,
                returned: results.length,
                extracted_at: search.completedAt
            }
        });
    } catch (error) {
        console.error('❌ Error obteniendo resultados:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo resultados de extracción',
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
    console.log(`🚀 Servidor enhanced iniciado en puerto ${PORT}`);
    console.log(`📊 Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️ Almacenamiento: MEMORIA`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔍 Búsqueda específica disponible: search_1751839620083_f7eljymfy`);
    console.log(`📈 Total de búsquedas en memoria: ${searchStore.size}`);
    console.log(`🎯 Nueva funcionalidad: LinkedIn Profile Visitor activada`);
    console.log(`📋 Límite diario de visitas: ${profileVisitorService.maxDailyVisits}`);
    console.log(``);
    console.log(`📚 ENDPOINTS DISPONIBLES:`);
    console.log(`   🔍 Búsquedas: POST /api/search/start`);
    console.log(`   🎯 Visita individual: POST /api/profile-visitor/visit-single`);
    console.log(`   📋 Visita lista: POST /api/profile-visitor/visit-list`);
    console.log(`   📊 Estadísticas: GET /api/stats/overview`);
    console.log(`   🚨 Límites diarios: GET /api/profile-visitor/limits`);
});

module.exports = app;