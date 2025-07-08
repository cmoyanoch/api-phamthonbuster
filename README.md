# Phantombuster API - Local Docker

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
PHANTOMBUSTER_API_KEY=r2KioJAihnsDpNPOxl3Yn5XXxPXvvA1hhXSpC4VgQGQ
PHANTOMBUSTER_SEARCH_EXPORT_AGENT_ID=5905827825464535
PHANTOMBUSTER_PROFILE_VISITOR_AGENT_ID=4413202499115443

# LinkedIn Session Configuration
LINKEDIN_SESSION_COOKIE=AQEFARABAAAAABansMgAAAGXfFcaJwAAAZgHBAqlTgAAs3VybjpsaTplbnRlcnByaXNlQXV0aFRva2VuOmVKeGpaQUFDcVMybm8wQzA3S1NTOVNCYVhFcGpDeU9JVWNGOHNBSE1pTjZrRXMzQUNBQzJ3UWdmXnVybjpsaTplbnRlcnByaXNlUHJvZmlsZToodXJuOmxpOmVudGVycHJpc2VBY2NvdW50OjQ0ODA1NjE1NCw0OTYxMzczOTEpXnVybjpsaTptZW1iZXI6OTkxOTk2NDExFSWvrC62HmuIt0_WDVb5g4WhXF5LTvr80EuNLOWNNDHfBkz9gnleV4o1e1CbDDg3qlPpQyOOnHrM4HIokY4m3kW9brdTTOK9CqrsUIXsCRTJ-D8C0d74dlAPdAktAqFR-XfPyzdfser4bYQGzeEpTcIGDela_EH1gH54g11U_r3p9xUhMzennJHoRbfk59BCC0ZrOA
LINKEDIN_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36

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
POST /api/search/launch
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
  "containerId": "3835833896164009",
  "message": "Search agent launched successfully"
}
```

#### Verificar Estado de Búsqueda

```http
GET /api/search/status/{containerId}
```

#### Obtener Resultados

```http
GET /api/search/results/{containerId}
```

### 👤 Profile Visitor Agent (Visitas de Perfiles)

#### Visitar Perfil Individual

```http
POST /api/visitor/visit-single
Content-Type: application/json

{
  "profileUrl": "https://www.linkedin.com/in/johndoe/",
  "message": "Hi John, I noticed your experience in supply chain management. Would love to connect!"
}
```

#### Visitar Múltiples Perfiles

```http
POST /api/visitor/visit-multiple
Content-Type: application/json

{
  "profiles": [
    {
      "url": "https://www.linkedin.com/in/johndoe/",
      "message": "Hi John, great profile!"
    },
    {
      "url": "https://www.linkedin.com/in/janesmith/",
      "message": "Hi Jane, love your experience!"
    }
  ]
}
```

#### Verificar Estado de Visita

```http
GET /api/visitor/status/{containerId}
```

### 📊 Agent Monitoring (Monitoreo de Agentes)

#### Listar Todos los Agentes

```http
GET /api/agents/list
```

**Respuesta:**

```json
{
  "success": true,
  "agents": [
    {
      "id": "5905827825464535",
      "name": "LinkedIn Search Export",
      "type": "search",
      "isRunning": false,
      "lastLaunch": null,
      "lastLaunchAt": null
    },
    {
      "id": "4413202499115443",
      "name": "LinkedIn Profile Visitor",
      "type": "visitor",
      "isRunning": false,
      "lastLaunch": null,
      "lastLaunchAt": null
    }
  ]
}
```

#### Obtener Detalles de Agente

```http
GET /api/agents/details/{agentId}
```

#### Verificar Estado de Agente

```http
GET /api/agents/status/{agentId}/{containerId}
```

#### Monitoreo en Tiempo Real

```http
GET /api/agents/monitor?agentId={agentId}&containerId={containerId}
```

**Respuesta:**

```json
{
  "success": true,
  "monitoring": {
    "agentId": "5905827825464535",
    "agentType": "search",
    "containerId": "3835833896164009",
    "status": "finished",
    "isRunning": false,
    "progress": 100,
    "output": "Process finished successfully",
    "lastUpdate": "2025-01-08T00:10:02.000Z",
    "canSoftAbort": false
  }
}
```

### 📈 Daily Limits

#### Verificar Límites Diarios

```http
GET /api/limits/daily
```

### 🔧 Health Check

#### Verificar Estado del Sistema

```http
GET /health
```

## 🎯 Ejemplos de Uso

### Flujo Completo de Búsqueda

1. **Lanzar búsqueda:**

```bash
curl -X POST http://localhost:3000/api/search/launch \
  -H "Content-Type: application/json" \
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
curl http://localhost:3000/api/agents/monitor?agentId=5905827825464535&containerId=3835833896164009
```

3. **Obtener resultados:**

```bash
curl http://localhost:3000/api/search/results/3835833896164009
```

### Flujo de Visitas de Perfiles

1. **Visitar perfil individual:**

```bash
curl -X POST http://localhost:3000/api/visitor/visit-single \
  -H "Content-Type: application/json" \
  -d '{
    "profileUrl": "https://www.linkedin.com/in/johndoe/",
    "message": "Hi John, would love to connect!"
  }'
```

2. **Verificar estado:**

```bash
curl http://localhost:3000/api/visitor/status/{containerId}
```

## 📊 Estados de Agentes

| Estado     | Descripción             | Acción              |
| ---------- | ----------------------- | ------------------- |
| `running`  | Agente ejecutándose     | Monitorear progreso |
| `finished` | Completado exitosamente | Obtener resultados  |
| `error`    | Error en ejecución      | Revisar logs        |
| `null`     | No ejecutándose         | Listo para lanzar   |

## 🔍 Monitoreo en Tiempo Real

### Información Disponible

- ✅ **Container ID**: Identificador único de ejecución
- ✅ **Status**: Estado actual (running/finished/error)
- ✅ **Progress**: Progreso (0-100)
- ✅ **Output**: Logs en tiempo real
- ✅ **isRunning**: Boolean de ejecución
- ✅ **lastUpdate**: Timestamp de última actualización
- ✅ **canSoftAbort**: Posibilidad de abortar ejecución

### Ejemplo de Monitoreo Continuo

```javascript
// Monitorear agente cada 5 segundos
const monitorAgent = async (agentId, containerId) => {
  const response = await fetch(
    `/api/agents/monitor?agentId=${agentId}&containerId=${containerId}`
  );
  const data = await response.json();

  if (data.monitoring.status === "finished") {
    console.log("✅ Agente completado");
    return await fetch(`/api/search/results/${containerId}`);
  } else if (data.monitoring.status === "running") {
    console.log(`🔄 Progreso: ${data.monitoring.progress}%`);
    setTimeout(() => monitorAgent(agentId, containerId), 5000);
  }
};
```

## 🛠️ Solución de Problemas

### Error 404 en Lanzamiento

- Verificar que los IDs de agentes sean correctos
- Comprobar que la API key sea válida
- Asegurar que los agentes estén configurados en Phantombuster

### Agente No Responde

- Verificar el sessionCookie de LinkedIn
- Comprobar el userAgent
- Revisar los logs del agente en Phantombuster

### Límites Excedidos

- Usar `/api/limits/daily` para verificar uso actual
- Esperar al siguiente día o cambiar de cuenta
- Implementar rotación de cuentas

## 📁 Estructura del Proyecto

```
api-phantombuster/
├── server-enhanced.js          # Servidor principal
├── package.json               # Dependencias
├── .env                      # Variables de entorno
├── README.md                 # Documentación
├── Phantombuster-API-Local-Docker.postman_collection.json    # Colección Postman
└── Phantombuster-API-Local-Docker.postman_environment.json   # Variables Postman
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
