const fs = require("fs").promises;
const path = require("path");

class LinkedInCookiePredictor {
  constructor() {
    this.cookieHistoryPath = path.join(__dirname, "cookie_history.json");
    this.predictionConfig = {
      // Configuración para cuenta única
      maxDailySearches: 50, // Límite conservador para evitar detección
      maxDailyVisits: 30, // Límite conservador para visitas
      cookieLifespanHours: 48, // Vida típica de cookie (48 horas)
      warningThresholdHours: 6, // Advertencia 6 horas antes
      criticalThresholdHours: 2, // Crítico 2 horas antes
      activityMultiplier: 1.5, // Actividad reduce vida útil
      inactivityBonus: 0.8, // Inactividad extiende vida útil
    };
  }

  /**
   * Cargar historial de cookies
   */
  async loadCookieHistory() {
    try {
      const data = await fs.readFile(this.cookieHistoryPath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      return {
        cookies: [],
        predictions: [],
        activityLog: [],
      };
    }
  }

  /**
   * Guardar historial de cookies
   */
  async saveCookieHistory(history) {
    await fs.writeFile(
      this.cookieHistoryPath,
      JSON.stringify(history, null, 2)
    );
  }

  /**
   * Registrar nueva cookie
   */
  async registerNewCookie(cookie, source = "manual") {
    const history = await this.loadCookieHistory();

    const newCookie = {
      id: Date.now().toString(),
      cookie: cookie.substring(0, 20) + "...", // Solo primeros 20 chars por seguridad
      fullCookie: cookie,
      createdAt: new Date().toISOString(),
      source: source,
      status: "active",
      predictedExpiry: null,
      actualExpiry: null,
      usageStats: {
        searches: 0,
        visits: 0,
        lastActivity: null,
      },
    };

    // Calcular predicción de expiración
    newCookie.predictedExpiry = this.calculatePredictedExpiry(
      newCookie.createdAt
    );

    history.cookies.unshift(newCookie);

    // Mantener solo las últimas 20 cookies
    if (history.cookies.length > 20) {
      history.cookies = history.cookies.slice(0, 20);
    }

    await this.saveCookieHistory(history);
    return newCookie;
  }

  /**
   * Calcular predicción de expiración
   */
  calculatePredictedExpiry(createdAt) {
    const created = new Date(createdAt);
    const baseLifespan =
      this.predictionConfig.cookieLifespanHours * 60 * 60 * 1000; // en ms

    // Ajustar basado en actividad reciente
    const activityAdjustment = this.getActivityAdjustment();
    const adjustedLifespan = baseLifespan * activityAdjustment;

    return new Date(created.getTime() + adjustedLifespan).toISOString();
  }

  /**
   * Obtener ajuste basado en actividad
   */
  getActivityAdjustment() {
    // Por ahora, usar configuración base
    // En el futuro, esto se puede mejorar con ML
    return 1.0; // Sin ajuste por defecto
  }

  /**
   * Registrar actividad de la cookie
   */
  async logActivity(activityType, count = 1) {
    const history = await this.loadCookieHistory();

    if (history.cookies.length === 0) return;

    const currentCookie = history.cookies[0];
    currentCookie.usageStats.lastActivity = new Date().toISOString();

    if (activityType === "search") {
      currentCookie.usageStats.searches += count;
    } else if (activityType === "visit") {
      currentCookie.usageStats.visits += count;
    }

    // Recalcular predicción basada en nueva actividad
    currentCookie.predictedExpiry = this.calculatePredictedExpiry(
      currentCookie.createdAt
    );

    // Registrar en log de actividad
    history.activityLog.push({
      timestamp: new Date().toISOString(),
      activityType,
      count,
      cookieId: currentCookie.id,
    });

    // Mantener solo las últimas 100 actividades
    if (history.activityLog.length > 100) {
      history.activityLog = history.activityLog.slice(-100);
    }

    await this.saveCookieHistory(history);
  }

  /**
   * Marcar cookie como expirada
   */
  async markCookieExpired(cookieId, actualExpiry = null) {
    const history = await this.loadCookieHistory();

    const cookie = history.cookies.find((c) => c.id === cookieId);
    if (cookie) {
      cookie.status = "expired";
      cookie.actualExpiry = actualExpiry || new Date().toISOString();
    }

    await this.saveCookieHistory(history);
  }

  /**
   * Obtener predicción actual
   */
  async getCurrentPrediction() {
    const history = await this.loadCookieHistory();

    if (history.cookies.length === 0) {
      return {
        hasActiveCookie: false,
        message: "No hay cookies registradas",
      };
    }

    const currentCookie = history.cookies[0];
    const now = new Date();
    const predictedExpiry = new Date(currentCookie.predictedExpiry);
    const timeUntilExpiry = predictedExpiry.getTime() - now.getTime();
    const hoursUntilExpiry = timeUntilExpiry / (1000 * 60 * 60);

    let status = "healthy";
    let urgency = "low";
    let message = "";

    if (hoursUntilExpiry <= this.predictionConfig.criticalThresholdHours) {
      status = "critical";
      urgency = "high";
      message = `⚠️ CRÍTICO: Cookie expira en ${hoursUntilExpiry.toFixed(
        1
      )} horas`;
    } else if (
      hoursUntilExpiry <= this.predictionConfig.warningThresholdHours
    ) {
      status = "warning";
      urgency = "medium";
      message = `⚠️ ADVERTENCIA: Cookie expira en ${hoursUntilExpiry.toFixed(
        1
      )} horas`;
    } else {
      message = `✅ Cookie válida por ${hoursUntilExpiry.toFixed(1)} horas más`;
    }

    return {
      hasActiveCookie: true,
      status,
      urgency,
      message,
      currentCookie: {
        id: currentCookie.id,
        createdAt: currentCookie.createdAt,
        predictedExpiry: currentCookie.predictedExpiry,
        usageStats: currentCookie.usageStats,
      },
      hoursUntilExpiry: Math.max(0, hoursUntilExpiry),
      recommendations: this.getRecommendations(currentCookie, hoursUntilExpiry),
    };
  }

  /**
   * Obtener recomendaciones
   */
  getRecommendations(cookie, hoursUntilExpiry) {
    const recommendations = [];

    // Recomendaciones basadas en tiempo
    if (hoursUntilExpiry <= 2) {
      recommendations.push("🔴 ACTUAR AHORA: Actualizar cookie inmediatamente");
    } else if (hoursUntilExpiry <= 6) {
      recommendations.push("🟡 PREPARAR: Tener nueva cookie lista");
    } else if (hoursUntilExpiry <= 12) {
      recommendations.push("🟢 MONITOREAR: Revisar en las próximas horas");
    }

    // Recomendaciones basadas en uso
    const { searches, visits } = cookie.usageStats;
    if (searches > this.predictionConfig.maxDailySearches * 0.8) {
      recommendations.push("⚠️ Reducir búsquedas para extender vida de cookie");
    }
    if (visits > this.predictionConfig.maxDailyVisits * 0.8) {
      recommendations.push("⚠️ Reducir visitas para extender vida de cookie");
    }

    // Recomendaciones de optimización
    if (hoursUntilExpiry > 24) {
      recommendations.push("💡 Usar cookie activamente para maximizar ROI");
    }

    return recommendations;
  }

  /**
   * Obtener estadísticas de uso
   */
  async getUsageStats() {
    const history = await this.loadCookieHistory();

    if (history.cookies.length === 0) {
      return {
        totalCookies: 0,
        averageLifespan: 0,
        totalSearches: 0,
        totalVisits: 0,
      };
    }

    const activeCookies = history.cookies.filter((c) => c.status === "active");
    const expiredCookies = history.cookies.filter(
      (c) => c.status === "expired"
    );

    let totalSearches = 0;
    let totalVisits = 0;
    let totalLifespan = 0;

    history.cookies.forEach((cookie) => {
      totalSearches += cookie.usageStats.searches;
      totalVisits += cookie.usageStats.visits;

      if (cookie.actualExpiry) {
        const created = new Date(cookie.createdAt);
        const expired = new Date(cookie.actualExpiry);
        totalLifespan +=
          (expired.getTime() - created.getTime()) / (1000 * 60 * 60); // horas
      }
    });

    return {
      totalCookies: history.cookies.length,
      activeCookies: activeCookies.length,
      expiredCookies: expiredCookies.length,
      averageLifespan:
        expiredCookies.length > 0 ? totalLifespan / expiredCookies.length : 0,
      totalSearches,
      totalVisits,
      averageSearchesPerCookie:
        history.cookies.length > 0 ? totalSearches / history.cookies.length : 0,
      averageVisitsPerCookie:
        history.cookies.length > 0 ? totalVisits / history.cookies.length : 0,
    };
  }

  /**
   * Generar reporte de optimización
   */
  async generateOptimizationReport() {
    const prediction = await this.getCurrentPrediction();
    const stats = await this.getUsageStats();

    return {
      timestamp: new Date().toISOString(),
      prediction,
      stats,
      optimizationTips: this.getOptimizationTips(stats),
      nextAction: this.getNextAction(prediction),
    };
  }

  /**
   * Obtener tips de optimización
   */
  getOptimizationTips(stats) {
    const tips = [];

    if (stats.averageLifespan < 24) {
      tips.push("📈 Reducir actividad para extender vida de cookies");
    }
    if (stats.averageSearchesPerCookie > 30) {
      tips.push("🔍 Espaciar búsquedas en el tiempo");
    }
    if (stats.averageVisitsPerCookie > 20) {
      tips.push("👤 Limitar visitas de perfil por día");
    }

    tips.push(
      "⏰ Programar actualizaciones de cookie en horarios de baja actividad"
    );
    tips.push("🔄 Mantener backup de cookies válidas");
    tips.push("📊 Monitorear patrones de uso para optimizar");

    return tips;
  }

  /**
   * Obtener siguiente acción recomendada
   */
  getNextAction(prediction) {
    if (!prediction.hasActiveCookie) {
      return {
        action: "update_cookie",
        priority: "high",
        message: "Registrar nueva cookie de LinkedIn",
      };
    }

    if (prediction.urgency === "high") {
      return {
        action: "update_cookie",
        priority: "critical",
        message: "Actualizar cookie inmediatamente",
      };
    } else if (prediction.urgency === "medium") {
      return {
        action: "prepare_update",
        priority: "medium",
        message: "Preparar nueva cookie para actualización",
      };
    } else {
      return {
        action: "monitor",
        priority: "low",
        message: "Continuar monitoreo normal",
      };
    }
  }
}

module.exports = LinkedInCookiePredictor;
