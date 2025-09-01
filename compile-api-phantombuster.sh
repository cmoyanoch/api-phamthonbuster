#!/bin/bash

# =====================================================
# SCRIPT DE COMPILACIÓN - API PHANTOMBUSTER
# =====================================================
# Este script compila y reinicia la API de Phantombuster
# Incluye: compilación, reinicio y verificación
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

# Función para compilar la API
build_api() {
    print_status "Compilando API Phantombuster..."

    # Compilar sin caché para asegurar cambios
    if docker compose build phantombuster-api --no-cache; then
        print_success "API Phantombuster compilada exitosamente"
    else
        print_error "Error en la compilación de la API"
        exit 1
    fi
}

# Función para ejecutar migración de base de datos
run_migration() {
    print_status "Verificando migración de base de datos..."

    # Verificar si las tablas ya existen (con mejor manejo de errores)
    if docker compose exec n8n_postgres psql -U n8n_user -d n8n_db -c "\dt phantombuster.searches" 2>/dev/null | grep -q "searches"; then
        print_success "Tablas ya existen, saltando migración"
        return 0
    elif docker compose exec n8n_postgres psql -U n8n_user -d n8n_db -c "\dt" 2>/dev/null | grep -q "phantombuster"; then
        print_success "Esquema phantombuster ya existe, saltando migración"
        return 0
    else
        print_status "Tablas no encontradas, ejecutando migración..."

        # Ejecutar migración dentro del contenedor
        if docker compose exec phantombuster-api node database-service.js; then
            print_success "Migración de base de datos completada"
        else
            print_warning "Error en migración de base de datos (puede ser normal si ya existe)"
        fi
    fi
}

# Función para reiniciar el servicio
restart_service() {
    print_status "Reiniciando servicio phantombuster-api..."

    if docker compose restart phantombuster-api; then
        print_success "Servicio reiniciado exitosamente"
    else
        print_error "Error al reiniciar el servicio"
        exit 1
    fi
}

# Función para verificar el servicio
check_service() {
    print_status "Verificando estado del servicio..."

    # Esperar a que el servicio se inicie
    sleep 10

    # Verificar estado del contenedor
    echo ""
    print_status "Estado del contenedor:"
    docker compose ps phantombuster-api

    # Verificar health check
    echo ""
    print_status "Verificando health check..."
    if curl -f http://localhost:3001/health >/dev/null 2>&1; then
        print_success "✅ API Phantombuster está respondiendo correctamente"

        # Mostrar respuesta del health check
        echo ""
        print_status "Respuesta del health check:"
        curl -s http://localhost:3001/health | jq . 2>/dev/null || curl -s http://localhost:3001/health
    else
        print_warning "⚠️  API no responde aún (puede estar iniciando)"
    fi
}

# Función para mostrar logs
show_logs() {
    print_status "Mostrando logs recientes..."

    echo ""
    docker compose logs phantombuster-api --tail=20
}

# Función para mostrar información final
show_final_info() {
    echo ""
    echo "====================================================="
    print_success "🎉 COMPILACIÓN API PHANTOMBUSTER COMPLETADA"
    echo "====================================================="
    echo ""
    echo "📱 Servicio disponible:"
    echo "   • API Phantombuster: http://localhost:3001"
    echo ""
    echo "🔧 Comandos útiles:"
    echo "   • Ver logs: docker compose logs phantombuster-api -f"
    echo "   • Reiniciar: docker compose restart phantombuster-api"
    echo "   • Estado: docker compose ps phantombuster-api"
    echo "   • Health check: curl http://localhost:3001/health"
    echo ""
    echo "📊 Endpoints principales:"
    echo "   • Health: GET /health"
    echo "   • Search: POST /api/search/start"
    echo "   • Profile Visitor: POST /api/profile-visitor/visit-single"
    echo "   • Config: GET /api/config"
    echo ""
    echo "🔒 Autenticación:"
    echo "   • Header: X-API-Key: dev-api-key-12345"
    echo ""
    echo "====================================================="
}

# Función para mostrar ayuda
show_help() {
    echo "Uso: $0 [OPCIÓN]"
    echo ""
    echo "Opciones:"
    echo "  build     - Compilar y reiniciar (default)"
    echo "  migrate   - Solo ejecutar migración de BD"
    echo "  restart   - Solo reiniciar servicio"
    echo "  check     - Solo verificar estado"
    echo "  logs      - Mostrar logs"
    echo "  help      - Mostrar esta ayuda"
    echo ""
    echo "Ejemplos:"
    echo "  $0         - Compilación completa"
    echo "  $0 migrate - Solo migración de BD"
    echo "  $0 restart - Solo reiniciar"
    echo "  $0 check   - Solo verificar"
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
            build_api
            restart_service
            run_migration
            check_service
            show_final_info

            print_success "¡Compilación completada exitosamente!"
            print_status "📊 Persistencia de datos habilitada"
            ;;
        "migrate")
            echo "====================================================="
            echo "🗄️ MIGRACIÓN BASE DE DATOS"
            echo "====================================================="
            echo ""

            check_requirements
            run_migration
            print_success "¡Migración completada!"
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
