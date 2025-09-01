class MetricsCollector {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        byEndpoint: {},
        byStatus: {},
        byMethod: {},
      },
      performance: {
        responseTimes: [],
        averageResponseTime: 0,
      },
      errors: {
        total: 0,
        byType: {},
        byEndpoint: {},
      },
      phantombuster: {
        searches: {
          total: 0,
          successful: 0,
          failed: 0,
          averageDuration: 0,
        },
        profileVisits: {
          total: 0,
          successful: 0,
          failed: 0,
          averageDuration: 0,
        },
      },
      cookies: {
        validations: {
          total: 0,
          successful: 0,
          failed: 0,
          renewals: 0,
        },
      },
      database: {
        connections: 0,
        queries: 0,
        errors: 0,
      },
    };

    this.startTime = Date.now();
  }

  // Métricas de requests
  recordRequest(endpoint, method, statusCode, responseTime) {
    this.metrics.requests.total++;

    // Por endpoint
    if (!this.metrics.requests.byEndpoint[endpoint]) {
      this.metrics.requests.byEndpoint[endpoint] = 0;
    }
    this.metrics.requests.byEndpoint[endpoint]++;

    // Por método
    if (!this.metrics.requests.byMethod[method]) {
      this.metrics.requests.byMethod[method] = 0;
    }
    this.metrics.requests.byMethod[method]++;

    // Por status
    const statusCategory = Math.floor(statusCode / 100) * 100;
    if (!this.metrics.requests.byStatus[statusCategory]) {
      this.metrics.requests.byStatus[statusCategory] = 0;
    }
    this.metrics.requests.byStatus[statusCategory]++;

    // Tiempo de respuesta
    this.metrics.performance.responseTimes.push(responseTime);
    this.updateAverageResponseTime();
  }

  // Métricas de errores
  recordError(errorType, endpoint, errorMessage) {
    this.metrics.errors.total++;

    if (!this.metrics.errors.byType[errorType]) {
      this.metrics.errors.byType[errorType] = 0;
    }
    this.metrics.errors.byType[errorType]++;

    if (!this.metrics.errors.byEndpoint[endpoint]) {
      this.metrics.errors.byEndpoint[endpoint] = 0;
    }
    this.metrics.errors.byEndpoint[endpoint]++;
  }

  // Métricas de Phantombuster
  recordPhantombusterSearch(success, duration) {
    this.metrics.phantombuster.searches.total++;

    if (success) {
      this.metrics.phantombuster.searches.successful++;
    } else {
      this.metrics.phantombuster.searches.failed++;
    }

    this.updateAverageSearchDuration(duration);
  }

  recordPhantombusterProfileVisit(success, duration) {
    this.metrics.phantombuster.profileVisits.total++;

    if (success) {
      this.metrics.phantombuster.profileVisits.successful++;
    } else {
      this.metrics.phantombuster.profileVisits.failed++;
    }

    this.updateAverageProfileVisitDuration(duration);
  }

  // Métricas de Phantombuster Autoconnect
  recordPhantombusterAutoconnect(success, duration) {
    // Inicializar si no existe
    if (!this.metrics.phantombuster.autoconnect) {
      this.metrics.phantombuster.autoconnect = {
        total: 0,
        successful: 0,
        failed: 0,
        averageDuration: 0
      };
    }

    this.metrics.phantombuster.autoconnect.total++;

    if (success) {
      this.metrics.phantombuster.autoconnect.successful++;
    } else {
      this.metrics.phantombuster.autoconnect.failed++;
    }

    this.updateAverageAutoconnectDuration(duration);
  }

  updateAverageAutoconnectDuration(newDuration) {
    if (!this.metrics.phantombuster.autoconnect) return;
    
    const total = this.metrics.phantombuster.autoconnect.total;
    const currentAvg = this.metrics.phantombuster.autoconnect.averageDuration;
    
    this.metrics.phantombuster.autoconnect.averageDuration = 
      ((currentAvg * (total - 1)) + newDuration) / total;
  }

  // Métricas de Phantombuster Message Sender
  recordPhantombusterMessageSender(success, duration) {
    // Inicializar si no existe
    if (!this.metrics.phantombuster.messageSender) {
      this.metrics.phantombuster.messageSender = {
        total: 0,
        successful: 0,
        failed: 0,
        averageDuration: 0
      };
    }

    this.metrics.phantombuster.messageSender.total++;

    if (success) {
      this.metrics.phantombuster.messageSender.successful++;
    } else {
      this.metrics.phantombuster.messageSender.failed++;
    }

    this.updateAverageMessageSenderDuration(duration);
  }

  updateAverageMessageSenderDuration(newDuration) {
    if (!this.metrics.phantombuster.messageSender) return;
    
    const total = this.metrics.phantombuster.messageSender.total;
    const currentAvg = this.metrics.phantombuster.messageSender.averageDuration;
    
    this.metrics.phantombuster.messageSender.averageDuration = 
      ((currentAvg * (total - 1)) + newDuration) / total;
  }

  // Métricas de Domain Scraping
  recordDomainScraping(success, duration) {
    // Inicializar si no existe
    if (!this.metrics.domainScraping) {
      this.metrics.domainScraping = {
        total: 0,
        successful: 0,
        failed: 0,
        averageDuration: 0
      };
    }

    this.metrics.domainScraping.total++;

    if (success) {
      this.metrics.domainScraping.successful++;
    } else {
      this.metrics.domainScraping.failed++;
    }

    this.updateAverageDomainScrapingDuration(duration);
  }

  updateAverageDomainScrapingDuration(newDuration) {
    if (!this.metrics.domainScraping) return;
    
    const total = this.metrics.domainScraping.total;
    const currentAvg = this.metrics.domainScraping.averageDuration;
    
    this.metrics.domainScraping.averageDuration = 
      ((currentAvg * (total - 1)) + newDuration) / total;
  }

  recordPhantombusterProfileVisitContinued(success, duration) {
    this.metrics.phantombuster.profileVisits.total++;

    if (success) {
      this.metrics.phantombuster.profileVisits.successful++;
    } else {
      this.metrics.phantombuster.profileVisits.failed++;
    }

    this.updateAverageProfileVisitDuration(duration);
  }

  // Métricas de cookies
  recordCookieValidation(success, renewed = false) {
    this.metrics.cookies.validations.total++;

    if (success) {
      this.metrics.cookies.validations.successful++;
    } else {
      this.metrics.cookies.validations.failed++;
    }

    if (renewed) {
      this.metrics.cookies.validations.renewals++;
    }
  }

  // Métricas de base de datos
  recordDatabaseConnection() {
    this.metrics.database.connections++;
  }

  recordDatabaseQuery() {
    this.metrics.database.queries++;
  }

  recordDatabaseError() {
    this.metrics.database.errors++;
  }

  // Métodos de cálculo
  updateAverageResponseTime() {
    const times = this.metrics.performance.responseTimes;
    if (times.length > 0) {
      this.metrics.performance.averageResponseTime =
        times.reduce((sum, time) => sum + time, 0) / times.length;
    }
  }

  updateAverageSearchDuration(duration) {
    const searches = this.metrics.phantombuster.searches;
    if (searches.successful > 0) {
      searches.averageDuration = duration;
    }
  }

  updateAverageProfileVisitDuration(duration) {
    const visits = this.metrics.phantombuster.profileVisits;
    if (visits.successful > 0) {
      visits.averageDuration = duration;
    }
  }

  // Obtener métricas
  getMetrics() {
    const uptime = Date.now() - this.startTime;

    return {
      ...this.metrics,
      system: {
        uptime,
        uptimeFormatted: this.formatUptime(uptime),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
      },
      calculated: {
        successRate: this.calculateSuccessRate(),
        errorRate: this.calculateErrorRate(),
        averageResponseTime: this.metrics.performance.averageResponseTime,
      },
    };
  }

  // Métricas específicas
  getRequestMetrics() {
    return this.metrics.requests;
  }

  getErrorMetrics() {
    return this.metrics.errors;
  }

  getPhantombusterMetrics() {
    return this.metrics.phantombuster;
  }

  getCookieMetrics() {
    return this.metrics.cookies;
  }

  getDatabaseMetrics() {
    return this.metrics.database;
  }

  // Cálculos
  calculateSuccessRate() {
    const total = this.metrics.requests.total;
    const successful = this.metrics.requests.byStatus[200] || 0;
    return total > 0 ? (successful / total) * 100 : 0;
  }

  calculateErrorRate() {
    const total = this.metrics.requests.total;
    const errors = this.metrics.errors.total;
    return total > 0 ? (errors / total) * 100 : 0;
  }

  // Utilidades
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  // Reset métricas
  resetMetrics() {
    this.metrics = {
      requests: { total: 0, byEndpoint: {}, byStatus: {}, byMethod: {} },
      performance: { responseTimes: [], averageResponseTime: 0 },
      errors: { total: 0, byType: {}, byEndpoint: {} },
      phantombuster: {
        searches: { total: 0, successful: 0, failed: 0, averageDuration: 0 },
        profileVisits: {
          total: 0,
          successful: 0,
          failed: 0,
          averageDuration: 0,
        },
      },
      cookies: {
        validations: { total: 0, successful: 0, failed: 0, renewals: 0 },
      },
      database: { connections: 0, queries: 0, errors: 0 },
    };
    this.startTime = Date.now();
  }
}

// Singleton instance
const metricsCollector = new MetricsCollector();

module.exports = metricsCollector;
