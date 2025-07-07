# 🚀 API Phantombuster Local - Servidor Mejorado

## 📋 Descripción

API local simulada de Phantombuster que proporciona funcionalidades completas de extracción de leads de LinkedIn con **búsqueda automática**. El servidor genera datos realistas basados en los parámetros de búsqueda y se completa inmediatamente sin necesidad de monitoreo.

## ✨ Características Principales

### 🔄 Búsqueda Automática

- **Completación inmediata**: Las búsquedas se completan automáticamente al iniciarlas
- **Sin monitoreo**: No necesitas consultar el estado repetidamente
- **Resultados instantáneos**: Los datos están disponibles inmediatamente después de iniciar la búsqueda

### 🌍 Datos Localizados

- **Nombres por país**: Genera nombres y apellidos según la ubicación (Francia, España, internacional)
- **Empresas locales**: Empresas específicas por país
- **Formatos telefónicos**: Prefijos telefónicos correctos por país
- **Ubicaciones realistas**: Basadas en los parámetros de búsqueda

### 🎯 Filtros Inteligentes

- **Búsqueda por título**: `job_title`
- **Búsqueda por industria**: `industry_codes` con mapeo automático
- **Búsqueda por ubicación**: `location` con detección de país
- **Opciones avanzadas**: Número de resultados, paginación, eliminación de duplicados

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
NODE_ENV=development
PORT=3001
SKIP_DATABASE=true

# API Key para autenticación
API_KEY=dev-api-key-12345

# Phantombuster API (opcional para pruebas)
PHANTOMBUSTER_API_KEY=your-api-key
PHANTOMBUSTER_AGENT_ID=your-agent-id

# Redis (opcional para cache)
REDIS_URL=redis://localhost:6379
```

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
    "numberOfResultsPerSearch": 100, // Número de resultados
    "numberOfPagesPerSearch": 10, // Páginas por búsqueda
    "removeDuplicateProfiles": true, // Eliminar duplicados
    "includeEmails": true // Incluir emails
  }
}
```

### Estructura de Resultados

```json
{
  "linkedin_url": "string", // URL del perfil de LinkedIn
  "first_name": "string", // Nombre
  "last_name": "string", // Apellido
  "headline": "string", // Título profesional
  "company_name": "string", // Nombre de la empresa
  "location": "string", // Ubicación
  "industry": "string", // Industria
  "profile_url": "string", // URL del perfil
  "email": "string|null", // Email (puede ser null)
  "phone": "string", // Teléfono
  "extracted_at": "string" // Fecha de extracción
}
```

## 🔍 Endpoints Disponibles

### Health Check (Sin Autenticación)

| Método | Endpoint      | Descripción                 |
| ------ | ------------- | --------------------------- |
| GET    | `/health`     | Estado general del servidor |
| GET    | `/api/health` | Estado de la API            |

### Autenticación y Configuración

| Método | Endpoint             | Descripción                       |
| ------ | -------------------- | --------------------------------- |
| GET    | `/api/auth/validate` | Validar API Key                   |
| GET    | `/api/config`        | Obtener configuración del sistema |

### Búsqueda Automática

| Método | Endpoint                        | Descripción                                   |
| ------ | ------------------------------- | --------------------------------------------- |
| POST   | `/api/search/start`             | Iniciar búsqueda (completada automáticamente) |
| GET    | `/api/search/status/:searchId`  | Estado de búsqueda                            |
| GET    | `/api/search/results/:searchId` | Obtener resultados                            |
| GET    | `/api/search/list`              | Listar todas las búsquedas                    |
| GET    | `/api/search/active`            | Búsquedas activas                             |

### Exportación de Datos

| Método | Endpoint                            | Descripción     |
| ------ | ----------------------------------- | --------------- |
| GET    | `/api/search/export/:searchId/json` | Exportar a JSON |
| GET    | `/api/search/export/:searchId/csv`  | Exportar a CSV  |

### Estadísticas

| Método | Endpoint              | Descripción            |
| ------ | --------------------- | ---------------------- |
| GET    | `/api/stats/overview` | Estadísticas generales |

## 🎯 Ejemplos de Uso

### 1. Búsqueda Básica

```bash
curl -X POST http://localhost:3001/api/search/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key-12345" \
  -d '{
    "searchParams": {
      "job_title": "Software Engineer"
    },
    "options": {
      "numberOfResultsPerSearch": 10,
      "includeEmails": true
    }
  }'
```

### 2. Búsqueda con Ubicación Específica (Francia)

```bash
curl -X POST http://localhost:3001/api/search/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key-12345" \
  -d '{
    "searchParams": {
      "job_title": "Supply Chain Director",
      "industry_codes": ["20","27","50","53","96"],
      "location": "Paris, Lyon, Marseille, Toulouse, Nice, Lille, France"
    },
    "options": {
      "numberOfResultsPerSearch": 50,
      "numberOfPagesPerSearch": 5,
      "removeDuplicateProfiles": true,
      "includeEmails": true
    }
  }'
```

### 3. Búsqueda con Industrias Específicas

```bash
curl -X POST http://localhost:3001/api/search/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key-12345" \
  -d '{
    "searchParams": {
      "job_title": "Marketing Manager",
      "industry_codes": ["4", "6"]
    },
    "options": {
      "numberOfResultsPerSearch": 15,
      "removeDuplicateProfiles": true,
      "includeEmails": true
    }
  }'
```

### 4. Obtener Resultados

```bash
curl -X GET "http://localhost:3001/api/search/results/SEARCH_ID" \
  -H "X-API-Key: dev-api-key-12345"
```

### 5. Exportar Datos

```bash
# Exportar a JSON
curl -X GET "http://localhost:3001/api/search/export/SEARCH_ID/json" \
  -H "X-API-Key: dev-api-key-12345" > results.json

# Exportar a CSV
curl -X GET "http://localhost:3001/api/search/export/SEARCH_ID/csv" \
  -H "X-API-Key: dev-api-key-12345" > results.csv
```

## 🗺️ Mapeo de Industrias

El servidor mapea automáticamente los códigos de industria a nombres legibles:

| Código | Industria      |
| ------ | -------------- |
| 4      | Technology     |
| 6      | Finance        |
| 20     | Manufacturing  |
| 27     | Transportation |
| 50     | Supply Chain   |
| 53     | Logistics      |
| 96     | Retail         |

## 🌍 Soporte de Países

### Francia 🇫🇷

- **Nombres**: Jean, Marie, Pierre, Sophie, François, etc.
- **Empresas**: LVMH, TotalEnergies, BNP Paribas, Carrefour, Orange, Sanofi, etc.
- **Teléfonos**: Formato `+33 X XX XX XX`
- **Detectado por**: `location` contiene "France"

### España 🇪🇸

- **Nombres**: Juan, María, Carlos, Ana, Luis, Carmen, etc.
- **Empresas**: Inditex, Santander, Telefónica, BBVA, Iberdrola, etc.
- **Teléfonos**: Formato `+34 XXX XXX XXX`
- **Detectado por**: `location` contiene "Spain"

### Internacional 🌐

- **Nombres**: John, Mary, James, Patricia, Robert, etc.
- **Empresas**: TechCorp, InnovateLab, Digital Solutions, etc.
- **Teléfonos**: Formato `+1 XXX XXX XXXX`
- **Detectado por**: Ubicación no específica

## 🔧 Configuración Avanzada

### Rate Limiting

```javascript
// Configurado en el servidor
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por ventana
});
```

### Seguridad

- **Helmet**: Headers de seguridad HTTP
- **CORS**: Configuración de cross-origin
- **Compression**: Compresión de respuestas
- **API Key**: Autenticación requerida

### Logging

- **Morgan**: Logging de requests HTTP
- **Console**: Logs de aplicación
- **Error Handling**: Manejo centralizado de errores

## 📈 Monitoreo y Estadísticas

### Estadísticas Disponibles

- Total de búsquedas realizadas
- Búsquedas completadas vs. fallidas
- Total de leads extraídos
- Última extracción realizada

### Health Check

```bash
# Verificar estado del servidor
curl http://localhost:3001/health

# Respuesta esperada
{
  "status": "ok",
  "timestamp": "2025-07-07T01:44:28.452Z",
  "version": "1.0.0",
  "environment": "development",
  "database": "memory"
}
```

## 🐛 Solución de Problemas

### Problemas Comunes

1. **API Key inválida**

   ```bash
   # Verificar API Key en el archivo env
   cat env | grep API_KEY
   ```

2. **Puerto ocupado**

   ```bash
   # Cambiar puerto en env
   PORT=3002
   ```

3. **Docker no inicia**

   ```bash
   # Verificar logs
   docker compose logs phantombuster-api

   # Reconstruir
   docker compose down
   docker compose up --build -d
   ```

4. **Búsqueda no genera resultados**
   - Verificar parámetros de búsqueda
   - Comprobar que la ubicación sea válida
   - Revisar códigos de industria

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

### Almacenamiento en Memoria

- Los datos se almacenan en memoria (Map)
- No hay persistencia entre reinicios
- Ideal para desarrollo y pruebas

### Búsqueda Automática

- Se completa inmediatamente al iniciar
- Genera datos simulados realistas
- No requiere monitoreo de estado

### Datos Simulados

- Basados en parámetros de búsqueda
- Localizados según país/ubicación
- Incluyen todos los campos requeridos

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
