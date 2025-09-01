#!/bin/bash

# =====================================================
# SCRIPT DE COMPILACIÓN - API PHANTOMBUSTER
# =====================================================
# Este script compila y reinicia la API de Phantombuster
# Incluye: instalación de dependencias, compilación, reinicio y verificación
# =====================================================

set -e  # Salir si hay algún error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para imprimir mensajes
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Función para limpiar Docker antes de compilar
cleanup_docker_before() {
    print_status "🧹 Limpiando Docker antes de compilar..."

    # Eliminar imágenes sin etiqueta
    local dangling_images=$(docker images -f "dangling=true" -q)
    if [ ! -z "$dangling_images" ]; then
        print_status "Eliminando imágenes sin etiqueta..."
        docker rmi $dangling_images 2>/dev/null || print_warning "Algunas imágenes no se pudieron eliminar"
    fi

    # Limpiar contenedores detenidos
    local stopped=$(docker ps -a -q -f status=exited)
    if [ ! -z "$stopped" ]; then
        docker rm $stopped 2>/dev/null || true
    fi

    # Limpiar sistema
    docker volume prune -f >/dev/null 2>&1 || true
    docker network prune -f >/dev/null 2>&1 || true

    print_success "✅ Sistema Docker limpio - listo para compilar"
}

# Función para limpiar Docker después de compilar
cleanup_docker_after() {
    print_status "🧹 Limpieza post-compilación..."

    # Eliminar imágenes sin etiqueta generadas
    local dangling_images=$(docker images -f "dangling=true" -q)
    if [ ! -z "$dangling_images" ]; then
        docker rmi $dangling_images 2>/dev/null || true
    fi

    # Limpiar caché de build
    docker builder prune -f >/dev/null 2>&1 || true

    print_success "✅ Limpieza post-compilación completada"
}

# Función para verificar requisitos
check_requirements() {
    print_status "Verificando requisitos del sistema..."

    # Guardar el directorio actual
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # Cambiar al directorio raíz del proyecto (un nivel arriba)
    cd "$SCRIPT_DIR/.."

    # Verificar que estemos en el directorio correcto
    if [ ! -f "docker-compose.yml" ]; then
        print_error "No se encontró docker-compose.yml. Asegúrate de estar en la raíz del proyecto."
        exit 1
    fi

    # Verificar que exista el directorio api-phamthonbuster
    if [ ! -d "api-phamthonbuster" ]; then
        print_error "No se encontró el directorio api-phamthonbuster."
        exit 1
    fi

    # Verificar Docker
    if ! command -v docker >/dev/null 2>&1; then
        print_error "Docker no está instalado. Por favor instala Docker."
        exit 1
    fi

    print_success "Todos los requisitos están cumplidos"
}

# Función para instalar dependencias faltantes
install_dependencies() {
    print_status "📦 Verificando e instalando dependencias..."

    cd api-phamthonbuster

    # Verificar si winston está instalado
    if ! npm list winston >/dev/null 2>&1; then
        print_status "Instalando winston (sistema de logging)..."
        npm install winston
        print_success "✅ winston instalado"
    else
        print_success "✅ winston ya está instalado"
    fi

    # Verificar si cheerio está instalado
    if ! npm list cheerio >/dev/null 2>&1; then
        print_status "Instalando cheerio (versión compatible con Node.js 18)..."
        npm install cheerio@1.0.0-rc.12
        print_success "✅ cheerio instalado"
    else
        print_success "✅ cheerio ya está instalado"
    fi

    # Verificar otras dependencias críticas
    local critical_deps=("express" "axios" "pg" "redis" "cors" "helmet")
    for dep in "${critical_deps[@]}"; do
        if ! npm list "$dep" >/dev/null 2>&1; then
            print_warning "⚠️  Dependencia faltante: $dep"
            print_status "Instalando $dep..."
            npm install "$dep"
        fi
    done

    cd ..
    print_success "✅ Todas las dependencias verificadas e instaladas"
}

# Función para compilar la API
build_api() {
    print_status "🔨 Compilando API Phantombuster..."

    # Compilar sin caché para asegurar cambios
    if docker compose build phantombuster-api --no-cache; then
        print_success "✅ API Phantombuster compilada exitosamente"
    else
        print_error "❌ Error en la compilación de la API"
        exit 1
    fi
}



# Función para reiniciar el servicio
restart_service() {
    print_status "🔄 Reiniciando servicio phantombuster-api..."

    if docker compose restart phantombuster-api; then
        print_success "✅ Servicio reiniciado exitosamente"
    else
        print_error "❌ Error al reiniciar el servicio"
        exit 1
    fi
}

# Función para verificar el servicio
check_service() {
    print_status "🔍 Verificando estado del servicio..."

    # Esperar a que el servicio se inicie
    print_status "⏳ Esperando 15 segundos para que el servicio se inicie completamente..."
    sleep 15

    # Verificar estado del contenedor
    echo ""
    print_status "📊 Estado del contenedor:"
    docker compose ps phantombuster-api

    # Verificar health check
    echo ""
    print_status "🏥 Verificando health check..."

    # Intentar múltiples endpoints
    local endpoints=("/health" "/api/health" "/status")
    local api_responding=false

    for endpoint in "${endpoints[@]}"; do
        if curl -f http://localhost:3001$endpoint >/dev/null 2>&1; then
            print_success "✅ API Phantombuster está respondiendo en $endpoint"
            api_responding=true

            # Mostrar respuesta del health check
            echo ""
            print_status "📄 Respuesta del health check:"
            curl -s http://localhost:3001$endpoint | jq . 2>/dev/null || curl -s http://localhost:3001$endpoint
            break
        fi
    done

    if [ "$api_responding" = false ]; then
        print_warning "⚠️ API no responde aún (puede estar iniciando)"
        print_status "📋 Verificando logs del contenedor..."
        docker compose logs phantombuster-api --tail=10
    fi
}

# Función para mostrar logs
show_logs() {
    print_status "📋 Mostrando logs recientes..."

    echo ""
    docker compose logs phantombuster-api --tail=20
}

# Función para verificar conectividad completa
check_connectivity() {
    print_status "🌐 Verificando conectividad completa del sistema..."

    echo ""
    print_status "📊 Estado de todos los servicios:"
    docker compose ps

    echo ""
    print_status "🔗 Verificando conectividad de servicios:"

    # Verificar WebApp
    if curl -s -o /dev/null -w "WebApp: %{http_code}\n" http://localhost:3000; then
        print_success "✅ WebApp respondiendo"
    else
        print_warning "⚠️ WebApp no responde"
    fi

    # Verificar API
    if curl -s -o /dev/null -w "API: %{http_code}\n" http://localhost:3001/api/health; then
        print_success "✅ API respondiendo"
    else
        print_warning "⚠️ API no responde"
    fi

    # Verificar Redis
    if docker compose exec redis redis-cli ping >/dev/null 2>&1; then
        print_success "✅ Redis funcionando"
    else
        print_warning "⚠️ Redis no responde"
    fi

    # Verificar PostgreSQL
    if docker compose exec n8n_postgres pg_isready -U n8n_user >/dev/null 2>&1; then
        print_success "✅ PostgreSQL funcionando"
    else
        print_warning "⚠️ PostgreSQL no responde"
    fi
}

# Función para mostrar información final
show_final_info() {
    echo ""
    echo "====================================================="
    print_success "🎉 COMPILACIÓN API PHANTOMBUSTER COMPLETADA"
    echo "====================================================="
    echo ""
    echo "📱 Servicios disponibles:"
    echo "   • WebApp Next.js: http://localhost:3000"
    echo "   • API Phantombuster: http://localhost:3001"
    echo "   • n8n Workflows: http://localhost:5678"
    echo "   • PgAdmin: http://localhost:8080"
    echo ""
    echo "🔧 Comandos útiles:"
    echo "   • Ver logs API: docker compose logs phantombuster-api -f"
    echo "   • Reiniciar API: docker compose restart phantombuster-api"
    echo "   • Estado completo: docker compose ps"
    echo "   • Health check API: curl http://localhost:3001/api/health"
    echo ""
    echo "📊 Endpoints principales:"
    echo "   • Health: GET /api/health"
    echo "   • Search: POST /api/search/start"
    echo "   • Profile Visitor: POST /api/profile-visitor/visit-single"
    echo "   • Domain Scraper: POST /api/domain-scraper/extract-address"
    echo "   • Config: GET /api/config"
    echo ""
    echo "🔒 Autenticación:"
    echo "   • Header: X-API-Key: dev-api-key-12345"
    echo ""
    echo "📦 Dependencias instaladas:"
    echo "   • winston (logging)"
    echo "   • cheerio (web scraping)"
    echo "   • express, axios, pg, redis, cors, helmet"
    echo ""
    echo "====================================================="
}

# Función para mostrar ayuda
show_help() {
    echo "Uso: $0 [OPCIÓN]"
    echo ""
    echo "Opciones:"
    echo "  build       - Compilar y reiniciar (default)"
    echo "  deps        - Solo instalar dependencias"
    echo "  restart     - Solo reiniciar servicio"
    echo "  check       - Solo verificar estado"
    echo "  connectivity- Verificar conectividad completa"
    echo "  logs        - Mostrar logs"
    echo "  help        - Mostrar esta ayuda"
    echo ""
    echo "Ejemplos:"
    echo "  $0              - Compilación completa"
    echo "  $0 deps         - Solo instalar dependencias"
    echo "  $0 restart      - Solo reiniciar"
    echo "  $0 check        - Solo verificar"
    echo "  $0 connectivity - Verificar conectividad completa"
}

# Función principal
main() {
    case "${1:-build}" in
        "build")
            echo "====================================================="
            echo "🚀 COMPILACIÓN API PHANTOMBUSTER"
            echo "====================================================="
            echo ""

            check_requirements
            install_dependencies
            cleanup_docker_before
            build_api
            cleanup_docker_after
            restart_service
            check_service
            check_connectivity
            show_final_info

                print_success "¡Compilación completada exitosamente!"
            ;;
        "deps")
            echo "====================================================="
            echo "📦 INSTALACIÓN DE DEPENDENCIAS"
            echo "====================================================="
            echo ""

            check_requirements
            install_dependencies
            print_success "¡Dependencias instaladas exitosamente!"
            ;;
        "restart")
            echo "====================================================="
            echo "🔄 REINICIO API PHANTOMBUSTER"
            echo "====================================================="
            echo ""

            check_requirements
            restart_service
            check_service
            show_final_info

            print_success "¡Reinicio completado exitosamente!"
            ;;
        "check")
            echo "====================================================="
            echo "🔍 VERIFICACIÓN API PHANTOMBUSTER"
            echo "====================================================="
            echo ""

            check_requirements
            check_service
            show_logs

            print_success "¡Verificación completada!"
            ;;
        "connectivity")
            echo "====================================================="
            echo "🌐 VERIFICACIÓN DE CONECTIVIDAD COMPLETA"
            echo "====================================================="
            echo ""

            check_requirements
            check_connectivity
            show_logs

            print_success "¡Verificación de conectividad completada!"
            ;;
        "logs")
            echo "====================================================="
            echo "📋 LOGS API PHANTOMBUSTER"
            echo "====================================================="
            echo ""

            check_requirements
            show_logs

            print_success "¡Logs mostrados!"
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            print_error "Opción desconocida: $1"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# Ejecutar función principal
main "$@"
