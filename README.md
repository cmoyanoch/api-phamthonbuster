# 🤖 EuropBots Phantombuster API

**Copyright © 2025 RocketMonk.com**
**Desarrollado por Cristian Moyano**
**Versión: 2.0**

API Node.js para automatización de LinkedIn integrada con Phantombuster, extracción de leads y gestión de campañas.

## 🎯 Resumen

La API Phantombuster es el backend core del sistema EuropBots que proporciona:
- Automatización de LinkedIn con Phantombuster
- Extracción y enriquecimiento de leads
- Gestión de agentes y slots de Phantombuster
- Monitoreo en tiempo real
- Integración con sistemas CRM (Axonaut)
- Domain scraping para datos de contacto

## 🏗️ Arquitectura

### Stack Tecnológico
- **Framework**: Express.js
- **Base de datos**: PostgreSQL (esquema phantombuster)
- **Cache**: Redis (opcional)
- **Automatización**: Phantombuster API
- **Containerización**: Docker
- **Logging**: Winston
- **Seguridad**: Helmet, CORS, Rate Limiting

### Patrones de Diseño
- **Service Layer Pattern** - Separación de lógica de negocio
- **Repository Pattern** - Acceso a datos
- **Middleware Pattern** - Autenticación y validación
- **Observer Pattern** - Monitoreo de containers
- **Factory Pattern** - Creación de agentes

### Estructura del Proyecto
```
api-phamthonbuster/
├── server-refactored.js    # Servidor principal Express.js
├── database-service.js     # Servicio de base de datos
├── cookie-manager.js       # Gestión de cookies LinkedIn
├── cookie-predictor.js     # Predicción de cookies
├── services/               # Servicios de negocio
│   ├── PhantombusterService.js
│   ├── LinkedInProfileVisitorService.js
│   ├── KnownErrorsService.js
│   ├── PhantombusterErrorParser.js
│   ├── AutoconnectResponseMonitor.js
│   ├── ContainerStatusMonitor.js
│   └── SequentialDistributionManager.js
├── routes/                 # Endpoints de la API
│   ├── autoconnect.js
│   ├── autoconnect-monitoring.js
│   ├── message-sender.js
│   ├── domain-scraper.js
│   ├── axonaut.js
│   ├── phantombuster-status.js
│   ├── known-errors.js
│   └── limits.js
├── middleware/             # Middleware personalizado
│   ├── authentication.js
│   └── validateContainer.js
├── utils/                  # Utilidades
│   ├── logger.js
│   └── responseHelpers.js
├── monitoring/             # Monitoreo y métricas
│   └── metrics.js
└── Dockerfile              # Configuración Docker
```

## 🔒 Seguridad

### Medidas de Seguridad
- **Rate Limiting**: 100 requests/15min por IP
- **Helmet**: Headers de seguridad HTTP
- **CORS**: Control de acceso de origen cruzado
- **Input Validation**: Validación de parámetros de entrada
- **Authentication**: API Key y JWT
- **Compression**: Optimización de respuesta

### Variables de Entorno Requeridas
```env
# Servidor
NODE_ENV=production
PORT=3001
SSL_ENABLED=true

# Base de datos
DATABASE_URL=postgresql://n8n_user:password@n8n_postgres:5432/n8n_db
DB_HOST=n8n_postgres
DB_PORT=5432
DB_NAME=n8n_db
DB_USER=n8n_user
DB_PASSWORD=your_password

# Phantombuster
PHANTOMBUSTER_API_KEY=your_phantombuster_api_key
PHANTOMBUSTER_BASE_URL=https://api.phantombuster.com

# Redis (opcional)
REDIS_HOST=redis
REDIS_PORT=6379

# Configuración de timeout y retry
HTTP_TIMEOUT=300000
MAX_RETRIES=3
RETRY_DELAY=1000
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000
```

## 📡 APIs Disponibles

### 1. 🔍 BÚSQUEDAS DE LEADS

#### POST `/api/search`
Lanza búsquedas de LinkedIn con Phantombuster.

**Request Body:**
```json
{
  "searchUrl": "https://linkedin.com/search/results/people/?keywords=CEO",
  "numberOfPages": 5,
  "waitTimeAfterLoad": 3000,
  "message": "Hi! I would love to connect with you on LinkedIn.",
  "agentId": "linkedin-search-export",
  "sessionCookie": "cookie_value",
  "searchId": "unique_search_id"
}
```

**Response:**
```json
{
  "success": true,
  "containerId": "container_123456",
  "message": "Búsqueda iniciada correctamente",
  "estimatedDuration": 15,
  "data": {
    "searchId": "unique_search_id",
    "agentId": "linkedin-search-export",
    "status": "launched"
  }
}
```

#### GET `/api/search/status/:containerId`
Verifica el estado de una búsqueda en progreso.

#### GET `/api/search/get-results/:containerId`
Obtiene los resultados de una búsqueda completada.

#### GET `/api/search/recover-results/:containerId`
Recupera resultados de agentes expirados o con errores.

### 2. 🤝 AUTOCONNECT (Conexiones)

#### POST `/api/autoconnect/launch`
Envía solicitudes de conexión automáticas en LinkedIn.

**Request Body:**
```json
{
  "spreadsheetUrl": "https://docs.google.com/spreadsheets/.../export?format=csv",
  "columnName": "profileUrl",
  "message": "Hi! I'd like to connect with you.",
  "sessionCookie": "cookie_value",
  "waitTimeAfterConnection": 5000,
  "maxConnections": 50
}
```

#### GET `/api/autoconnect/status/:containerId`
Verifica el estado de las conexiones.

#### GET `/api/autoconnect/results/:containerId`
Obtiene resultados de conexiones enviadas.

### 3. 💬 MESSAGE SENDER (Mensajes)

#### POST `/api/message-sender/launch`
Envía mensajes personalizados a conexiones de LinkedIn.

**Request Body:**
```json
{
  "spreadsheetUrl": "https://docs.google.com/spreadsheets/.../export?format=csv",
  "message": "Hello {firstName}! Thanks for connecting.",
  "sessionCookie": "cookie_value",
  "waitTimeBetweenMessages": 10000,
  "maxMessages": 30
}
```

### 4. 🌐 DOMAIN SCRAPER

#### POST `/api/domain-scraper/extract-address`
Extrae información de contacto de sitios web.

**Request Body:**
```json
{
  "domain": "https://example.com",
  "extractEmails": true,
  "extractPhones": true,
  "extractSocialMedia": true
}
```

### 5. 📊 MONITOREO Y ESTADO

#### GET `/api/status`
Estado general del sistema y conectividad.

#### GET `/api/agents`
Lista de agentes Phantombuster disponibles.

#### GET `/api/axonaut/status`
Estado de conexión con Axonaut CRM.

#### GET `/api/phantombuster/agents`
Información detallada de agentes Phantombuster.

#### GET `/api/limits/daily/:userId`
Límites diarios de uso por usuario.

## 🛠️ Servicios Principales

### PhantombusterService
Gestiona todas las interacciones con la API de Phantombuster:
- Lanzamiento de agentes
- Monitoreo de estado
- Recuperación de resultados
- Gestión de errores

### LinkedInProfileVisitorService
Automatización específica para visitas de perfiles LinkedIn:
- Validación de URLs
- Gestión de límites diarios
- Monitoreo de progreso

### KnownErrorsService
Sistema de gestión de errores conocidos:
- Base de datos de errores comunes
- Soluciones automáticas
- Alertas y notificaciones

### AutoconnectResponseMonitor
Monitoreo de respuestas de autoconexión:
- Seguimiento de aceptaciones
- Métricas de efectividad
- Análisis de patrones

### SequentialDistributionManager
Distribución secuencial de URLs entre agentes:
- Balanceo de carga
- Evita duplicación
- Optimización de recursos

## 💾 Base de Datos

### Esquema phantombuster

#### Tablas Principales:
```sql
-- Búsquedas y resultados
searches (id, search_id, user_id, query, status, created_at)
profile_visits (id, visit_id, profile_url, status, visited_at)

-- Configuración de LinkedIn
linkedin_urls_optimizadas (id, url, sector, country, priority)
linkedin_phantombuster_config (id, agent_id, max_daily_usage, current_usage)

-- Gestión de errores
known_errors (id, error_code, error_message, solution, frequency)

-- Límites y control
daily_limits (id, user_id, date, searches_count, connections_count, messages_count)

-- Monitoreo de containers
container_completion_logs (id, container_id, status, results_count, completed_at)
```

#### Funciones y Triggers:
- Actualización automática de límites diarios
- Cálculo de métricas de uso
- Limpieza de datos antiguos

## 🚀 Instalación y Deployment

### Desarrollo Local
```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp env.example .env

# Ejecutar en modo desarrollo
npm run dev

# Ejecutar con nodemon
npm run start:dev
```

### Docker
```bash
# Build imagen
docker build -t europbots-api .

# Ejecutar contenedor
docker run -p 3001:3001 --env-file .env europbots-api

# Con Docker Compose
docker compose up phantombuster-api
```

### Variables de Entorno de Producción
```env
NODE_ENV=production
PORT=3001
SSL_ENABLED=true
DATABASE_URL=postgresql://user:pass@host:5432/db
PHANTOMBUSTER_API_KEY=your_api_key
REDIS_HOST=redis
REDIS_PORT=6379
HTTP_TIMEOUT=300000
MAX_RETRIES=3
CIRCUIT_BREAKER_THRESHOLD=5
```

## 📊 Monitoreo y Logging

### Sistema de Logs
- **Winston Logger** con múltiples niveles
- **Logs estructurados** en formato JSON
- **Rotación automática** de archivos
- **Logging de errores** detallado

### Métricas Disponibles
- Requests por minuto
- Tiempo de respuesta
- Errores por tipo
- Uso de agentes Phantombuster
- Estado de conexiones

### Health Checks
```bash
# Verificar estado de la API
curl http://localhost:3001/api/health

# Estado de Phantombuster
curl http://localhost:3001/api/status

# Métricas del sistema
curl http://localhost:3001/api/metrics
```

## 🔧 Manejo de Errores

### Errores Conocidos
La API mantiene una base de datos de errores comunes de Phantombuster:
- Cookies expiradas
- Límites de LinkedIn alcanzados
- Errores de red temporales
- Problemas de parsing

### Sistema de Reintentos
- **Retry automático** con backoff exponencial
- **Circuit breaker** para evitar cascadas de fallos
- **Recuperación de resultados** de agentes fallidos

### Alertas y Notificaciones
- Notificaciones en tiempo real de fallos
- Alertas por límites alcanzados
- Monitoreo de salud de agentes

## 📈 Performance

### Optimizaciones
- **Connection pooling** para PostgreSQL
- **Cache Redis** para respuestas frecuentes
- **Compression** de respuestas HTTP
- **Rate limiting** inteligente

### Escalabilidad
- Diseño stateless para múltiples instancias
- Balanceador de carga compatible
- Cache distribuido con Redis
- Manejo asíncrono de operaciones largas

## 🚨 Troubleshooting

### Errores Comunes

1. **Error de conexión Phantombuster**
   ```bash
   # Verificar API key
   curl -H "X-Phantombuster-Key: YOUR_API_KEY" https://api.phantombuster.com/api/v2/agents/fetch-all
   ```

2. **Problemas de base de datos**
   ```bash
   # Verificar conexión PostgreSQL
   docker compose logs n8n_postgres
   ```

3. **Límites de LinkedIn alcanzados**
   - Revisar tabla `daily_limits`
   - Verificar configuración de agentes

### Logs de Debug
```bash
# Ver logs del contenedor
docker compose logs phantombuster-api

# Logs en tiempo real
docker compose logs -f phantombuster-api

# Logs de errores específicos
grep "ERROR" logs/error.log
```

## 🔄 Integración con Webapp

La API se integra con la webapp Next.js a través de:
- **Endpoints REST** para todas las operaciones
- **Webhooks** para notificaciones de estado
- **Shared database** (esquemas phantombuster y webapp)
- **Redis sessions** para estado compartido

### Ejemplos de Integración
```javascript
// Desde la webapp - lanzar búsqueda
const response = await fetch('/api/phantombuster/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    searchUrl: 'https://linkedin.com/search/...',
    numberOfPages: 5
  })
});

// Monitorear estado
const status = await fetch(`/api/phantombuster/search/status/${containerId}`);
```

---

**Desarrollado con ❤️ por el equipo EuropBots**

Para más información sobre el sistema completo, consultar la documentación de la WebApp y los workflows N8N.