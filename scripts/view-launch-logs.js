#!/usr/bin/env node

/**
 * Script para revisar logs de ejecuciones de launchSearchAgentWithUrl
 * Uso: node scripts/view-launch-logs.js [opciones]
 */

const fs = require("fs");
const path = require("path");

const logsDir = path.join(__dirname, "../logs");

function showHelp() {
  console.log(`
🔍 VISOR DE LOGS DE LAUNCH SEARCH AGENT
========================================

📋 Comandos disponibles:

   today                    - Ver logs del día actual
   date YYYY-MM-DD         - Ver logs de una fecha específica
   summary                 - Ver resumen de todas las ejecuciones
   execution [id]          - Ver logs detallados de una ejecución específica
   body [id]               - Ver el body completo enviado a Phantombuster
   list                    - Listar archivos de log disponibles

📝 Ejemplos:
   node scripts/view-launch-logs.js today
   node scripts/view-launch-logs.js execution exec_1234567890_abc123
   node scripts/view-launch-logs.js body exec_1234567890_abc123
   node scripts/view-launch-logs.js date 2025-08-10
`);
}

function getLogFile(date) {
  return path.join(logsDir, `launch-search-${date}.json`);
}

function loadLogs(date) {
  const logFile = getLogFile(date);
  if (!fs.existsSync(logFile)) {
    return [];
  }

  try {
    const content = fs.readFileSync(logFile, "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`❌ Error leyendo archivo de log: ${error.message}`);
    return [];
  }
}

function showTodayLogs() {
  const today = new Date().toISOString().split("T")[0];
  const logs = loadLogs(today);

  if (logs.length === 0) {
    console.log(`📅 No hay logs para el día: ${today}`);
    return;
  }

  console.log(`📅 Mostrando logs del día: ${today}`);
  console.log("==================================================\n");

  logs.forEach((log) => {
    const timestamp = new Date(log.timestamp).toLocaleString("es-ES");
    const containerId = log.containerId || "N/A";
    const url = log.searchUrl || log.url || "N/A";
    const shortUrl = url.length > 50 ? url.substring(0, 50) + "..." : url;

    if (log.success) {
      console.log(`✅ Ejecución: ${log.executionId}`);
      console.log(`   🕐 ${timestamp}`);
      console.log(`   🆔 Container: ${containerId}`);
      console.log(`   🔗 URL: ${shortUrl}`);
    } else {
      console.log(`❌ Ejecución: ${log.executionId}`);
      console.log(`   🕐 ${timestamp}`);
      console.log(`   🆔 Container: ${containerId}`);
      console.log(`   🔗 URL: ${shortUrl}`);
      if (log.error) {
        console.log(`   ❌ Error: ${log.error}`);
      }
    }
    console.log("");
  });
}

function showExecutionLogs(executionId) {
  const today = new Date().toISOString().split("T")[0];
  const logs = loadLogs(today);

  const executionLogs = logs.filter((log) => log.executionId === executionId);

  if (executionLogs.length === 0) {
    console.log(`❌ No se encontraron logs para la ejecución: ${executionId}`);
    return;
  }

  console.log(`🔍 LOGS DE EJECUCIÓN: ${executionId}`);
  console.log("==================================================\n");

  executionLogs.forEach((log) => {
    const timestamp = new Date(log.timestamp).toLocaleString("es-ES");
    console.log(`📝 Fase: ${log.phase}`);
    console.log(`🕐 Timestamp: ${log.timestamp}`);

    if (log.searchUrl) {
      console.log(`🔗 URL: ${log.searchUrl}`);
    }

    if (log.parameters) {
      console.log(`⚙️ Parámetros: ${JSON.stringify(log.parameters, null, 2)}`);
    }

    if (log.success !== undefined) {
      console.log(`✅ Éxito: ${log.success}`);
    }

    if (log.duration) {
      console.log(`⏱️ Duración: ${log.duration}ms`);
    }

    if (log.containerId) {
      console.log(`🆔 Container ID: ${log.containerId}`);
    }

    if (log.error) {
      console.log(`❌ Error: ${log.error}`);
    }

    console.log("------------------------------\n");
  });
}

function showFullRequestBody(executionId) {
  const today = new Date().toISOString().split("T")[0];
  const logs = loadLogs(today);

  const bodyLog = logs.find(
    (log) =>
      log.executionId === executionId &&
      log.phase === "agent_arguments_complete"
  );

  if (!bodyLog) {
    console.log(
      `❌ No se encontró el body completo para la ejecución: ${executionId}`
    );
    console.log(
      '💡 Asegúrate de que la ejecución haya llegado a la fase "agent_arguments_complete"'
    );
    return;
  }

  console.log(`📦 BODY COMPLETO ENVIADO A PHANTOMBUSTER: ${executionId}`);
  console.log("==================================================\n");

  console.log("🔗 URL de la API:");
  console.log(`   ${bodyLog.apiUrl}\n`);

  console.log("📋 Headers:");
  console.log(`   ${JSON.stringify(bodyLog.requestHeaders, null, 2)}\n`);

  console.log("📦 Body completo:");
  console.log(`   ${JSON.stringify(bodyLog.fullRequestBody, null, 2)}\n`);

  console.log("⚙️ Parámetros originales:");
  console.log(`   ${JSON.stringify(bodyLog.originalParameters, null, 2)}`);
}

function showSummary() {
  const summaryFile = path.join(logsDir, "launch-search-summary.json");

  if (!fs.existsSync(summaryFile)) {
    console.log("❌ No se encontró el archivo de resumen");
    return;
  }

  try {
    const summary = JSON.parse(fs.readFileSync(summaryFile, "utf8"));

    console.log("📊 RESUMEN DE EJECUCIONES");
    console.log("==================================================\n");

    console.log(`📈 Total de ejecuciones: ${summary.totalExecutions}`);
    console.log(`✅ Exitosas: ${summary.successfulExecutions}`);
    console.log(`❌ Fallidas: ${summary.failedExecutions}`);

    if (summary.lastExecution) {
      const lastExec = new Date(summary.lastExecution).toLocaleString("es-ES");
      console.log(`🕐 Última ejecución: ${lastExec}`);
    }

    if (summary.executions && summary.executions.length > 0) {
      console.log("\n📋 Últimas 10 ejecuciones:");
      summary.executions.slice(0, 10).forEach((exec) => {
        const timestamp = new Date(exec.timestamp).toLocaleString("es-ES");
        const status = exec.success ? "✅" : "❌";
        const containerId = exec.containerId || "N/A";
        console.log(`   ${status} ${timestamp} - ${containerId}`);
      });
    }
  } catch (error) {
    console.error(`❌ Error leyendo resumen: ${error.message}`);
  }
}

function listLogFiles() {
  if (!fs.existsSync(logsDir)) {
    console.log("❌ No existe el directorio de logs");
    return;
  }

  const files = fs
    .readdirSync(logsDir)
    .filter(
      (file) => file.startsWith("launch-search-") && file.endsWith(".json")
    )
    .sort();

  if (files.length === 0) {
    console.log("📁 No se encontraron archivos de log");
    return;
  }

  console.log("📁 ARCHIVOS DE LOG DISPONIBLES");
  console.log("==================================================\n");

  files.forEach((file) => {
    const filePath = path.join(logsDir, file);
    const stats = fs.statSync(filePath);
    const size = (stats.size / 1024).toFixed(2);
    const date = new Date(stats.mtime).toLocaleString("es-ES");
    console.log(`📄 ${file} (${size} KB) - ${date}`);
  });
}

function showDateLogs(date) {
  const logs = loadLogs(date);

  if (logs.length === 0) {
    console.log(`📅 No hay logs para la fecha: ${date}`);
    return;
  }

  console.log(`📅 Mostrando logs del día: ${date}`);
  console.log("==================================================\n");

  logs.forEach((log) => {
    const timestamp = new Date(log.timestamp).toLocaleString("es-ES");
    const containerId = log.containerId || "N/A";
    const url = log.searchUrl || log.url || "N/A";
    const shortUrl = url.length > 50 ? url.substring(0, 50) + "..." : url;

    if (log.success) {
      console.log(`✅ Ejecución: ${log.executionId}`);
      console.log(`   🕐 ${timestamp}`);
      console.log(`   🆔 Container: ${containerId}`);
      console.log(`   🔗 URL: ${shortUrl}`);
    } else {
      console.log(`❌ Ejecución: ${log.executionId}`);
      console.log(`   🕐 ${timestamp}`);
      console.log(`   🆔 Container: ${containerId}`);
      console.log(`   🔗 URL: ${shortUrl}`);
      if (log.error) {
        console.log(`   ❌ Error: ${log.error}`);
      }
    }
    console.log("");
  });
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  showHelp();
  process.exit(0);
}

const command = args[0];

switch (command) {
  case "today":
    showTodayLogs();
    break;

  case "date":
    if (args.length < 2) {
      console.log(
        "❌ Debes especificar una fecha: node scripts/view-launch-logs.js date YYYY-MM-DD"
      );
      process.exit(1);
    }
    showDateLogs(args[1]);
    break;

  case "summary":
    showSummary();
    break;

  case "execution":
    if (args.length < 2) {
      console.log(
        "❌ Debes especificar un ID de ejecución: node scripts/view-launch-logs.js execution [id]"
      );
      process.exit(1);
    }
    showExecutionLogs(args[1]);
    break;

  case "body":
    if (args.length < 2) {
      console.log(
        "❌ Debes especificar un ID de ejecución: node scripts/view-launch-logs.js body [id]"
      );
      process.exit(1);
    }
    showFullRequestBody(args[1]);
    break;

  case "list":
    listLogFiles();
    break;

  default:
    console.log(`❌ Comando desconocido: ${command}`);
    showHelp();
    process.exit(1);
}
