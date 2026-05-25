// backend/src/index.ts
import cors from 'cors';
import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { startBambuMonitor } from './services/bambu.service';

// Завантажуємо змінні з файлу .env
dotenv.config();

const app = express();
app.use(cors()); // Дозволяє фронтенду спілкуватися з API
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
    // Включаємо у вивибірку дані про заправлену котушку (currentSpool)
    const printers = await prisma.printer.findMany({
      include: { currentSpool: true }
    });
    res.json(printers);
  } catch (error) {
    console.error('Помилка при отриманні принтерів:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// 3. ПРИЙОМ ЗАМОВЛЕНЬ З GOOGLE ФОРМИ (Webhook) - Оновлений під нову схему БД
app.post('/api/tasks/google-webhook', async (req: Request, res: Response) => {
  try {
    const { 
      modelName, 
      userEmail, 
      priority, 
      materialType,    
      requestedColor, 
      quantity, 
      comment, 
      gdriveFileLink, 
      gdriveFolderLink 
    } = req.body;

    // Валідація обов'язкових полів
    if (!modelName || !userEmail) {
      res.status(400).json({ error: 'Пропущено обовʼязкові поля: modelName або userEmail' });
      return;
    }

    console.log(`📥 Webhook: Нове замовлення "${modelName}" x${quantity || 1}шт. від ${userEmail}`);

    // 1. АВТОМАТИЧНЕ СТВОРЕННЯ КОРИСТУВАЧА (якщо його ще немає в базі)
    let user = await prisma.user.findUnique({
      where: { email: userEmail }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: userEmail,
          role: 'CUSTOMER' // Усі нові користувачі з форми за замовчуванням клієнти
        }
      });
      console.log(`👤 БД: Створено нового користувача для пошти ${userEmail}`);
    }

    const username = userEmail.split('@')[0];

    // 2. ЗАПИС ЗАДАЧІ В БАЗУ (з прив'язкою до userEmail)
    const newTask = await prisma.printTask.create({
      data: {
        modelName,
        userEmail: user.email, // Прив'язуємо до пошти існуючого або створеного юзера
        username,
        priority: priority || 'MEDIUM',
        materialType: materialType || 'PLA', 
        requestedColor: requestedColor || 'Any',
        quantity: quantity ? Number(quantity) : 1, 
        comment: comment || null,
        gdriveFileLink: gdriveFileLink || null,
        gdriveFolderLink: gdriveFolderLink || null,
        status: 'pending',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Замовлення успішно додано в чергу SmartFarm!',
      taskId: newTask.id,
    });
  } catch (error) {
    console.error('Помилка при обробці вебхука Google:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера при збереженні задачі' });
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
    console.error('Помилка при оновленні пластику через QR:', error);
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

    // Виконуємо оновлення паралельно через $transaction
    await prisma.$transaction([
      // Оновлюємо статус задачі
      prisma.printTask.update({
        where: { id: task.id },
        data: {
          status: 'finished', // Одразу симулюємо успішне завершення
          printerId: printer.id,
          estimatedWeightG: weightToSubtract,
          totalDurationMins: Math.floor(weightToSubtract * 1.5), // Фейковий розрахунок часу друку
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

// 🔥 7. АКТУАЛЬНИЙ МОНІТОРИНГ ДРУКУ (ВКЛЮЧАЮЧИ waiting_confirmation)
app.get('/api/jobs/active', async (req: Request, res: Response) => {
  try {
    // Тепер витягуємо і ті, що друкуються, і ті, що чекають на твій контроль!
    const realActiveJobs = await prisma.printJob.findMany({
      where: { 
        status: { in: ['printing', 'waiting_confirmation'] } 
      },
      include: { printTasks: true },
      orderBy: { startedAt: 'desc' }
    });

    const allPrinters = await prisma.printer.findMany();
    const responseJobs: any[] = [];
    const processedPrinterIds = new Set<string>();

    // 1. Пушимо реальні сесії з бази
    for (const job of realActiveJobs) {
      const pIdLower = job.printerId.toLowerCase();
      if (!processedPrinterIds.has(pIdLower)) {
        responseJobs.push({
          ...job,
          progress: job.progress ?? 0,
          remainingMins: job.remainingMins ?? 0
        });
        processedPrinterIds.add(pIdLower);
      }
    }

    // 2. Страховка для стороннього друку
    for (const printer of allPrinters) {
      const printerStatusLower = printer.status.toLowerCase();
      const pIdLower = printer.id.toLowerCase();
      
      if (
        printerStatusLower !== 'idle' && 
        printerStatusLower !== 'free' && 
        printerStatusLower !== 'offline' && 
        !processedPrinterIds.has(pIdLower)
      ) {
        const lastJob = await prisma.printJob.findFirst({
          where: { printerId: printer.id },
          orderBy: { startedAt: 'desc' },
          include: { printTasks: true }
        });

        responseJobs.push({
          id: lastJob?.id || `virtual-${printer.id}`,
          printerId: printer.id,
          fileName: lastJob?.fileName || "Локальний запуск (GCODE з флешки)",
          status: printer.status, // зберігаємо оригінальний статус заліза
          progress: printer.progress ?? 0, 
          remainingMins: printer.remainingMins ?? 0,
          printTasks: lastJob?.printTasks || []
        });

        processedPrinterIds.add(pIdLower);
      }
    }

    res.json(responseJobs);
  } catch (error) {
    console.error('Помилка ендпоінту /api/jobs/active:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// 9. ПІДТВЕРДЖЕННЯ ДРУКУ АДМІНОМ (З ОЧИЩЕННЯМ СТАТУСУ ПРИНТЕРА В IDLE)
app.post('/api/jobs/:id/confirm', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const { success } = req.body; // true — успішно, false — брак

    // 1. Шукаємо цей Job та підтягуємо всі прив'язані до нього таски
    const job = await prisma.printJob.findUnique({
      where: { id: jobId },
      include: { printTasks: true }
    });

    if (!job) {
      res.status(404).json({ error: 'Таку сесію друку не знайдено в базі' });
      return;
    }

    const finalJobStatus = success ? 'finished' : 'failed';

    // 2. Оновлюємо базу через транзакцію
    await prisma.$transaction(async (tx) => {
      
      // А) Закриваємо фізичний запуск на принтері
      await tx.printJob.update({
        where: { id: jobId },
        data: { status: finalJobStatus, finishedAt: new Date() }
      });

      // Б) 🔥 НАЙГОЛОВНІШЕ: Примусово переводимо саме залізо принтера в статус "idle" та обнуляємо прогрес!
      await tx.printer.update({
        where: { id: job.printerId },
        data: { 
          status: 'idle',
          progress: 0,
          remainingMins: 0
        }
      });

      // В) Проходимо по кожній тасці, що автоматично метчилась до цього друку
      for (const task of job.printTasks) {
        if (!success) {
          // 🛑 Якщо БРАК: Повертаємо таску в чергу 'pending', кількість не чіпаємо
          await tx.printTask.update({
            where: { id: task.id },
            data: { 
              status: 'pending', 
              printJobId: null // відв'язуємо від цього запуску
            }
          });
        } else {
          // ✅ Якщо УСПІШНО: Віднімаємо 1 деталь від загальної кількості в замовленні
          const remainingQuantity = task.quantity - 1;
          const isFullyFinished = remainingQuantity <= 0;

          await tx.printTask.update({
            where: { id: task.id },
            data: {
              quantity: isFullyFinished ? 0 : remainingQuantity, 
              status: isFullyFinished ? 'finished' : 'pending',   
              printJobId: isFullyFinished ? task.printJobId : null, 
              finishedAt: isFullyFinished ? new Date() : null
            }
          });
        }
      }
    });

    console.log(`👮‍♂️ Адмін валідував збірку [${jobId}]. Результат: ${finalJobStatus.toUpperCase()}. Принтер [${job.printerId}] вільний!`);
    res.json({ success: true, message: 'Статус принтера скинуто в IDLE, чергу оновлено!' });

  } catch (error) {
    console.error('Помилка при підтвердженні друку адміном:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
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


// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущенно на http://localhost:${PORT}`);
  
  // Запускаємо наш фоновий MQTT-монітор принтерів
  startBambuMonitor().catch(err => {
    console.error('Помилка при запуску Bambu Monitor:', err);
  });
});