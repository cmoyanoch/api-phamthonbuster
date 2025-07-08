# Phantombuster API

API completa para integración con Phantombuster, incluyendo búsquedas masivas de LinkedIn, visitas de perfiles y monitoreo en tiempo real de agentes.

## 🚀 Características

- **🔍 Búsquedas Masivas**: Extracción de leads usando LinkedIn Search Export
- **👤 Visitas de Perfiles**: Visitas individuales y múltiples con LinkedIn Profile Visitor
- **📊 Monitoreo en Tiempo Real**: Seguimiento del estado de agentes y containers
- **📈 Límites Diarios**: Control de uso y límites de la API
- **🔧 Health Checks**: Verificación del estado del sistema

## 📋 Requisitos

- Node.js 18+
- Docker (opcional)
- Cuenta de Phantombuster con API Key
- Agentes configurados en Phantombuster

## 🔧 Configuración

### Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# Phantombuster API Configuration
PHANTOMBUSTER_API_KEY=xxxx
PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID=xxxx
PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID=xxxx

# LinkedIn Session Configuration
LINKEDIN_SESSION_COOKIE=xxxx
LINKEDIN_USER_AGENT=xxxx

# Server Configuration
PORT=3000
NODE_ENV=development
```

### Instalación

```bash
# Instalar dependencias
npm install

# Iniciar servidor
npm start

# O con Docker
docker-compose up -d
```

## 📚 Endpoints

### 🔍 Search Agent (Búsquedas Masivas)

#### Lanzar Búsqueda

```http
POST /api/search/start
Content-Type: application/json

{
  "searchParams": {
    "job_title": "Supply Chain Director",
    "location": "France",
    "industry_codes": ["20", "27", "50", "53", "96"],
    "connection_degree": ["2nd", "3rd+"],
    "results_per_launch": 10,
    "total_results": 100
  }
}
```

**Respuesta:**

```json
{
  "success": true,
  "message": "Búsqueda iniciada en Phantombuster",
  "data": {
    "searchId": "search_...",
    "containerId": "3835833896164009",
    ...
  }
}
```

#### Verificar Estado de Búsqueda

```http
GET /api/search/status/:searchId
```

#### Obtener Resultados por searchId

```http
GET /api/search/results/:searchId
```

#### Obtener Resultados por containerId (directo de Phantombuster)

```http
GET /api/search/results/container/:containerId
```

**Diferencia:**

- `searchId`: ID interno de la API, útil si lanzaste la búsqueda desde aquí.
- `containerId`: ID de ejecución de Phantombuster, puedes usarlo si lo tienes de otra fuente o historial.

### 👤 Profile Visitor Agent (Visitas de Perfiles)

#### Visitar Perfil Individual

```http
POST /api/profile-visitor/visit-single
Content-Type: application/json

{
  "profileUrl": "https://www.linkedin.com/in/johndoe/",
  "leadType": "cold",
  "scheduleFollowUp": false,
  "userId": "usuario1"
}
```

#### Visitar Lista de Perfiles

```http
POST /api/profile-visitor/visit-list
Content-Type: application/json

{
  "profileUrls": [
    "https://www.linkedin.com/in/johndoe/",
    "https://www.linkedin.com/in/janesmith/"
  ],
  "leadType": "warm",
  "delayBetweenProfiles": 60,
  "scheduleFollowUp": true,
  "userId": "usuario1"
}
```

#### Verificar Estado de Visita

```http
GET /api/profile-visitor/status/:visitId
```

#### Ver Límites Diarios

```http
GET /api/profile-visitor/limits/:userId?
```

### 📊 Agent Monitoring (Monitoreo de Agentes)

#### Listar Todos los Agentes

```http
GET /api/agents/list
```

#### Obtener Detalles de Agente

```http
GET /api/agents/details/:agentId
```

#### Verificar Estado de Agente

```http
GET /api/agents/status/:agentId/:containerId
```

#### Monitoreo en Tiempo Real

```http
GET /api/agents/monitor?agentId={agentId}&containerId={containerId}
```

### 📈 Límites Diarios

```http
GET /api/profile-visitor/limits/:userId?
```

### 🔧 Health Check

```http
GET /health
```

## 🎯 Ejemplos de Uso

### Flujo Completo de Búsqueda

1. **Lanzar búsqueda:**

```bash
curl -X POST http://localhost:3000/api/search/start \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_API_KEY" \
  -d '{
    "searchParams": {
      "job_title": "Software Engineer",
      "location": "Madrid, Spain",
      "results_per_launch": 10
    }
  }'
```

2. **Monitorear progreso:**

```bash
curl http://localhost:3000/api/search/status/search_... -H "x-api-key: TU_API_KEY"
```

3. **Obtener resultados por searchId:**

```bash
curl http://localhost:3000/api/search/results/search_... -H "x-api-key: TU_API_KEY"
```

4. **Obtener resultados por containerId:**

```bash
curl http://localhost:3000/api/search/results/container/3835833896164009 -H "x-api-key: TU_API_KEY"
```

### Flujo de Visitas de Perfiles

1. **Visitar perfil individual:**

```bash
curl -X POST http://localhost:3000/api/profile-visitor/visit-single \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_API_KEY" \
  -d '{
    "profileUrl": "https://www.linkedin.com/in/johndoe/",
    "leadType": "cold"
  }'
```

2. **Verificar estado de la visita:**

```bash
curl http://localhost:3000/api/profile-visitor/status/visit_... -H "x-api-key: TU_API_KEY"
```

3. **Ver límites diarios:**

```bash
curl http://localhost:3000/api/profile-visitor/limits/usuario1 -H "x-api-key: TU_API_KEY"
```

## 📁 Estructura del Proyecto

```
api-phantombuster/
├── server-enhanced.js          # Servidor principal
├── package.json               # Dependencias
├── .env                      # Variables de entorno
├── README.md                 # Documentación
└── ...
```

## 🚀 Despliegue

### Local

```bash
npm start
```

### Docker

```bash
docker-compose up -d
```

### Producción

```bash
NODE_ENV=production npm start
```

## 📞 Soporte

Para problemas o preguntas:

1. Revisar los logs del servidor
2. Verificar la configuración de variables de entorno
3. Comprobar el estado de los agentes en Phantombuster
4. Usar los endpoints de monitoreo para diagnóstico

---

**Nota**: Esta API está diseñada para uso responsable y respeta los límites de LinkedIn y Phantombuster.
