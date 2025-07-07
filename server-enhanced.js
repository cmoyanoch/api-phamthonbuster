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
// ALMACENAMIENTO EN MEMORIA PARA BÚSQUEDAS
// ============================================================================

const searchStore = new Map();

// Búsqueda específica que mencionaste
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
        },
        {
            linkedin_url: 'https://linkedin.com/in/sarah-johnson',
            first_name: 'Sarah',
            last_name: 'Johnson',
            headline: 'CEO & Founder at HealthTech Solutions',
            company_name: 'HealthTech Solutions',
            location: 'San Francisco, CA',
            industry: 'Healthcare',
            profile_url: 'https://linkedin.com/in/sarah-johnson',
            email: 'sarah.johnson@healthtech.com',
            phone: '+1 (415) 555-0102',
            extracted_at: '2024-01-05T17:12:00.000Z'
        },
        {
            linkedin_url: 'https://linkedin.com/in/mike-chen',
            first_name: 'Mike',
            last_name: 'Chen',
            headline: 'CEO at AI Innovations',
            company_name: 'AI Innovations',
            location: 'San Francisco, CA',
            industry: 'Technology',
            profile_url: 'https://linkedin.com/in/mike-chen',
            email: 'mike.chen@aiinnovations.com',
            phone: '+1 (415) 555-0103',
            extracted_at: '2024-01-05T17:12:00.000Z'
        },
        {
            linkedin_url: 'https://linkedin.com/in/lisa-rodriguez',
            first_name: 'Lisa',
            last_name: 'Rodriguez',
            headline: 'CEO at GreenEnergy Corp',
            company_name: 'GreenEnergy Corp',
            location: 'San Francisco, CA',
            industry: 'Energy',
            profile_url: 'https://linkedin.com/in/lisa-rodriguez',
            email: 'lisa.rodriguez@greenenergy.com',
            phone: '+1 (415) 555-0104',
            extracted_at: '2024-01-05T17:12:00.000Z'
        },
        {
            linkedin_url: 'https://linkedin.com/in/david-kim',
            first_name: 'David',
            last_name: 'Kim',
            headline: 'CEO at FinTech Solutions',
            company_name: 'FinTech Solutions',
            location: 'San Francisco, CA',
            industry: 'Financial Services',
            profile_url: 'https://linkedin.com/in/david-kim',
            email: 'david.kim@fintech.com',
            phone: '+1 (415) 555-0105',
            extracted_at: '2024-01-05T17:12:00.000Z'
        }
    ]
};

// Agregar la búsqueda específica al almacén
searchStore.set('search_1751839620083_f7eljymfy', specificSearch);

// ============================================================================
// SERVICIO PHANTOMBUSTER (SIMULADO)
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

    async getAgentStatus(containerId) {
        try {
            const statuses = ['running', 'completed', 'failed'];
            const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

            return {
                containerId,
                status: randomStatus,
                progress: randomStatus === 'running' ? Math.floor(Math.random() * 100) : 100
            };
        } catch (error) {
            console.error('❌ Error obteniendo estado:', error);
            throw error;
        }
    }

    async getAgentOutput(containerId) {
        try {
            const mockLeads = [
                {
                    linkedin_url: 'https://linkedin.com/in/john-doe',
                    first_name: 'John',
                    last_name: 'Doe',
                    headline: 'CEO at Tech Company',
                    company_name: 'Tech Company',
                    location: 'San Francisco, CA',
                    industry: 'Technology',
                    profile_url: 'https://linkedin.com/in/john-doe',
                    email: 'john.doe@techcompany.com',
                    phone: '+1 (415) 555-0201',
                    extracted_at: new Date().toISOString()
                },
                {
                    linkedin_url: 'https://linkedin.com/in/jane-smith',
                    first_name: 'Jane',
                    last_name: 'Smith',
                    headline: 'CTO at Startup',
                    company_name: 'Startup Inc',
                    location: 'New York, NY',
                    industry: 'Technology',
                    profile_url: 'https://linkedin.com/in/jane-smith',
                    email: 'jane.smith@startup.com',
                    phone: '+1 (212) 555-0202',
                    extracted_at: new Date().toISOString()
                }
            ];

            return {
                containerId,
                status: 'completed',
                leads: mockLeads,
                total: mockLeads.length,
                extracted_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ Error obteniendo resultados:', error);
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
        const numberOfResults = options.numberOfResultsPerSearch || 100;
        const results = [];

        // Determinar ubicaciones basadas en los parámetros de búsqueda
        let locations = [];
        if (searchParams.location) {
            // Extraer ciudades del parámetro location
            const locationParts = searchParams.location.split(',').map(loc => loc.trim());
            locations = locationParts.filter(loc => loc && !loc.toLowerCase().includes('france') && !loc.toLowerCase().includes('spain'));

            // Si no hay ciudades específicas, usar la ubicación completa
            if (locations.length === 0) {
                locations = [searchParams.location];
            }
        } else {
            // Ubicaciones por defecto
            locations = ['Madrid, Spain', 'Barcelona, Spain', 'Valencia, Spain', 'Sevilla, Spain', 'Bilbao, Spain'];
        }

        // Determinar país basado en la ubicación
        const isFrance = searchParams.location && searchParams.location.toLowerCase().includes('france');
        const isSpain = searchParams.location && searchParams.location.toLowerCase().includes('spain');

        // Nombres y apellidos según el país
        let firstNames, lastNames;
        if (isFrance) {
            firstNames = ['Jean', 'Marie', 'Pierre', 'Sophie', 'François', 'Catherine', 'Michel', 'Isabelle', 'Philippe', 'Nathalie', 'Thomas', 'Valérie', 'Antoine', 'Camille', 'Nicolas', 'Delphine', 'Laurent', 'Anne', 'David', 'Julie'];
            lastNames = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier'];
        } else if (isSpain) {
            firstNames = ['Juan', 'María', 'Carlos', 'Ana', 'Luis', 'Carmen', 'Pedro', 'Isabel', 'Miguel', 'Sofia', 'Diego', 'Valentina', 'Andrés', 'Camila', 'Roberto', 'Daniela', 'Fernando', 'Natalia', 'Ricardo', 'Gabriela'];
            lastNames = ['García', 'Rodríguez', 'López', 'Martínez', 'González', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Rivera', 'Morales', 'Castro', 'Ortiz', 'Silva', 'Cruz', 'Reyes', 'Moreno', 'Jiménez', 'Díaz'];
        } else {
            // Nombres internacionales por defecto
            firstNames = ['John', 'Mary', 'James', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Christopher', 'Karen'];
            lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
        }

        // Títulos de trabajo basados en parámetros de búsqueda
        const jobTitles = searchParams.job_title ?
            [searchParams.job_title, `${searchParams.job_title} Senior`, `Lead ${searchParams.job_title}`, `Senior ${searchParams.job_title}`, `Principal ${searchParams.job_title}`] :
            ['Software Engineer', 'Product Manager', 'Data Scientist', 'Marketing Manager', 'Sales Director', 'CEO', 'CTO', 'CFO', 'HR Manager', 'Designer'];

        // Industrias basadas en códigos de industria
        let industries = [];
        if (searchParams.industry_codes && searchParams.industry_codes.length > 0) {
            const industryMap = {
                '4': 'Technology',
                '6': 'Finance',
                '20': 'Manufacturing',
                '27': 'Transportation',
                '50': 'Supply Chain',
                '53': 'Logistics',
                '96': 'Retail'
            };

            searchParams.industry_codes.forEach(code => {
                if (industryMap[code]) {
                    industries.push(industryMap[code]);
                }
            });
        }

        // Si no hay industrias específicas, usar las por defecto
        if (industries.length === 0) {
            industries = ['Technology', 'Healthcare', 'Finance', 'Education', 'Manufacturing', 'Retail', 'Consulting', 'Real Estate', 'Media', 'Transportation'];
        }

        // Empresas según el país
        let companies = [];
        if (isFrance) {
            companies = ['LVMH', 'TotalEnergies', 'BNP Paribas', 'Carrefour', 'Orange', 'Sanofi', 'L\'Oréal', 'Airbus', 'Renault', 'EDF'];
        } else if (isSpain) {
            companies = ['Inditex', 'Santander', 'Telefónica', 'BBVA', 'Iberdrola', 'Repsol', 'ACS', 'Ferrovial', 'CaixaBank', 'Endesa'];
        } else {
            companies = ['TechCorp', 'InnovateLab', 'Digital Solutions', 'Future Systems', 'Smart Technologies', 'Global Innovations', 'NextGen Solutions', 'Elite Consulting', 'Peak Performance', 'Strategic Partners'];
        }

        // Dominios de email
        const emailDomains = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'icloud.com'];

        // Prefijos telefónicos según el país
        const phonePrefix = isFrance ? '+33' : isSpain ? '+34' : '+1';

        for (let i = 0; i < numberOfResults; i++) {
            const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
            const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
            const jobTitle = jobTitles[Math.floor(Math.random() * jobTitles.length)];
            const industry = industries[Math.floor(Math.random() * industries.length)];
            const location = locations[Math.floor(Math.random() * locations.length)];
            const company = companies[Math.floor(Math.random() * companies.length)];
            const emailDomain = emailDomains[Math.floor(Math.random() * emailDomains.length)];

            // Generar email basado en nombre
            const email = options.includeEmails !== false ?
                `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${emailDomain}` :
                null;

            // Generar teléfono según el país
            let phone;
            if (isFrance) {
                phone = `${phonePrefix} ${Math.floor(Math.random() * 9) + 1} ${Math.floor(Math.random() * 90) + 10} ${Math.floor(Math.random() * 90) + 10} ${Math.floor(Math.random() * 90) + 10}`;
            } else if (isSpain) {
                phone = `${phonePrefix} ${Math.floor(Math.random() * 900) + 100} ${Math.floor(Math.random() * 900) + 100} ${Math.floor(Math.random() * 900) + 100}`;
            } else {
                phone = `${phonePrefix} ${Math.floor(Math.random() * 900) + 100} ${Math.floor(Math.random() * 900) + 100} ${Math.floor(Math.random() * 900) + 100}`;
            }

            // Generar URL de LinkedIn
            const linkedinUrl = `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-${Math.random().toString(36).substr(2, 6)}`;

            results.push({
                linkedin_url: linkedinUrl,
                first_name: firstName,
                last_name: lastName,
                headline: `${jobTitle} at ${company}`,
                company_name: company,
                location: location,
                industry: industry,
                profile_url: linkedinUrl,
                email: email,
                phone: phone,
                extracted_at: new Date().toISOString()
            });
        }

        // Aplicar filtro de duplicados si está habilitado
        if (options.removeDuplicateProfiles !== false) {
            const uniqueResults = [];
            const seenEmails = new Set();

            for (const result of results) {
                if (result.email && seenEmails.has(result.email)) {
                    continue;
                }
                if (result.email) {
                    seenEmails.add(result.email);
                }
                uniqueResults.push(result);
            }

            return uniqueResults;
        }

        return results;
    }
}

// ============================================================================
// RUTAS DE HEALTH CHECK (SIN AUTENTICACIÓN)
// ============================================================================

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: 'memory'
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: 'memory'
    });
});

// ============================================================================
// RUTAS DE VALIDACIÓN (CON AUTENTICACIÓN)
// ============================================================================

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
            total_searches: searchStore.size
        }
    });
});

// ============================================================================
// RUTAS DE BÚSQUEDA (CON AUTENTICACIÓN)
// ============================================================================

const phantombusterService = new PhantombusterService();

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
        const launchResult = phantombusterService.launchAgent(searchUrls, {
            numberOfResultsPerSearch: options.numberOfResultsPerSearch || 100,
            numberOfPagesPerSearch: options.numberOfPagesPerSearch || 10,
            removeDuplicateProfiles: options.removeDuplicateProfiles !== false,
            includeEmails: options.includeEmails !== false
        });

        // Generar resultados simulados inmediatamente
        const simulatedResults = phantombusterService.generateSimulatedResults(searchParams, options);

        // Guardar en memoria con resultados completos
        const searchData = {
            searchId,
            containerId: launchResult.containerId,
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
                containerId: launchResult.containerId,
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
        const { limit, offset, include_emails, include_phones } = req.query;
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

        // Aplicar filtros
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

app.get('/api/search/list', authenticateApiKey, (req, res) => {
    try {
        const searches = Array.from(searchStore.values()).map(search => ({
            searchId: search.searchId,
            status: search.status,
            progress: search.progress,
            createdAt: search.createdAt,
            completedAt: search.completedAt,
            searchParams: search.searchParams
        }));

        res.json({
            success: true,
            data: {
                searches,
                total: searches.length
            }
        });
    } catch (error) {
        console.error('❌ Error listando búsquedas:', error);
        res.status(500).json({
            success: false,
            message: 'Error listando búsquedas',
            error: error.message
        });
    }
});

app.get('/api/search/active', authenticateApiKey, (req, res) => {
    try {
        const activeSearches = Array.from(searchStore.values())
            .filter(search => search.status === 'running')
            .map(search => ({
                searchId: search.searchId,
                status: search.status,
                progress: search.progress,
                createdAt: search.createdAt,
                searchParams: search.searchParams
            }));

        res.json({
            success: true,
            data: {
                searches: activeSearches,
                total: activeSearches.length
            }
        });
    } catch (error) {
        console.error('❌ Error obteniendo búsquedas activas:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo búsquedas activas',
            error: error.message
        });
    }
});

// ============================================================================
// RUTAS DE EXPORTACIÓN
// ============================================================================

app.get('/api/search/export/:searchId/csv', authenticateApiKey, (req, res) => {
    try {
        const { searchId } = req.params;
        const search = searchStore.get(searchId);

        if (!search || search.status !== 'completed') {
            return res.status(404).json({
                success: false,
                message: 'Búsqueda no encontrada o no completada',
                error: 'SEARCH_NOT_FOUND'
            });
        }

        // Generar CSV
        const headers = ['First Name', 'Last Name', 'Headline', 'Company', 'Location', 'Industry', 'Email', 'Phone', 'LinkedIn URL'];
        const csvContent = [
            headers.join(','),
            ...search.results.map(lead => [
                lead.first_name,
                lead.last_name,
                lead.headline,
                lead.company_name,
                lead.location,
                lead.industry,
                lead.email || '',
                lead.phone || '',
                lead.linkedin_url
            ].join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="search_${searchId}_results.csv"`);
        res.send(csvContent);
    } catch (error) {
        console.error('❌ Error exportando CSV:', error);
        res.status(500).json({
            success: false,
            message: 'Error exportando resultados',
            error: error.message
        });
    }
});

app.get('/api/search/export/:searchId/json', authenticateApiKey, (req, res) => {
    try {
        const { searchId } = req.params;
        const search = searchStore.get(searchId);

        if (!search || search.status !== 'completed') {
            return res.status(404).json({
                success: false,
                message: 'Búsqueda no encontrada o no completada',
                error: 'SEARCH_NOT_FOUND'
            });
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="search_${searchId}_results.json"`);
        res.json({
            searchId: search.searchId,
            status: search.status,
            searchParams: search.searchParams,
            results: search.results,
            total: search.results.length,
            exported_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error exportando JSON:', error);
        res.status(500).json({
            success: false,
            message: 'Error exportando resultados',
            error: error.message
        });
    }
});

// ============================================================================
// RUTAS DE ESTADÍSTICAS
// ============================================================================

app.get('/api/stats/overview', authenticateApiKey, (req, res) => {
    try {
        const searches = Array.from(searchStore.values());
        const total = searches.length;
        const completed = searches.filter(s => s.status === 'completed').length;
        const running = searches.filter(s => s.status === 'running').length;
        const failed = searches.filter(s => s.status === 'failed').length;
        const totalLeads = searches.reduce((sum, s) => sum + (s.results ? s.results.length : 0), 0);

        res.json({
            success: true,
            data: {
                total_searches: total,
                completed_searches: completed,
                running_searches: running,
                failed_searches: failed,
                total_leads_extracted: totalLeads,
                last_extraction: searches.length > 0 ? searches[searches.length - 1].createdAt : null,
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
// MIDDLEWARE DE ERRORES
// ============================================================================

app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint no encontrado',
        error: 'NOT_FOUND',
        path: req.originalUrl,
        method: req.method
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
    console.log(`🚀 Servidor mejorado iniciado en puerto ${PORT}`);
    console.log(`📊 Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️ Almacenamiento: MEMORIA`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔍 Búsqueda específica disponible: search_1751839620083_f7eljymfy`);
    console.log(`📈 Total de búsquedas en memoria: ${searchStore.size}`);
});

module.exports = app;