/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       Bambu Lab — Standalone Terminal Monitor        ║
 * ║  Підключається через LAN MQTT, виводить усе в термінал ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Запуск: npm start
 * Налаштування: printers.config.json
 */

import mqtt, { MqttClient } from 'mqtt';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ─── ANSI кольори (без зовнішніх залежностей) ───────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  bgRed:   '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue:  '\x1b[44m',
  bgGray:  '\x1b[100m',
};

// ─── ТИПИ ──────────────────────────────────────────────────

interface PrinterConfig {
  name:       string;
  serial:     string;
  ip:         string;
  accessCode: string;
}

interface Config {
  printers: PrinterConfig[];
}

// Дані від Bambu MQTT
interface BambuReport {
  gcode_state?:        string;   // IDLE | RUNNING | PAUSE | FAILED | FINISH | PREPARE
  subtask_name?:       string;   // назва файлу
  mc_percent?:         number;   // прогрес 0–100
  mc_remaining_time?:  number;   // хвилин залишилось
  gcode_weight?:       number;   // вага філаменту (г)
  layer_num?:          number;   // поточний шар
  total_layer_num?:    number;   // всього шарів
  nozzle_temper?:      number;   // температура сопла (фактична)
  nozzle_target_temper?: number; // температура сопла (цільова)
  bed_temper?:         number;   // температура столу (фактична)
  bed_target_temper?:  number;   // температура столу (цільова)
  chamber_temper?:     number;   // температура камери (X1C)
  spd_mag?:            number;   // швидкість друку (% від базової)
  print_error?:        number;   // код помилки (0 = норма)
  subtask_id?:         string;
  task_id?:            string;
  // Зовнішня котушка (без AMS)
  vt_tray?: {
    tray_type?:   string;   // PLA, PETG, ABS...
    tray_color?:  string;   // RRGGBBAA hex
    tray_weight?: string;
    tray_temp?:   string;
  };
  // AMS (Automatic Material System)
  ams?: {
    ams: Array<{
      id:     number;
      tray: Array<{
        id:          string;
        tray_type?:  string;
        tray_color?: string;    // RRGGBBAA hex
        tray_weight?: string;
        remain?:     number;    // залишок %
      }>;
    }>;
    tray_now?: string;           // яка котушка зараз активна "0" | "1" | "254" (external)
  };
}

// Зведений стан принтера (що ми накопичуємо)
interface PrinterState {
  config:         PrinterConfig;
  connected:      boolean;
  lastReport?:    BambuReport;
  lastUpdateAt?:  Date;
  rawMessages:    number;
  stlNames?:      string[];
}

// ─── ГЛОБАЛЬНИЙ СТАН ────────────────────────────────────────
const states = new Map<string, PrinterState>();

// ─── ЗАВАНТАЖЕННЯ КОНФІГУРАЦІЇ ──────────────────────────────
function loadConfig(): Config {
  const configPath = path.resolve('./printers.config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`${C.red}❌ Файл printers.config.json не знайдено!${C.reset}`);
    console.error(`Створи його поруч з package.json і вкажи свої принтери.`);
    process.exit(1);
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Config;
  } catch (e) {
    console.error(`${C.red}❌ Помилка парсингу printers.config.json:${C.reset}`, e);
    process.exit(1);
  }
}


// Функція злиття старого і нового пакетів
function updateReport(oldReport: any, newReport: any): any {
  if (!oldReport) return newReport;
  const result = { ...oldReport };

  for (const key in newReport) {
    if (typeof newReport[key] === 'object' && newReport[key] !== null && !Array.isArray(newReport[key])) {
      // Якщо це вкладений об'єкт (як vt_tray), зливаємо його рекурсивно
      result[key] = updateReport(oldReport[key], newReport[key]);
    } else {
      // Якщо це просте значення (число, рядок) або масив, просто оновлюємо
      result[key] = newReport[key];
    }
  }
  return result;
}

// Функція, яка бере довгий рядок від слайсера і розрізає його по плюсиках
function parseNamesFromSubtask(subtaskName: string): string[] | null {
  if (!subtaskName) return null;
  
  // Якщо в назві є щось типу "+ 9 others", цей метод не підійде
  if (subtaskName.includes('others')) return null;

  // Якщо є плюсик — розбиваємо рядок на окремі деталі
  if (subtaskName.includes('+')) {
    return subtaskName
      .split('+')
      .map(s => s.trim())          // Прибираємо зайві пробіли по краях
      .filter(s => s.length > 0);  // Видаляємо порожні рядки, якщо вони є
  }
  
  return null;
}


// ─── ПІДКЛЮЧЕННЯ ДО ПРИНТЕРА ────────────────────────────────
function connectPrinter(cfg: PrinterConfig): MqttClient {
  const brokerUrl = `mqtts://${cfg.ip}:8883`;

  log(`🔌 Підключаємось до ${C.bold}${cfg.name}${C.reset} (${cfg.ip})...`);

  const client = mqtt.connect(brokerUrl, {
    username:           'bblp',
    password:           cfg.accessCode,
    clientId:           `bambu-monitor-${cfg.serial}-${Date.now()}`,
    rejectUnauthorized: false,      // Bambu використовує самопідписаний TLS-сертифікат
    reconnectPeriod:    5000,       // спробувати перепідключення кожні 5 сек
    connectTimeout:     15000,
    keepalive:          60,
  });

  client.on('connect', () => {
    const state = states.get(cfg.serial)!;
    state.connected = true;
    log(`${C.green}✅ Підключено: ${cfg.name}${C.reset}`);

    // 🔥 АВТО-РЕЄСТРАЦІЯ ПРИНТЕРА В БД (Фікс помилки Foreign key)
    // upsert означає: якщо немає — створи, якщо є — онови
    prisma.printer.upsert({
      where: { id: cfg.serial },
      update: { status: 'idle', name: cfg.name },
      create: {
        id: cfg.serial,     // Серійник як унікальний ID
        name: cfg.name,
        model: 'Bambu Lab', // Тимчасове ім'я моделі, адмін зможе змінити на сайті
        status: 'idle'
      }
    }).then(() => {
      log(`${C.dim}🔗 [DB] Принтер ${cfg.name} синхронізовано з базою даних.${C.reset}`);
    }).catch(err => {
      console.error(`\n${C.red}❌ [DB Error] Не вдалося зареєструвати принтер: ${err.message}${C.reset}`);
    });

    // Підписуємось на репорти принтера
    const reportTopic = `device/${cfg.serial}/report`;
    client.subscribe(reportTopic, { qos: 1 }, (err) => {
      if (err) {
        log(`${C.red}❌ Помилка підписки на ${reportTopic}: ${err.message}${C.reset}`);
      } else {
        log(`${C.cyan}📡 Підписано на: ${reportTopic}${C.reset}`);
      }
    });

    // Запитуємо повний статус одразу після підключення
    requestFullStatus(client, cfg.serial);
  });

  client.on('message', (topic, payload) => {
    const state = states.get(cfg.serial)!;
    state.rawMessages++;

    try {
      const data = JSON.parse(payload.toString());

      if (data.print) {
        const incoming = data.print as BambuReport;
        
        // 🚨 1. ДЕТЕКЦІЯ СТАТУСІВ ДЛЯ БАЗИ ДАНИХ (Робимо ДО злиття станів)
        const wasRunning = state.lastReport?.gcode_state === 'RUNNING';
        const nowRunning = incoming.gcode_state === 'RUNNING';

        // --- СТАРТ ДРУКУ (Автоматичний метчинг за назвою файлу) ---
        if (nowRunning && !wasRunning) {
          const subtaskName = incoming.subtask_name || state.lastReport?.subtask_name || 'Невідоме завдання';
          const simpleNames = parseNamesFromSubtask(subtaskName) || [subtaskName];
          state.stlNames = simpleNames;

          prisma.printJob.create({
            data: {
              fileName: subtaskName,
              status: 'printing',
              printerId: cfg.serial,
              progress: 0,
              remainingMins: 0
            }
          }).then(async (job) => {
            log(`${C.green}✅ [DB] Створено PrintJob: ${job.id}${C.reset}`);

            // Також при старті друку відразу міняємо статус самого заліза в таблиці Printer
            await prisma.printer.update({
              where: { id: cfg.serial },
              data: { status: 'printing', progress: 0, remainingMins: 0 }
            }).catch(e => console.error("Помилка зміни статусу принтера при старті:", e.message));

            for (const name of simpleNames) {
              const cleanName = name.replace(/\.(?:stl|step|obj|gcode)/gi, '').trim();
              if (cleanName.length < 2) continue;

              await prisma.printTask.updateMany({
                where: {
                  status: 'pending',
                  modelName: { contains: cleanName }
                },
                data: {
                  printJobId: job.id,
                  status: 'printing',
                  startedAt: new Date()
                }
              });
            }
            log(`${C.cyan}🔄 [DB Match] Студентські таски для "${subtaskName}" автоматично переведені в режим друку!${C.reset}`);
          }).catch(err => console.error(`\n${C.red}❌ [DB Error] Помилка старту друку: ${err.message}${C.reset}`));
        }

        // --- ФІНІШ ДРУКУ (Перехід у режим очікування перевірки адміном) ---
        if ((incoming.gcode_state === 'FINISH' || incoming.gcode_state === 'FAILED') && state.lastReport?.gcode_state !== incoming.gcode_state) {
          
          prisma.printJob.findFirst({
            where: { printerId: cfg.serial, status: 'printing' },
            orderBy: { startedAt: 'desc' }
          }).then(async (activeJob) => {
            if (activeJob) {
              await prisma.printJob.update({
                where: { id: activeJob.id },
                data: { status: 'waiting_confirmation', progress: 100, remainingMins: 0 }
              });

              // Переводимо залізо в стан контролю якості
              await prisma.printer.update({
                where: { id: cfg.serial },
                data: { status: 'waiting_confirmation', progress: 100, remainingMins: 0 }
              }).catch(e => {});

              log(`${C.yellow}⏳ [DB] Друк завершено (${incoming.gcode_state}). Очікуємо підтвердження адміна на сайті.${C.reset}`);
            }
          }).catch(err => console.error(`\n${C.red}❌ [DB Error] Помилка фінішу друку: ${err.message}${C.reset}`));
          
          state.stlNames = [];
        }

        // 🚨 2. ЗЛИТТЯ СТАНІВ (Deep Merge)
        state.lastReport = updateReport(state.lastReport, incoming) as BambuReport;
        
        // 🚨 3. ОЧИЩЕННЯ АРТЕФАКТІВ ІНТЕРФЕЙСУ ТЕРМІНАЛУ
        if (state.lastReport) {
          const st = state.lastReport.gcode_state;
          if (st === 'IDLE' || st === 'FINISH') {
            state.lastReport.print_error = 0;      
            state.lastReport.subtask_name = '';     
            state.lastReport.mc_percent = 0;        
            state.lastReport.mc_remaining_time = 0;

            // Якщо принтер простоює — синхронізуємо бд, що він вільний
            if (st === 'IDLE') {
              prisma.printer.update({
                where: { id: cfg.serial },
                data: { status: 'idle', progress: 0, remainingMins: 0 }
              }).catch(() => {});
            }
          }
        }

        // 🔥 🚨 4. ПОТОЧНИЙ РЕАЛ-ТАЙМ МОНІТОРИНГ ТЕЛЕМЕТРІЇ (Записуємо кожен пакет у БД)
        if (state.lastReport && state.lastReport.gcode_state === 'RUNNING') {
          const currentPercent = state.lastReport.mc_percent ?? 0;
          const currentRemaining = state.lastReport.mc_remaining_time ?? 0;
          const currentNozzle = state.lastReport.nozzle_temper ?? undefined;
          const currentBed = state.lastReport.bed_temper ?? undefined;

          // А) Оновлюємо залізо в таблиці Printer (щоб картка світилась синім і міняла %)
          prisma.printer.update({
            where: { id: cfg.serial },
            data: {
              status: 'printing',
              progress: Number(currentPercent),
              remainingMins: Number(currentRemaining),
              // Якщо додавав температури у схему — Prisma їх проковтне:
              ...(currentNozzle !== undefined && { nozzleTemp: Math.floor(currentNozzle) }),
              ...(currentBed !== undefined && { bedTemp: Math.floor(currentBed) }),
            }
          }).catch(() => {});

          // Б) Оновлюємо поточну сесію друку в таблиці PrintJob (щоб монітор у модалці крутився)
          prisma.printJob.findFirst({
            where: { printerId: cfg.serial, status: 'printing' },
            orderBy: { startedAt: 'desc' }
          }).then(async (activeJob) => {
            if (activeJob) {
              await prisma.printJob.update({
                where: { id: activeJob.id },
                data: {
                  progress: Number(currentPercent),
                  remainingMins: Number(currentRemaining),
                  ...(currentNozzle !== undefined && { nozzleTemp: Math.floor(currentNozzle) }),
                  ...(currentBed !== undefined && { bedTemp: Math.floor(currentBed) }),
                }
              }).catch(() => {});
            }
          }).catch(() => {});
        }

        state.lastUpdateAt = new Date();
        renderDashboard();
      }
    } catch (e) {
      // Ігноруємо невалідні бінарні пакети
    }
  });

  client.on('error', (err) => {
    const state = states.get(cfg.serial)!;
    state.connected = false;
    log(`${C.red}❌ MQTT помилка [${cfg.name}]: ${err.message}${C.reset}`);
  });

  client.on('offline', () => {
    const state = states.get(cfg.serial)!;
    state.connected = false;
    log(`${C.yellow}⚠️  Принтер оффлайн: ${cfg.name}${C.reset}`);
    renderDashboard();
  });

  client.on('reconnect', () => {
    log(`${C.yellow}🔄 Перепідключення: ${cfg.name}...${C.reset}`);
  });

  return client;
}

// Запросити повний статус (pushall) — принтер відповість одним великим JSON
function requestFullStatus(client: MqttClient, serial: string): void {
  const requestTopic = `device/${serial}/request`;
  const pushall = JSON.stringify({
    pushing: { sequence_id: '0', command: 'pushall' }
  });
  client.publish(requestTopic, pushall, { qos: 1 });
  log(`${C.dim}📤 Запит pushall → ${serial}${C.reset}`);
}

// ─── ВІДОБРАЖЕННЯ ────────────────────────────────────────────

// Стан принтера → рядок статусу
function formatStatus(state: string | undefined): string {
  switch (state?.toUpperCase()) {
    case 'RUNNING':  return `${C.bgBlue}${C.white} ▶ ДРУКУЄ  ${C.reset}`;
    case 'PAUSE':    return `${C.bgGray}${C.white} ⏸ ПАУЗА   ${C.reset}`;
    case 'FAILED':   return `${C.bgRed}${C.white} ✖ ПОМИЛКА ${C.reset}`;
    case 'FINISH':   return `${C.bgGreen}${C.white} ✔ ГОТОВО  ${C.reset}`;
    case 'PREPARE':  return `${C.yellow}  ⚙ ГОТУЄТЬСЯ ${C.reset}`;
    case 'IDLE':     return `${C.green}  ● ВІЛЬНИЙ   ${C.reset}`;
    default:         return `${C.dim}  ○ НЕВІДОМО  ${C.reset}`;
  }
}

// Прогрес-бар у термінал
function progressBar(percent: number, width = 30): string {
  const filled  = Math.round((percent / 100) * width);
  const empty   = width - filled;
  const bar     = '█'.repeat(filled) + '░'.repeat(empty);
  const color   = percent > 66 ? C.green : percent > 33 ? C.yellow : C.cyan;
  return `${color}${bar}${C.reset} ${C.bold}${percent}%${C.reset}`;
}

// Форматування часу (хвилини → "1 год 23 хв")
function formatTime(minutes: number | undefined): string {
  if (!minutes) return `${C.dim}—${C.reset}`;
  if (minutes < 60) return `${C.cyan}${minutes} хв${C.reset}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${C.cyan}${h} год ${m} хв${C.reset}`;
}

// Температура з кольором
function formatTemp(actual: number | undefined, target: number | undefined): string {
  if (!actual) return `${C.dim}—${C.reset}`;
  const color = actual > 180 ? C.red : actual > 60 ? C.yellow : C.cyan;
  const targetStr = target ? `/${target}°` : '';
  return `${color}${actual}°C${C.reset}${C.dim}${targetStr}${C.reset}`;
}

// Розбираємо колір котушки з Bambu hex (RRGGBBAA → назва або hex)
function formatFilament(tray: { tray_type?: string; tray_color?: string; remain?: number } | undefined): string {
  if (!tray) return `${C.dim}—${C.reset}`;

  const type   = tray.tray_type  || '?';
  const color  = tray.tray_color ? `#${tray.tray_color.substring(0, 6)}` : '';
  const remain = tray.remain     !== undefined ? `  ${tray.remain}%` : '';

  // Визначаємо приблизний колір для терміналу
  let colorLabel = color;
  if (color) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    if (r > 200 && g < 80  && b < 80)  colorLabel = `${C.red}${color}${C.reset}`;
    else if (r < 80  && g > 180 && b < 80)  colorLabel = `${C.green}${color}${C.reset}`;
    else if (r < 80  && g < 80  && b > 200) colorLabel = `${C.blue}${color}${C.reset}`;
    else if (r > 200 && g > 200 && b < 80)  colorLabel = `${C.yellow}${color}${C.reset}`;
    else if (r > 220 && g > 220 && b > 220) colorLabel = `${C.white}${color}${C.reset}`;
    else if (r < 40  && g < 40  && b < 40)  colorLabel = `${C.dim}${color}${C.reset}`;
    else colorLabel = color;
  }

  return `${C.bold}${type}${C.reset} ${colorLabel}${C.dim}${remain}${C.reset}`;
}

// Яка котушка зараз активна (з AMS або зовнішня)
function getActiveTray(report: BambuReport): string {
  const trayNow = report.ams?.tray_now;

  // 254 або 255 = зовнішня котушка (vt_tray)
  if (!trayNow || trayNow === '254' || trayNow === '255') {
    return `Зовнішня: ${formatFilament(report.vt_tray)}`;
  }

  // AMS: tray_now = "0","1","2","3" (AMS1 tray1-4), "4"-"7" (AMS2), etc.
  const trayIndex = parseInt(trayNow, 10);
  const amsIndex  = Math.floor(trayIndex / 4);
  const slotIndex = trayIndex % 4;

  const ams  = report.ams?.ams?.[amsIndex];
  const tray = ams?.tray?.[slotIndex];

  if (!tray) return `AMS ${amsIndex + 1} / слот ${slotIndex + 1}: ${C.dim}немає даних${C.reset}`;
  return `AMS ${amsIndex + 1} / слот ${slotIndex + 1}: ${formatFilament(tray)}`;
}


// Горизонтальна лінія
const LINE      = C.dim + '─'.repeat(60) + C.reset;
const LINE_THIN = C.dim + '·'.repeat(60) + C.reset;


// Головна функція рендерингу dashboard
let renderCount = 0;
function renderDashboard(): void {
  renderCount++;
  // Очищаємо екран і переходимо на початок
  process.stdout.write('\x1b[2J\x1b[H');

  const now = new Date().toLocaleTimeString('uk-UA');
  console.log(`\n${C.bold}${C.magenta}  ╔══ BAMBU LAB MONITOR ══╗${C.reset}  ${C.dim}оновлення #${renderCount} о ${now}${C.reset}\n`);

  for (const [serial, state] of states) {
    const cfg    = state.config;
    const report = state.lastReport;

    console.log(LINE);
    console.log(`  ${C.bold}${cfg.name}${C.reset}  ${C.dim}${serial}${C.reset}`);
    console.log(LINE_THIN);

    // ── ПІДКЛЮЧЕННЯ ──
    if (!state.connected) {
      console.log(`  ${C.red}🔌 Не підключено до ${cfg.ip}${C.reset}`);
      console.log();
      continue;
    }

    if (!report) {
      console.log(`  ${C.yellow}⏳ Підключено, очікую перший пакет...${C.reset}`);
      console.log(`  ${C.dim}Отримано пакетів: ${state.rawMessages}${C.reset}`);
      console.log();
      continue;
    }

    // ── СТАТУС ──
    console.log(`  Статус      ${formatStatus(report.gcode_state)}`);

    // ── ФАЙЛ ──
    if (report.subtask_name) {
      console.log(`  Файл        ${C.bold}${C.white}${report.subtask_name}${C.reset}`);
    } else {
      console.log(`  Файл        ${C.dim}немає активного друку${C.reset}`);
    }

    // ── ПРОГРЕС (тільки під час друку) ──
    if (report.gcode_state === 'RUNNING' || report.gcode_state === 'PAUSE') {
      const pct = report.mc_percent ?? 0;
      console.log(`  Прогрес     ${progressBar(pct)}`);
      console.log(`  Залишилось  ${formatTime(report.mc_remaining_time)}`);

      // Шари
      if (report.total_layer_num) {
        const layer = report.layer_num ?? 0;
        const total = report.total_layer_num;
        console.log(`  Шари        ${C.cyan}${layer}${C.reset} ${C.dim}/ ${total}${C.reset}`);
      }

      // Вага філаменту
      if (report.gcode_weight) {
        console.log(`  Філамент г  ${C.cyan}${report.gcode_weight.toFixed(1)} г${C.reset}`);
      }

      // Швидкість
      if (report.spd_mag !== undefined) {
        const spd = report.spd_mag;
        const spdColor = spd > 150 ? C.red : spd > 100 ? C.yellow : C.green;
        console.log(`  Швидкість   ${spdColor}${spd}%${C.reset}`);
      }
    }

    console.log(LINE_THIN);

    // ── КОТУШКА ──
    console.log(`  Котушка     ${getActiveTray(report)}`);

    // Всі AMS котушки (якщо є AMS)
    if (report.ams?.ams?.length) {
      for (const amsUnit of report.ams.ams) {
        for (const tray of amsUnit.tray) {
          if (tray.tray_type) {
            const active = report.ams.tray_now === tray.id ? `${C.green}◀ активна${C.reset}` : '';
            console.log(`    AMS ${amsUnit.id + 1} слот ${parseInt(tray.id) % 4 + 1}  ${formatFilament(tray)} ${active}`);
          }
        }
      }
    }

    console.log(LINE_THIN);

    // ── ТЕМПЕРАТУРИ ──
    console.log(`  Сопло       ${formatTemp(report.nozzle_temper, report.nozzle_target_temper)}`);
    console.log(`  Стіл        ${formatTemp(report.bed_temper, report.bed_target_temper)}`);
    if (report.chamber_temper !== undefined && report.chamber_temper > 0) {
      console.log(`  Камера      ${formatTemp(report.chamber_temper, undefined)}`);
    }

    // ── ПОМИЛКА ──
    if (report.print_error && report.print_error !== 0) {
      console.log(LINE_THIN);
      console.log(`  ${C.bgRed}${C.white} ⚠ Код помилки: ${report.print_error} ${C.reset}`);
      console.log(`  ${C.dim}Дивись: https://wiki.bambulab.com/en/x1/troubleshooting${C.reset}`);
    }

    // ── МЕТА ──
    if (state.lastUpdateAt) {
      const ago = Math.round((Date.now() - state.lastUpdateAt.getTime()) / 1000);
      console.log(`  ${C.dim}Останній пакет: ${ago}с тому | всього пакетів: ${state.rawMessages}${C.reset}`);
    }

    console.log();
  }

  console.log(LINE);
  console.log(`${C.dim}  Ctrl+C щоб вийти${C.reset}\n`);
}

// Окрема черга логів щоб не переривали рендер
const logBuffer: string[] = [];
function log(msg: string): void {
  // Просто пишемо після наступного рендеру, але тільки перші секунди
  if (renderCount < 1) {
    console.log(msg);
  }
}

// ─── ЗАПУСК ──────────────────────────────────────────────────
export async function startBambuMonitor(): Promise<void>{
  console.clear();
  console.log(`\n${C.bold}${C.magenta}  Bambu Lab Terminal Monitor${C.reset}\n`);

  const config = loadConfig();

  if (!config.printers || config.printers.length === 0) {
    console.error(`${C.red}❌ Немає принтерів в printers.config.json${C.reset}`);
    process.exit(1);
  }

  // Ініціалізуємо стан для кожного принтера
  for (const cfg of config.printers) {
    if (!cfg.serial || cfg.serial === 'XXXXXXXXXXXXXXXX') {
      console.warn(`${C.yellow}⚠️  Принтер "${cfg.name}": вкажи реальний serial у printers.config.json${C.reset}`);
      continue;
    }

    states.set(cfg.serial, {
      config:       cfg,
      connected:   false,
      rawMessages: 0,
    });

    connectPrinter(cfg);
  }

  if (states.size === 0) {
    console.error(`${C.red}❌ Жодного валідного принтера не знайдено${C.reset}`);
    process.exit(1);
  }

  // Перший рендер через 1 секунду (щоб логи підключення встигли вивестись)
  setTimeout(renderDashboard, 1000);

  // Оновлення кожні 3 секунди (навіть якщо нових MQTT-пакетів не було)
  setInterval(renderDashboard, 3000);
}

// 
// main().catch(err => {
//   console.error(`${C.red}💥 Fatal:${C.reset}`, err);
//   process.exit(1);
// });