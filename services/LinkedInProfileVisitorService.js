const DatabaseService = require("../database-service");

class LinkedInProfileVisitorService {
  constructor() {
    this.dbService = new DatabaseService();
    this.dailyVisitLimit = parseInt(process.env.DAILY_VISIT_LIMIT) || 100;
  }

  async checkDailyLimits(userId = "default") {
    try {
      const today = new Date().toISOString().split("T")[0];
      const limits = await this.dbService.getDailyLimits(userId, today);

      const currentVisits = limits.visits || 0;
      const currentSearches = limits.searches || 0;

      return {
        visits: {
          current: currentVisits,
          limit: this.dailyVisitLimit,
          remaining: Math.max(0, this.dailyVisitLimit - currentVisits),
          exceeded: currentVisits >= this.dailyVisitLimit,
        },
        searches: {
          current: currentSearches,
          limit: 50,
          remaining: Math.max(0, 50 - currentSearches),
          exceeded: currentSearches >= 50,
        },
      };
    } catch (error) {
      console.error("❌ Error verificando límites diarios:", error);
      return {
        visits: {
          current: 0,
          limit: this.dailyVisitLimit,
          remaining: this.dailyVisitLimit,
          exceeded: false,
        },
        searches: { current: 0, limit: 50, remaining: 50, exceeded: false },
      };
    }
  }

  async incrementDailyVisits(userId = "default") {
    try {
      const today = new Date().toISOString().split("T")[0];
      await this.dbService.incrementVisitCount(userId, today);
      console.log(`✅ Visita incrementada para usuario ${userId}`);
    } catch (error) {
      console.error("❌ Error incrementando visitas:", error);
    }
  }

  async visitSingleProfile(profileUrl, options = {}) {
    try {
      const visitId = `visit_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      console.log(`🔍 Iniciando visita a perfil: ${profileUrl}`);

      // Verificar límites diarios
      const limits = await this.checkDailyLimits(options.userId);
      if (limits.visits.exceeded) {
        throw new Error(
          `Límite diario de visitas excedido (${limits.visits.current}/${limits.visits.limit})`
        );
      }

      // Crear registro de visita
      const visitData = {
        visitId,
        profileUrl,
        status: "pending",
        createdAt: new Date().toISOString(),
        userId: options.userId || "default",
        options,
      };

      await this.dbService.saveProfileVisit(visitData);

      // Simular visita
      const visitResult = await this.simulateProfileVisit(profileUrl, options);

      // Completar visita
      await this.completeVisit(visitId, visitResult);

      // Incrementar contador diario
      await this.incrementDailyVisits(options.userId);

      return {
        success: true,
        visitId,
        profileUrl,
        result: visitResult,
        message: "Visita completada exitosamente",
      };
    } catch (error) {
      console.error("❌ Error visitando perfil:", error);
      throw error;
    }
  }

  async completeVisit(visitId, visitResult) {
    try {
      await this.dbService.updateProfileVisitStatus(
        visitId,
        "completed",
        100,
        visitResult,
        null
      );
      console.log(`✅ Visita ${visitId} completada`);
    } catch (error) {
      console.error("❌ Error completando visita:", error);
    }
  }

  getVisitConfig(leadType) {
    const configs = {
      "1st": {
        delayBeforeVisit: 2000,
        visitDuration: 30000,
        scrollActions: 3,
        interactionProbability: 0.3,
      },
      "2nd": {
        delayBeforeVisit: 1500,
        visitDuration: 20000,
        scrollActions: 2,
        interactionProbability: 0.2,
      },
      "3rd+": {
        delayBeforeVisit: 1000,
        visitDuration: 15000,
        scrollActions: 1,
        interactionProbability: 0.1,
      },
    };

    return configs[leadType] || configs["3rd+"];
  }

  async simulateProfileVisit(profileUrl, options = {}) {
    try {
      const leadType = this.getLeadTypeFromDegree(options.connectionDegree);
      const config = this.getVisitConfig(leadType);

      console.log(`🎭 Simulando visita con configuración:`, config);

      // Simular delay antes de la visita
      await this.delay(config.delayBeforeVisit);

      // Simular acciones durante la visita
      const actions = [];

      // Simular scroll
      for (let i = 0; i < config.scrollActions; i++) {
        actions.push({
          type: "scroll",
          timestamp: new Date().toISOString(),
          duration: Math.random() * 2000 + 1000,
        });
        await this.delay(1000 + Math.random() * 2000);
      }

      // Simular posible interacción
      if (Math.random() < config.interactionProbability) {
        actions.push({
          type: "interaction",
          action: "view_contact_info",
          timestamp: new Date().toISOString(),
        });
      }

      const visitResult = {
        success: true,
        profileUrl,
        visitDuration: config.visitDuration,
        actions,
        leadType,
        timestamp: new Date().toISOString(),
        userAgent:
          process.env.LINKEDIN_USER_AGENT ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      };

      console.log(`✅ Simulación de visita completada para ${profileUrl}`);
      return visitResult;
    } catch (error) {
      console.error("❌ Error simulando visita:", error);
      return {
        success: false,
        profileUrl,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  extractNameFromUrl(url) {
    try {
      const match = url.match(/\/in\/([^\/\?]+)/);
      return match ? decodeURIComponent(match[1]) : "Unknown";
    } catch (error) {
      return "Unknown";
    }
  }

  async scheduleFollowUp(profileUrl, options = {}) {
    try {
      const followUpData = {
        profileUrl,
        scheduledFor:
          options.scheduledFor ||
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        type: options.type || "message",
        message:
          options.message ||
          "Hi! I noticed your profile and would love to connect.",
        status: "scheduled",
        createdAt: new Date().toISOString(),
        userId: options.userId || "default",
      };

      await this.dbService.saveFollowUp(followUpData);
      console.log(`📅 Follow-up programado para ${profileUrl}`);

      return {
        success: true,
        followUpId: followUpData.id,
        scheduledFor: followUpData.scheduledFor,
        message: "Follow-up programado exitosamente",
      };
    } catch (error) {
      console.error("❌ Error programando follow-up:", error);
      throw error;
    }
  }

  async processProfileList(profileUrls, options = {}) {
    try {
      const batchId = `batch_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const delay = options.delayBetweenVisits || 30000;

      console.log(`🚀 Procesando lote de ${profileUrls.length} perfiles`);

      const results = await this.processProfilesSequentially(
        batchId,
        profileUrls,
        options,
        delay
      );

      return {
        success: true,
        batchId,
        totalProfiles: profileUrls.length,
        processedProfiles: results.length,
        results,
        message: `Lote procesado: ${results.length}/${profileUrls.length} perfiles visitados`,
      };
    } catch (error) {
      console.error("❌ Error procesando lote de perfiles:", error);
      throw error;
    }
  }

  async processProfilesSequentially(batchId, profileUrls, options, delay) {
    const results = [];

    for (let i = 0; i < profileUrls.length; i++) {
      try {
        console.log(
          `📋 Procesando perfil ${i + 1}/${profileUrls.length}: ${
            profileUrls[i]
          }`
        );

        const result = await this.visitSingleProfile(profileUrls[i], {
          ...options,
          batchId,
          profileIndex: i,
        });

        results.push(result);

        // Delay entre visitas (excepto la última)
        if (i < profileUrls.length - 1) {
          console.log(
            `⏳ Esperando ${delay}ms antes de la siguiente visita...`
          );
          await this.delay(delay);
        }
      } catch (error) {
        console.error(`❌ Error procesando perfil ${profileUrls[i]}:`, error);
        results.push({
          success: false,
          profileUrl: profileUrls[i],
          error: error.message,
          profileIndex: i,
        });
      }
    }

    return results;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getTodayFollowUps() {
    try {
      const followUps = await this.dbService.getTodayFollowUps();
      return {
        success: true,
        followUps,
        count: followUps.length,
        message: `${followUps.length} follow-ups programados para hoy`,
      };
    } catch (error) {
      console.error("❌ Error obteniendo follow-ups de hoy:", error);
      return {
        success: false,
        followUps: [],
        count: 0,
        error: error.message,
      };
    }
  }

  wasVisitedRecently(profileUrl, days = 7) {
    // Esta función verificaría si un perfil fue visitado recientemente
    // Implementación simplificada - en producción usaría la base de datos
    return false;
  }

  getLeadTypeFromDegree(degree) {
    const mapping = {
      1: "1st",
      2: "2nd",
      "3+": "3rd+",
      "1st": "1st",
      "2nd": "2nd",
      "3rd+": "3rd+",
    };
    return mapping[degree] || "3rd+";
  }
}

module.exports = LinkedInProfileVisitorService;
