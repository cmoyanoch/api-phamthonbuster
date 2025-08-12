const https = require("https");
const fs = require("fs").promises;
const path = require("path");
const LinkedInCookiePredictor = require("./cookie-predictor");

class LinkedInCookieManager {
  constructor() {
    this.envPath = path.join(__dirname, ".env");
    this.backupPath = path.join(__dirname, "backup_cookies.json");
    this.validationInterval = 6 * 60 * 60 * 1000; // 6 horas
    this.maxRetries = 3;
    this.isValidating = false;
    this.predictor = new LinkedInCookiePredictor();
  }

  /**
   * Validar cookie de LinkedIn con timeout mejorado
   */
  async validateCookie(cookie) {
    return new Promise((resolve) => {
      const options = {
        hostname: "www.linkedin.com",
        port: 443,
        path: "/feed/",
        method: "GET",
        headers: {
          Cookie: `li_at=${cookie}`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
        },
        timeout: 30000, // Aumentado a 30 segundos
      };

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          const isValid = res.statusCode === 200;
          const isRedirect = res.statusCode >= 300 && res.statusCode < 400;

          console.log(
            `🔍 Validación cookie: Status ${res.statusCode} - ${
              isValid
                ? "✅ Válida"
                : isRedirect
                ? "⚠️ Redirección (posible login)"
                : "❌ Inválida"
            }`
          );

          resolve({
            isValid,
            statusCode: res.statusCode,
            timestamp: new Date().toISOString(),
            isRedirect,
            headers: res.headers,
          });
        });
      });

      req.on("error", (error) => {
        console.log(`❌ Error validando cookie: ${error.message}`);
        resolve({
          isValid: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      });

      req.setTimeout(30000, () => {
        console.log("❌ Timeout validando cookie (30s)");
        resolve({
          isValid: false,
          error: "Timeout",
          timestamp: new Date().toISOString(),
        });
      });

      req.end();
    });
  }

  /**
   * Leer cookie actual del archivo .env
   */
  async getCurrentCookie() {
    try {
      const envContent = await fs.readFile(this.envPath, "utf8");
      const match = envContent.match(/LINKEDIN_SESSION_COOKIE=(.+)/);
      return match ? match[1].trim() : null;
    } catch (error) {
      console.log("❌ Error leyendo archivo .env:", error.message);
      return null;
    }
  }

  /**
   * Leer cookies de backup
   */
  async getBackupCookies() {
    try {
      const backupContent = await fs.readFile(this.backupPath, "utf8");
      return JSON.parse(backupContent);
    } catch (error) {
      console.log("⚠️ No se encontraron cookies de backup");
      return [];
    }
  }

  /**
   * Guardar cookie en backup
   */
  async saveCookieToBackup(cookie, metadata = {}) {
    try {
      const backups = await this.getBackupCookies();
      const newBackup = {
        cookie,
        timestamp: new Date().toISOString(),
        isValid: true,
        ...metadata,
      };

      // Mantener solo los últimos 10 backups
      backups.unshift(newBackup);
      if (backups.length > 10) {
        backups.splice(10);
      }

      await fs.writeFile(this.backupPath, JSON.stringify(backups, null, 2));
      console.log("💾 Cookie guardada en backup");
    } catch (error) {
      console.log("❌ Error guardando backup:", error.message);
    }
  }

  /**
   * Actualizar cookie en archivo .env
   */
  async updateCookieInEnv(newCookie) {
    try {
      let envContent = await fs.readFile(this.envPath, "utf8");

      // Reemplazar cookie existente o agregar nueva
      if (envContent.includes("LINKEDIN_SESSION_COOKIE=")) {
        envContent = envContent.replace(
          /LINKEDIN_SESSION_COOKIE=.+/,
          `LINKEDIN_SESSION_COOKIE=${newCookie}`
        );
      } else {
        envContent += `\nLINKEDIN_SESSION_COOKIE=${newCookie}`;
      }

      await fs.writeFile(this.envPath, envContent);
      console.log("✅ Cookie actualizada en .env");
      return true;
    } catch (error) {
      console.log("❌ Error actualizando .env:", error.message);
      return false;
    }
  }

  /**
   * Intentar renovar cookie automáticamente
   */
  async attemptAutoRenewal() {
    console.log("🔄 Intentando renovación automática de cookies...");

    // Obtener cookies de backup
    const backups = await this.getBackupCookies();
    const validBackups = backups.filter((b) => b.isValid);

    for (const backup of validBackups) {
      console.log(
        `🔍 Probando cookie de backup del ${new Date(
          backup.timestamp
        ).toLocaleDateString()}`
      );

      const validation = await this.validateCookie(backup.cookie);
      if (validation.isValid) {
        console.log("✅ Cookie de backup válida encontrada");
        await this.updateCookieInEnv(backup.cookie);
        return {
          success: true,
          source: "backup",
          timestamp: backup.timestamp,
        };
      }
    }

    console.log("❌ No se encontraron cookies válidas en backup");
    return {
      success: false,
      reason: "no_valid_backups",
    };
  }

  /**
   * Validar cookie actual y renovar si es necesario
   */
  async validateAndRenew() {
    if (this.isValidating) {
      console.log("⏳ Validación ya en progreso...");
      return { success: true, status: "validating_in_progress" };
    }

    this.isValidating = true;
    console.log("🔍 Iniciando validación de cookies...");

    try {
      // Obtener cookie actual
      const currentCookie = await this.getCurrentCookie();
      if (!currentCookie) {
        console.log("❌ No se encontró cookie actual");
        this.isValidating = false;
        return { success: false, reason: "no_current_cookie" };
      }

      // Validar cookie actual
      const validation = await this.validateCookie(currentCookie);

      if (validation.isValid) {
        console.log("✅ Cookie actual válida");
        // Guardar en backup si es válida
        await this.saveCookieToBackup(currentCookie, { source: "current" });
        this.isValidating = false;
        return { success: true, status: "valid" };
      } else if (validation.error === "Timeout") {
        console.log(
          "⚠️ Timeout en validación, asumiendo cookie válida para evitar bloqueos"
        );
        // En caso de timeout, asumimos que la cookie es válida para evitar bloqueos
        this.isValidating = false;
        return {
          success: true,
          status: "valid_timeout",
          message: "Timeout en validación, asumiendo válida",
        };
      } else {
        console.log("⚠️ Cookie actual inválida, intentando renovación...");

        // Intentar renovación automática
        const renewal = await this.attemptAutoRenewal();

        if (renewal.success) {
          console.log("✅ Cookie renovada automáticamente");
          this.isValidating = false;
          return { success: true, status: "renewed", source: renewal.source };
        } else {
          console.log("❌ No se pudo renovar automáticamente");
          this.isValidating = false;
          return {
            success: false,
            reason: "manual_update_required",
            message: "Se requiere actualización manual de cookies",
          };
        }
      }
    } catch (error) {
      console.log("❌ Error en validación:", error.message);
      this.isValidating = false;
      return {
        success: false,
        reason: "validation_error",
        error: error.message,
      };
    }
  }

  /**
   * Iniciar monitoreo automático
   */
  startMonitoring() {
    console.log("🚀 Iniciando monitoreo automático de cookies...");

    // Validación inicial
    this.validateAndRenew();

    // Validación periódica
    setInterval(() => {
      this.validateAndRenew();
    }, this.validationInterval);

    console.log(
      `⏰ Monitoreo configurado cada ${
        this.validationInterval / (60 * 60 * 1000)
      } horas`
    );
  }

  /**
   * Obtener estado actual del sistema
   */
  async getStatus() {
    const currentCookie = await this.getCurrentCookie();
    const backups = await this.getBackupCookies();

    let currentStatus = "unknown";
    if (currentCookie) {
      const validation = await this.validateCookie(currentCookie);
      currentStatus = validation.isValid ? "valid" : "invalid";
    }

    return {
      currentCookie: currentCookie
        ? `${currentCookie.substring(0, 20)}...`
        : null,
      currentStatus,
      backupCount: backups.length,
      lastValidation: new Date().toISOString(),
      monitoringActive: true,
    };
  }

  /**
   * Limpiar backups antiguos
   */
  async cleanupOldBackups() {
    try {
      const backups = await this.getBackupCookies();
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const validBackups = backups.filter(
        (backup) => new Date(backup.timestamp) > oneWeekAgo
      );

      await fs.writeFile(
        this.backupPath,
        JSON.stringify(validBackups, null, 2)
      );
      console.log(
        `🧹 Limpieza completada: ${
          backups.length - validBackups.length
        } backups eliminados`
      );
    } catch (error) {
      console.log("❌ Error en limpieza:", error.message);
    }
  }

  /**
   * Obtener predicción de expiración
   */
  async getPrediction() {
    try {
      return await this.predictor.getCurrentPrediction();
    } catch (error) {
      console.log("❌ Error obteniendo predicción:", error.message);
      return {
        hasActiveCookie: false,
        message: "Error obteniendo predicción",
      };
    }
  }

  /**
   * Registrar actividad de la cookie
   */
  async logActivity(activityType, count = 1) {
    try {
      await this.predictor.logActivity(activityType, count);
      console.log(`📊 Actividad registrada: ${activityType} (${count})`);
    } catch (error) {
      console.log("❌ Error registrando actividad:", error.message);
    }
  }

  /**
   * Obtener reporte de optimización
   */
  async getOptimizationReport() {
    try {
      return await this.predictor.generateOptimizationReport();
    } catch (error) {
      console.log("❌ Error generando reporte:", error.message);
      return {
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  /**
   * Actualizar cookie con predicción
   */
  async updateCookieWithPrediction(newCookie) {
    try {
      // Actualizar en .env
      const updated = await this.updateCookieInEnv(newCookie);

      if (updated) {
        // Registrar en predictor
        await this.predictor.registerNewCookie(newCookie, "manual_update");

        // Guardar en backup
        await this.saveCookieToBackup(newCookie, {
          source: "manual_update",
        });

        console.log("✅ Cookie actualizada con predicción registrada");
        return true;
      }
      return false;
    } catch (error) {
      console.log(
        "❌ Error actualizando cookie con predicción:",
        error.message
      );
      return false;
    }
  }

  /**
   * Generar hash de la cookie actual para identificación
   */
  async getSessionCookieHash() {
    try {
      const currentCookie = await this.getCurrentCookie();
      if (!currentCookie) {
        return {
          session_cookie_hash: null,
          hasCookie: false,
          message: "No hay cookie disponible",
        };
      }

      // Generar hash simple usando crypto
      const crypto = require("crypto");
      const hash = crypto
        .createHash("sha256")
        .update(currentCookie)
        .digest("hex");
      const shortHash = hash.substring(0, 16); // Primeros 16 caracteres

      return {
        session_cookie_hash: shortHash,
        hasCookie: true,
        cookieLength: currentCookie.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.log("❌ Error generando hash de cookie:", error.message);
      return {
        session_cookie_hash: null,
        hasCookie: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Obtener estado completo con predicción
   */
  async getCompleteStatus() {
    try {
      const basicStatus = await this.getStatus();
      const prediction = await this.getPrediction();
      const optimizationReport = await this.getOptimizationReport();
      const cookieHash = await this.getSessionCookieHash();

      return {
        ...basicStatus,
        ...cookieHash,
        prediction,
        optimizationReport,
        recommendations: prediction.recommendations || [],
      };
    } catch (error) {
      console.log("❌ Error obteniendo estado completo:", error.message);
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = LinkedInCookieManager;
