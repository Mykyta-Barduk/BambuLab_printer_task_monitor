// backend/src/index.ts
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { startBambuMonitor } from './services/bambu.service';


// Завантажуємо змінні з файлу .env
dotenv.config();

const app = express();
// Дозволяє фронтенду спілкуватися з API
app.use(cors({
  origin: [
    'https://project-h71j8.vercel.app', 
    'http://localhost:5173'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  credentials: true
}));

const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

// Мідлвар для того, щоб сервер вмів читати JSON-дані в запитах
app.use(express.json());


// --- ТЕСТОВІ ЕНДПОІНТИ (API) ---

// 1. Перевірка, чи взагалі працює сервер
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'SmartFarm API працює ідеально!' });
});

// 2. Отримання всіх принтерів (тест зв'язку з БД)
app.get('/api/printers', async (req: Request, res: Response) => {
  try {
    // Включаємо у вибірку дані про заправлену котушку (currentSpool)
    const printers = await prisma.printer.findMany({
      include: { currentSpool: true }
    });
    res.json(printers);
  } catch (error) {
    console.error('Помилка при отриманні принтерів:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// 3. ПРИЙОМ ЗАМОВЛЕНЬ З GOOGLE ФОРМИ (З ФІКСОМ МУЛЬТИЗАВАНТАЖЕННЯ ФАЙЛІВ)
app.post('/api/tasks/google-webhook', async (req: Request, res: Response) => {
  try {
    const { 
      modelName, // Сюди може прилетіти як "part1.STEP", так і "part1.STEP, part2.STEP"
      userEmail, 
      priority, 
      materialType,    
      requestedColor, 
      quantity, 
      comment, 
      gdriveFileLink, // Сюди теж прилітають посилання через кому, якщо файлів кілька
      gdriveFolderLink 
    } = req.body;

    // Валідація обов'язкових полів
    if (!modelName || !userEmail) {
      res.status(400).json({ error: 'Пропущено обовʼязкові поля: modelName або userEmail' });
      return;
    }

    const cleanEmail = userEmail.trim().toLowerCase();
    const username = cleanEmail.split('@')[0];

    // 1. АВТОМАТИЧНЕ СТВОРЕННЯ КОРИСТУВАЧА (якщо його ще немає в базі)
    let user = await prisma.user.findUnique({
      where: { email: cleanEmail }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          role: 'CUSTOMER'
        }
      });
      console.log(`👤 БД: Створено нового користувача для пошти ${cleanEmail}`);
    }

    // 2. 🔥 РОЗПАРСУЄМО МУЛЬТИЗАВАНТАЖЕННЯ (Пакетний друк деталей)
    // Розділяємо назви моделей та лінки, якщо вони прийшли через кому
    const rawModelNames = String(modelName).split(',');
    const rawFileLinks = gdriveFileLink ? String(gdriveFileLink).split(',') : [];

    const createdTaskIds: number[] = [];

    console.log(`📦 Webhook: Обробка пакета замовлення від ${cleanEmail}. Виявлено файлів: ${rawModelNames.length}`);

    // 3. СТВОРЮЄМО ОКРЕМУ ТАСКУ ДЛЯ КОЖНОГО ФАЙЛА
    for (let i = 0; i < rawModelNames.length; i++) {
      const singleModelName = rawModelNames[i].trim();
      if (!singleModelName) continue; // пропуск порожніх елементів, якщо десь закралася зайва кома

      // Беремо відповідне посилання на файл (якщо лінків менше, ніж назв — підстраховуємось)
      const singleFileLink = rawFileLinks[i] ? rawFileLinks[i].trim() : (rawFileLinks[0] ? rawFileLinks[0].trim() : null);

      const newTask = await prisma.printTask.create({
        data: {
          modelName: singleModelName,
          userEmail: user.email,
          username,
          priority: priority || 'MEDIUM',
          materialType: materialType || 'PLA', 
          requestedColor: requestedColor || 'Any',
          // Кількість (quantity) копій застосовується до кожної моделі з пакету окремо
          quantity: quantity ? Number(quantity) : 1, 
          comment: comment || null,
          gdriveFileLink: singleFileLink,
          gdriveFolderLink: gdriveFolderLink || null,
          status: 'pending',
        },
      });

      createdTaskIds.push(newTask.id);
      console.log(`  └─ 📄 Додано окрему таску ID ${newTask.id}: "${singleModelName}"`);
    }

    res.status(201).json({
      success: true,
      message: `Пакет успішно оброблено! Створено окремих задач: ${createdTaskIds.length}`,
      taskIds: createdTaskIds,
    });

  } catch (error) {
    console.error('Помилка при обробці мультизавантаження з вебхука:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера при збереженні пакета задач' });
  }
});

// 4. ОТРИМАННЯ ВСІЄЇ ЧЕРГИ ЗАДАЧ (Для Дашборду лаби)
app.get('/api/tasks', async (req: Request, res: Response) => {
  try {
    // Витягуємо всі задачі, сортуючи їх так, щоб нові були вгорі
    const tasks = await prisma.printTask.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(tasks);
  } catch (error) {
    console.error('Помилка при отриманні черги задач:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// 5. ОНОВЛЕННЯ ПЛАСТИКУ В ПРИНТЕРІ (Для QR-сканера)
app.post('/api/printers/:id/spool', async (req: Request, res: Response) => {
  try {
    const printerId = req.params.id as string;
    const { spoolId } = req.body; // Отримуємо ID котушки, яку зчитав сканер

    if (!spoolId) {
      res.status(400).json({ error: 'Пропущено обовʼязкове поле: spoolId' });
      return;
    }

    // 1. Перевіряємо, чи взагалі існує такий принтер у лабі
    const printerExists = await prisma.printer.findUnique({
      where: { id: printerId }
    });

    if (!printerExists) {
      res.status(404).json({ error: `Принтер з ID ${printerId} не знайдено` });
      return;
    }

    // 2. Перевіряємо, чи є така котушка на складі
    const spoolExists = await prisma.spool.findUnique({
      where: { id: spoolId }
    });

    if (!spoolExists) {
      res.status(404).json({ error: `Котушку з ID ${spoolId} не знайдено на складі. Зареєструйте її спочатку.` });
      return;
    }

    // 3. Якщо все ок — оновлюємо привʼязку в базі даних
    const updatedPrinter = await prisma.printer.update({
      where: { id: printerId },
      data: { currentSpoolId: spoolId },
      include: { currentSpool: true } // одразу підтягуємо інфо про новий plastic
    });

    console.log(`📸 QR-Сканер: Принтер [${printerId}] заправлено пластиком [${spoolId}] (${spoolExists.colorName})`);

    res.json({
      success: true,
      message: `Принтер успішно заправлено пластиком ${spoolExists.materialType} (${spoolExists.colorName})`,
      printer: updatedPrinter
    });

  } catch (error) {
    console.error('Помилка при оновленні plastic через QR:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// 6. СИМУЛЯТОР ДРУКУ (Для дебагу та тестів логіки складу)
app.post('/api/debug/simulate-print', async (req: Request, res: Response) => {
  try {
    const { printerId, taskId, estimatedWeightG } = req.body;

    if (!printerId || !taskId || !estimatedWeightG) {
      res.status(400).json({ error: 'Пропущено обовʼязкові поля: printerId, taskId або estimatedWeightG' });
      return;
    }

    // 1. Шукаємо задачу в базі
    const task = await prisma.printTask.findUnique({ where: { id: Number(taskId) } });
    // 2. Шукаємо принтер і підтягуємо заправлену в нього котушку
    const printer = await prisma.printer.findUnique({
      where: { id: printerId },
      include: { currentSpool: true }
    });

    if (!task || !printer) {
      res.status(404).json({ error: 'Принтер або задачу не знайдено в базі' });
      return;
    }

    if (!printer.currentSpoolId || !printer.currentSpool) {
      res.status(400).json({ error: 'Принтер не може друкувати: в нього не заправлено жодної котушки пластику!' });
      return;
    }

    // Перевіряємо, чи вистачить пластику на цю модель
    if (printer.currentSpool.remainingWeightG < estimatedWeightG) {
      res.status(400).json({ 
        error: `Неможливо почати друк! Модель важить ${estimatedWeightG}г, а на котушці [${printer.currentSpoolId}] залишилося всього ${printer.currentSpool.remainingWeightG}г пластику.` 
      });
      return;
    }

    console.log(`⚙️ Симуляція: Принтер [${printerId}] починає друк моделі "${task.modelName}"...`);

    // 3. ТРАНЗАКЦІЯ БД: Оновлюємо задачу, принтер та списуємо вагу пластику зі складу
    const weightToSubtract = Number(estimatedWeightG);
    const newRemainingWeight = printer.currentSpool.remainingWeightG - weightToSubtract;

    await prisma.$transaction([
      // Оновлюємо статус задачі
      prisma.printTask.update({
        where: { id: task.id },
        data: {
          status: 'finished', // Одразу симулюємо успішне завершення
          printerId: printer.id,
          estimatedWeightG: weightToSubtract,
          totalDurationMins: Math.floor(weightToSubtract * 1.5), 
          startedAt: new Date(),
          finishedAt: new Date()
        }
      }),
      // Оновлюємо баланс котушки, яка зараз всередині цього принтера
      prisma.spool.update({
        where: { id: printer.currentSpoolId },
        data: { remainingWeightG: newRemainingWeight }
      })
    ]);

    console.log(`📉 Склад: З котушки [${printer.currentSpoolId}] списано ${weightToSubtract}г пластику. Новий залишок: ${newRemainingWeight}г.`);

    res.json({
      success: true,
      message: `Симуляція завершена успішно! Модель "${task.modelName}" надрукована.`,
      spoolId: printer.currentSpoolId,
      remainingWeightG: newRemainingWeight
    });

  } catch (error) {
    console.error('Помилка при роботі симулятора друку:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// 🔥 7. АКТУАЛЬНИЙ МОНІТОРИНГ ДРУКУ (З ІЗОЛЯЦІЄЮ СТАТУСІВ ТА ПІДСТРАХОВКОЮ ЧЕРГИ)
app.get('/api/jobs/active', async (req: Request, res: Response) => {
  try {
    const allPrinters = await prisma.printer.findMany();
    const responseJobs: any[] = [];

    // Проходимо по кожному принтеру і формуємо єдиний чистий стейт для фронтенду
    for (const printer of allPrinters) {
      const printerStatusLower = printer.status.toLowerCase();
      
      // Якщо принтер вільний у базі — він не повинен виводити застарілі хвости процесів друку
      if (printerStatusLower === 'idle' || printerStatusLower === 'free' || printerStatusLower === 'offline') {
        continue;
      }

      // Шукаємо НАЙНОВІШУ активну або завершену сесію цього принтера з бази
      const lastJob = await prisma.printJob.findFirst({
        where: { printerId: printer.id },
        orderBy: { startedAt: 'desc' }, 
        include: { printTasks: true }
      });

      if (lastJob) {
        responseJobs.push({
          id: lastJob.id,
          printerId: printer.id,
          fileName: lastJob.fileName || "Локальний запуск (GCODE)",
          status: printer.status, // Живий актуальний стан заліза
          progress: printer.progress ?? lastJob.progress ?? 0,
          remainingMins: printer.remainingMins ?? lastJob.remainingMins ?? 0,
          printTasks: lastJob.printTasks || []
        });
      } else {
        // Страховка для стороннього запуску на випадок збоїв ініціалізації джоби
        responseJobs.push({
          id: `virtual-${printer.id}`,
          printerId: printer.id,
          fileName: "Локальний запуск (STEP/GCODE через Bambu Handy або SD-карту)",
          status: printer.status,
          progress: printer.progress ?? 0,
          remainingMins: printer.remainingMins ?? 0,
          printTasks: []
        });
      }
    }

    res.json(responseJobs);
  } catch (error) {
    console.error('Помилка ендпоінту /api/jobs/active:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// 🔥 7.5 ПРИМУСОВЕ СКИДАННЯ ПРИНТЕРА ТА ЗМЕТАННЯ ЗАВИСЛИХ ДУБЛІВ
app.post('/api/printers/:id/reset', async (req: Request, res: Response) => {
  try {
    const printerId = req.params.id;
    console.log(`🧹 Очищення залізяки: Принтер [${printerId}] примусово переводиться в IDLE...`);

    await prisma.$transaction([
      // А) Обнуляємо залізо принтера
      prisma.printer.update({
        where: { id: printerId },
        data: { 
          status: 'idle', 
          progress: 0, 
          remainingMins: 0 
        }
      }),
      // Б) Вимітаємо абсолютно ВСІ активні сесії для цього принтера зі статусом printing/waiting
      prisma.printJob.updateMany({
        where: { 
          printerId: printerId, 
          status: { in: ['printing', 'waiting_confirmation'] }
        },
        data: { 
          status: 'finished', 
          finishedAt: new Date() 
        }
      })
    ]);

    res.json({ success: true, message: 'Принтер та всі повʼязані процеси успішно очищені в базі!' });
  } catch (error) {
    console.error('Помилка при тотальному скиданні принтера:', error);
    res.status(500).json({ error: 'Помилка сервера при очищенні принтера' });
  }
});

// 🔥 9. СУПЕР-РОУТ: ПІДТВЕРДЖЕННЯ, АВТО-СПИСАННЯ ДЕТАЛЕЙ ТА ТОТАЛЬНА ЗАЧИСТКА СПУЛУ
app.post('/api/jobs/:id/confirm', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const { success } = req.body; // true — успішно, false — брак

    // 1. Шукаємо джобу та підтягуємо прив'язані до неї таски черги замовлень
    const currentJob = await prisma.printJob.findUnique({
      where: { id: jobId },
      include: { printTasks: true }
    });

    if (!currentJob) {
      res.status(404).json({ error: 'Таку сесію друку не знайдено в базі' });
      return;
    }

    const printerId = currentJob.printerId;
    const finalTaskStatus = success ? 'finished' : 'pending';
    const transactionOperations: any[] = [];

    console.log(`🧹 [Confirm Service] Робота з джобою ${jobId}. Результат: ${success ? 'УСПІШНО' : 'БРАК'}. Принтер: [${printerId}]`);

    // --- А) ЛОГІКА ОБЛІКУ ТА СПИСАННЯ ДЕТАЛЕЙ З ЧЕРГИ ЗАМОВЛЕНЬ ---
    if (currentJob.printTasks && currentJob.printTasks.length > 0) {
      for (const task of currentJob.printTasks) {
        if (success) {
          // Якщо друк УСПІШНИЙ: віднімаємо 1 деталь від поточного замовлення студента
          const remainingQuantity = task.quantity - 1;
          const isFullyFinished = remainingQuantity <= 0;

          console.log(`📦 Списання готової деталі: таска ID ${task.id} (${task.modelName}). Залишилось: ${remainingQuantity} шт.`);
          
          transactionOperations.push(
            prisma.printTask.update({
              where: { id: task.id },
              data: {
                quantity: isFullyFinished ? 0 : remainingQuantity, 
                status: isFullyFinished ? 'finished' : 'pending',   
                printJobId: isFullyFinished ? task.printJobId : null, 
                finishedAt: isFullyFinished ? new Date() : null
              }
            })
          );
        } else {
          // Якщо БРАК: повністю відв'язуємо таску від цієї джоби і повертаємо її в чергу на передрук
          console.log(`🚨 Брак деталей: таска ID ${task.id} повертається в чергу на інший запуск.`);
          transactionOperations.push(
            prisma.printTask.update({
              where: { id: task.id },
              data: { 
                status: 'pending', 
                printJobId: null,
                startedAt: null
              }
            })
          );
        }
      }
    }

    // --- Б) ЛОГІКА ТОТАЛЬНОГО ВИМІТАННЯ СПУЛУ ТА ДУБЛІКАТІВ ---
    // Закриваємо поточну джобу
    transactionOperations.push(
      prisma.printJob.update({
        where: { id: jobId },
        data: { status: 'finished', finishedAt: new Date() }
      })
    );

    // Змітаємо будь-які інші застряглі/наплоджені сесії цього принтера в архів finished
    transactionOperations.push(
      prisma.printJob.updateMany({
        where: {
          printerId: printerId,
          status: { in: ['printing', 'waiting_confirmation'] },
          id: { not: jobId }
        },
        data: {
          status: 'finished',
          finishedAt: new Date()
        }
      })
    );

    // Залізобетонно переводимо принтер у вільний зелений стан idle
    transactionOperations.push(
      prisma.printer.update({
        where: { id: printerId },
        data: { 
          status: 'idle',
          progress: 0,
          remainingMins: 0
        }
      })
    );

    // Запускаємо транзакцію атомарно
    await prisma.$transaction(transactionOperations);

    console.log(`✨ [DB Cleaned] Спул принтера [${printerId}] повністю зачищено. Замовлення оновлено.`);
    res.json({ success: true, message: 'Статус принтера скинуто в IDLE, чергу замовлень повністю підчищено!' });

  } catch (error) {
    console.error('Помилка при підтвердженні друку адміном:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера при збереженні та зачистці сесій' });
  }
});

// 10. БЕЗПАРОЛЬНИЙ ВХІД / РЕЄСТРАЦІЯ ЗА EMAIL
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Введіть валідну електронну пошту' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // Шукаємо користувача в базі
    let user = await prisma.user.findUnique({
      where: { email: cleanEmail }
    });

    // Якщо користувача немає — автоматично реєструємо його
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          role: 'CUSTOMER' // Всі нові юзери з сайту — клієнти
        }
      });
      console.log(`👤 БД (Сайт): Автоматично створено новий акаунт для ${cleanEmail}`);
    }

    // Повертаємо дані про користувача на фронтенд
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Помилка при авторизації:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// 11. ОТРИМАННЯ ТАСОК КОНКРЕТНОГО КОРИСТУВАЧА (Для кабінету юзера)
app.get('/api/tasks/user/:email', async (req: Request, res: Response) => {
  try {
    const userEmail = req.params.email.trim().toLowerCase();

    const userTasks = await prisma.printTask.findMany({
      where: { userEmail: userEmail },
      orderBy: { createdAt: 'desc' },
      include: {
        printJob: {
          include: {
            printer: true // Підтягуємо дані про принтер через модель PrintJob
          }
        }
      }
    });

    res.json(userTasks);
  } catch (error) {
    console.error('Помилка при отриманні тасок користувача:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// 🔄 ФУНКЦІЯ АВТОМАТИЧНОГО ПІДВИЩЕННЯ ПРІОРИТЕТУ (AGING SYSTEM)
async function agePrintTasks() {
  try {
    const NOW = new Date();
    
    // Пріоритети ростуть кожні 3 та 6 днів очікування в черзі (pending)
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);

    // 1. З LOW до MEDIUM
    const toMedium = await prisma.printTask.updateMany({
      where: {
        status: 'pending',
        priority: 'LOW',
        createdAt: { lt: threeDaysAgo }
      },
      data: {
        priority: 'MEDIUM'
      }
    });

    if (toMedium.count > 0) {
      console.log(`✨ [Aging System] ${toMedium.count} задач(і) автоматично піднято з LOW до MEDIUM через час очікування.`);
    }

    // 2. З MEDIUM до HIGH
    const toHigh = await prisma.printTask.updateMany({
      where: {
        status: 'pending',
        priority: 'MEDIUM',
        createdAt: { lt: sixDaysAgo }
      },
      data: {
        priority: 'HIGH'
      }
    });

    if (toHigh.count > 0) {
      console.log(`🔥 [Aging System] ${toHigh.count} задач(і) отримали статус КРИТИЧНО/HIGH через тривалий простій черги!`);
    }

  } catch (error) {
    console.error('Помилка при роботі сервісу старіння задач:', error);
  }
}

// ─── ЗАПУСК СЕРВЕРА ТА ФОНОВИХ СЕРВІСІВ ───────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущенно на http://localhost:${PORT}`);
  
  // Запускаємо фоновий MQTT-монітор принтерів Bambu Lab
  startBambuMonitor().catch(err => {
    console.error('Помилка при запуску Bambu Monitor:', err);
  });

  // Запуск фонового сервісу старіння задач (Aging) кожні 30 хвилин
  setInterval(agePrintTasks, 30 * 60 * 1000);
  
  // Одноразовий запуск при старті для перевірки існуючих задач
  agePrintTasks();
});