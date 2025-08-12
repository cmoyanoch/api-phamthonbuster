const axios = require("axios");
const DatabaseService = require("../database-service");

// Crear instancia del servicio de base de datos
const dbService = new DatabaseService();

// Inicializar el servicio de base de datos
(async () => {
  try {
    await dbService.initialize();
    console.log("✅ ContainerStatusMonitor: Base de datos inicializada");
  } catch (error) {
    console.error(
      "❌ ContainerStatusMonitor: Error inicializando base de datos:",
      error.message
    );
  }
})();

class ContainerStatusMonitor {
  constructor() {
    this.isMonitoring = false;
    this.monitoringInterval = null;
    this.checkInterval = 30000; // 30 segundos
  }

  /**
   * Iniciar monitoreo automático de containers
   */
  async startMonitoring() {
    if (this.isMonitoring) {
      console.log("⚠️ El monitoreo ya está activo");
      return;
    }

    console.log("🚀 Iniciando monitoreo automático de containers...");
    this.isMonitoring = true;

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkAllRunningContainers();
      } catch (error) {
        console.error("❌ Error en monitoreo automático:", error.message);
      }
    }, this.checkInterval);
  }

  /**
   * Detener monitoreo automático
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    console.log("🛑 Monitoreo automático detenido");
  }

  /**
   * Verificar todos los containers en estado "running"
   */
  async checkAllRunningContainers() {
    try {
      // Obtener todos los containers en estado "running"
      const runningContainers = await dbService.getRunningContainers();

      if (runningContainers.length === 0) {
        return;
      }

      console.log(
        `🔍 Verificando ${runningContainers.length} containers en ejecución...`
      );

      for (const container of runningContainers) {
        await this.checkContainerStatus(container);
      }
    } catch (error) {
      console.error("❌ Error verificando containers:", error);
    }
  }

  /**
   * Verificar estado de un container específico
   */
  async checkContainerStatus(container) {
    try {
      const { container_id, session_id, url_id } = container;

      console.log(`🔍 Verificando container ${container_id}...`);

      // Verificar estado real en Phantombuster
      const phantombusterStatus = await this.getPhantombusterContainerStatus(
        container_id
      );

      if (!phantombusterStatus) {
        console.log(
          `⚠️ No se pudo obtener estado de container ${container_id}`
        );
        return;
      }

      // Si el container está completado, actualizar estado
      if (
        phantombusterStatus.status === "finished" ||
        phantombusterStatus.status === "completed"
      ) {
        console.log(
          `✅ Container ${container_id} completado, actualizando estado...`
        );

        await dbService.updateSequentialUrlStateStatusByContainer(
          container_id,
          "completed"
        );

        // Emitir evento de container completado
        this.emitContainerCompleted(
          container_id,
          session_id,
          url_id,
          phantombusterStatus
        );
      }
    } catch (error) {
      console.error(
        `❌ Error verificando container ${container.container_id}:`,
        error.message
      );
    }
  }

  /**
   * Obtener estado real del container desde Phantombuster
   */
  async getPhantombusterContainerStatus(containerId) {
    try {
      const response = await axios.get(
        `https://api.phantombuster.com/api/v2/containers/fetch`,
        {
          headers: {
            "X-Phantombuster-Key": process.env.PHANTOMBUSTER_API_KEY,
            "Content-Type": "application/json",
          },
          params: {
            id: containerId,
          },
        }
      );

      if (response.data && response.data.status === "success") {
        return response.data.data;
      }

      return null;
    } catch (error) {
      console.error(
        `❌ Error obteniendo estado de Phantombuster para container ${containerId}:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Emitir evento de container completado
   */
  emitContainerCompleted(containerId, sessionId, urlId, phantombusterStatus) {
    console.log(`🎉 Container ${containerId} completado automáticamente`);
    console.log(
      `📊 Resultados: ${
        phantombusterStatus.resultObject?.numberOfResults || 0
      } leads`
    );

    // Aquí se podría emitir un evento para N8N o guardar en una cola
    this.logContainerCompletion(
      containerId,
      sessionId,
      urlId,
      phantombusterStatus
    );
  }

  /**
   * Registrar completación de container
   */
  async logContainerCompletion(
    containerId,
    sessionId,
    urlId,
    phantombusterStatus
  ) {
    try {
      await dbService.logContainerCompletion({
        container_id: containerId,
        session_id: sessionId,
        url_id: urlId,
        results_count: phantombusterStatus.resultObject?.numberOfResults || 0,
        completed_at: new Date(),
        status: "auto_detected",
      });
    } catch (error) {
      console.error("❌ Error registrando completación:", error.message);
    }
  }

  /**
   * Verificar si el monitoreo está activo
   */
  isActive() {
    return this.isMonitoring;
  }

  /**
   * Obtener estadísticas del monitoreo
   */
  async getMonitoringStats() {
    try {
      const runningContainers = await dbService.getRunningContainers();
      const completedToday = await dbService.getCompletedContainersToday();

      return {
        isActive: this.isMonitoring,
        checkInterval: this.checkInterval,
        runningContainers: runningContainers.length,
        completedToday: completedToday.length,
        lastCheck: new Date(),
      };
    } catch (error) {
      console.error("❌ Error obteniendo estadísticas:", error.message);
      return {
        isActive: this.isMonitoring,
        checkInterval: this.checkInterval,
        runningContainers: 0,
        completedToday: 0,
        lastCheck: new Date(),
        error: error.message,
      };
    }
  }
}

module.exports = new ContainerStatusMonitor();
