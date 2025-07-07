# 🚀 API Phantombuster - Servidor de Producción

## 📋 Descripción

API de producción que integra directamente con la API de Phantombuster para extracción de leads de LinkedIn. El servidor utiliza **dos agentes especializados** para diferentes funcionalidades:

- **LinkedIn Search Export**: Para búsquedas y extracción masiva de leads
- **LinkedIn Profile Visitor**: Para visitar perfiles individuales y extraer datos detallados

## ✨ Características Principales

### 🔄 Integración con Phantombuster

- **API Real**: Integración directa con la API oficial de Phantombuster
- **Dual Agent Architecture**: Dos agentes especializados para diferentes funcionalidades
- **Búsquedas en tiempo real**: Ejecuta búsquedas en LinkedIn a través de Phantombuster
- **Monitoreo de estado**: Consulta el progreso de las búsquedas en Phantombuster
- **Resultados reales**: Procesa y enriquece los datos extraídos de LinkedIn

### 🎯 Clasificación Automática de Leads

- **connectionDegree**: Campo automático basado en datos de LinkedIn
- **Mapeo inteligente**: Determina el grado de conexión (`1st`, `2nd`, `3rd`) basado en:
  - Conexiones mutuas
  - Nivel de conexión en LinkedIn
  - Información de red directa
- **Clasificación por tipo**: Mapea automáticamente a tipos de lead (`hot`, `warm`, `cold`)

### 🤖 Agentes de Phantombuster

La API utiliza dos agentes especializados de Phantombuster:

#### 🎯 LinkedIn Profile Visitor (ID: 4413202499115443)

- **Función**: Visitar perfiles individuales de LinkedIn
- **Endpoints**: `/api/profile-visitor/*`
- **Características**:
  - Visita perfiles específicos
  - Extrae datos detallados del perfil
  - Simula comportamiento humano
  - Respeta límites de LinkedIn
  - Soporte para email discovery
  - Screenshots y datos adicionales

#### 🔍 LinkedIn Search Export (ID: 5905827825464535)

- **Función**: Búsquedas y extracción masiva de leads
- **Endpoints**: `/api/search/*`
- **Características**:
  - Búsquedas por criterios (título, ubicación, industria)
  - Extracción de resultados de búsqueda
  - Enriquecimiento automático de datos
  - Clasificación por connectionDegree
  - Soporte para múltiples URLs de búsqueda
  - Eliminación de duplicados

### 🌍 Procesamiento de Datos

- **Datos de LinkedIn**: Nombres, empresas, ubicaciones
- **Información de conexiones**: Datos de la red de LinkedIn
- **Enriquecimiento automático**: Agrega campos adicionales como `connectionDegree`
- **Validación de datos**: Procesa y valida los datos recibidos de Phantombuster

## 🛠️ Tecnologías Utilizadas

- **Node.js** - Runtime de JavaScript
- **Express.js** - Framework web
- **Helmet** - Seguridad HTTP
- **CORS** - Cross-Origin Resource Sharing
- **Morgan** - Logging de requests
- **Compression** - Compresión de respuestas
- **Rate Limiting** - Limitación de requests
- **Docker** - Containerización

## 🚀 Instalación y Configuración

### Prerrequisitos

- Docker y Docker Compose
- Node.js 18+ (para desarrollo local)

### 1. Clonar el Repositorio

```bash
git clone <repository-url>
cd api-phamthonbuster
```

### 2. Configurar Variables de Entorno

```bash
# Copiar archivo de configuración
cp env.example env

# Editar variables de entorno
nano env
```

### 3. Variables de Entorno Principales

```bash
# Configuración del servidor
NODE_ENV=production
PORT=3001
SKIP_DATABASE=true

# API Key para autenticación
API_KEY=your-secure-api-key

# Phantombuster API (REQUERIDO para producción)
PHANTOMBUSTER_API_KEY=your-phantombuster-api-key

# 🎯 Agentes de Phantombuster
# LinkedIn Profile Visitor - Para visitar perfiles individuales
PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID=your-profile-visitor-agent-id

# LinkedIn Search Export - Para búsquedas y extracción de leads
PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID=your-search-export-agent-id

# 🔐 Configuración de LinkedIn (REQUERIDO)
LINKEDIN_SESSION_COOKIE=your-linkedin-session-cookie
LINKEDIN_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36

# Redis (opcional para cache)
REDIS_URL=redis://localhost:6379
```

### ⚠️ Configuración de Phantombuster

Para usar la API de Phantombuster, necesitas:

1. **API Key de Phantombuster**: Obtén tu API key desde el panel de Phantombuster
2. **Agent IDs**: IDs de los agentes específicos para cada funcionalidad:
   - **Profile Visitor Agent ID**: Para visitar perfiles individuales
   - **Search Export Agent ID**: Para búsquedas y extracción de leads
3. **Session Cookie de LinkedIn**: Requerido para que los agentes funcionen
4. **Configurar los agentes**: Asegúrate de que tus agentes estén configurados correctamente en Phantombuster

### 🔐 Obtener Session Cookie de LinkedIn

Para obtener tu session cookie de LinkedIn:

1. **Inicia sesión en LinkedIn** en tu navegador
2. **Abre las herramientas de desarrollador** (F12)
3. **Ve a la pestaña Application/Storage** → Cookies → https://www.linkedin.com
4. **Busca la cookie `li_at`** y copia su valor
5. **Pega el valor en la variable `LINKEDIN_SESSION_COOKIE`**

**⚠️ Importante**: La session cookie expira cuando cierras sesión en LinkedIn. Debes renovarla periódicamente.

### 4. Ejecutar con Docker

```bash
# Construir y ejecutar
docker compose up --build -d

# Ver logs
docker compose logs -f phantombuster-api

# Detener
docker compose down
```

### 5. Verificar Instalación

```bash
# Health check
curl http://localhost:3001/health

# Verificar API
curl http://localhost:3001/api/health

# Verificar configuración
curl -X GET http://localhost:3001/api/config -H "X-API-Key: your-api-key"
```

## 📊 Estructura de Datos

### Parámetros de Búsqueda

```json
{
  "searchParams": {
    "job_title": "string", // Título de trabajo
    "industry_codes": ["string"], // Códigos de industria
    "location": "string" // Ubicación (ciudades, país)
  },
  "options": {
    "numberOfResultsPerLaunch": 1000, // Número de resultados por lanzamiento
    "numberOfResultsPerSearch": 1000, // Número de resultados por búsqueda
    "removeDuplicateProfiles": true, // Eliminar duplicados
    "enrichLeadsWithAdditionalInformation": true // Enriquecer datos
  }
}
```

### Parámetros de Profile Visitor

```json
{
  "profileUrls": ["string"], // URLs de perfiles a visitar
  "options": {
    "numberOfAddsPerLaunch": 10, // Perfiles por lanzamiento (máx: 80)
    "dwellTime": false, // Simular tiempo de permanencia
    "emailChooser": "phantombuster", // Servicio de email discovery
    "saveImg": false, // Guardar imágenes de perfil
    "takeScreenshot": false, // Tomar screenshots
    "scrapeInterests": false, // Extraer intereses
    "scrapeAccomplishments": false // Extraer logros
  }
}
```

### Estructura de Resultados

```json
{
  "success": true,
  "data": {
    "containerId": "string",
    "status": "running|finished|failed",
    "progress": 0-100,
    "results": [
      {
        "linkedin_url": "string",
        "first_name": "string",
        "last_name": "string",
        "headline": "string",
        "company_name": "string",
        "location": "string",
        "industry": "string",
        "profile_url": "string",
        "email": "string",
        "phone": "string",
        "connectionDegree": "1st|2nd|3rd",
        "extracted_at": "ISO-8601",
        "mutual_connections": "number",
        "connection_level": "number",
        "profile_views": "number",
        "last_activity": "string"
      }
    ]
  }
}
```

## 🔌 Endpoints de la API

### 🔍 Búsquedas (LinkedIn Search Export)

#### Iniciar Búsqueda

```bash
POST /api/search/start
```

**Ejemplo:**

```bash
curl -X POST http://localhost:3001/api/search/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "searchParams": {
      "job_title": "Software Engineer",
      "location": "Madrid, Spain"
    },
    "options": {
      "numberOfResultsPerLaunch": 100,
      "removeDuplicateProfiles": true
    }
  }'
```

#### Estado de Búsqueda

```bash
GET /api/search/status/:searchId
```

#### Resultados de Búsqueda

```bash
GET /api/search/results/:searchId
```

### 🎯 Profile Visitor (LinkedIn Profile Visitor)

#### Visitar Perfil Individual

```bash
POST /api/profile-visitor/visit-single
```

**Ejemplo:**

```bash
curl -X POST http://localhost:3001/api/profile-visitor/visit-single \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "profileUrl": "https://www.linkedin.com/in/johndoe",
    "options": {
      "numberOfAddsPerLaunch": 1,
      "emailChooser": "phantombuster",
      "takeScreenshot": true
    }
  }'
```

#### Visitar Lista de Perfiles

```bash
POST /api/profile-visitor/visit-list
```

#### Estado de Visita

```bash
GET /api/profile-visitor/status/:visitId
```

#### Límites Diarios

```bash
GET /api/profile-visitor/limits
```

### 📊 Configuración y Estado

#### Verificar Configuración

```bash
GET /api/config
```

#### Estadísticas Generales

```bash
GET /api/stats/overview
```

## 🐛 Solución de Problemas

### Problemas Comunes

1. **Error 404 en Phantombuster API**

   - Verificar que las credenciales sean correctas
   - Comprobar que el session cookie de LinkedIn sea válido
   - Verificar que los Agent IDs existan y estén activos

2. **Session Cookie expirada**

   - Renovar la session cookie de LinkedIn
   - Actualizar la variable `LINKEDIN_SESSION_COOKIE`

3. **Límites diarios alcanzados**

   - Verificar límites con `/api/profile-visitor/limits`
   - Esperar al siguiente día o usar una cuenta diferente

4. **Docker no inicia**
   - Verificar logs: `docker compose logs phantombuster-api`
   - Reconstruir: `docker compose down && docker compose up --build -d`

### Logs de Debug

```bash
# Ver logs en tiempo real
docker compose logs -f phantombuster-api

# Ver logs específicos
docker compose logs phantombuster-api | grep "ERROR"
```

## 🔄 Desarrollo Local

### Instalación de Dependencias

```bash
npm install
```

### Ejecutar en Desarrollo

```bash
npm start
# o
node server-enhanced.js
```

### Variables de Entorno de Desarrollo

```bash
NODE_ENV=development
PORT=3001
API_KEY=dev-api-key-12345
SKIP_DATABASE=true
```

## 📝 Notas de Implementación

### Arquitectura de Agentes

- **Separación de responsabilidades**: Cada agente tiene una función específica
- **Configuración independiente**: Cada agente puede tener diferentes configuraciones
- **Escalabilidad**: Fácil agregar nuevos agentes para diferentes funcionalidades

### Seguridad

- **API Key**: Autenticación requerida para todos los endpoints
- **Rate Limiting**: Protección contra abuso
- **Session Cookies**: Manejo seguro de credenciales de LinkedIn

### Rendimiento

- **Límites diarios**: Respeto de límites de LinkedIn
- **Procesamiento asíncrono**: Las búsquedas se ejecutan en segundo plano
- **Caché**: Almacenamiento en memoria para resultados

## 🤝 Contribución

1. Fork el proyecto
2. Crear una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## 🆘 Soporte

Para soporte técnico o preguntas:

- Crear un issue en el repositorio
- Revisar la documentación de la API
- Verificar los logs del servidor

---

**¡Disfruta usando la API de Phantombuster Local! 🚀**

# api-phamthonbuster
