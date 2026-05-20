// backend/src/index.ts
import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Завантажуємо змінні з файлу .env
dotenv.config();

const app = express();
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

// 3. ПРИЙОМ ЗАМОВЛЕНЬ З GOOGLE ФОРМИ (Webhook)
app.post('/api/tasks/google-webhook', async (req: Request, res: Response) => {
  try {
    const { 
      modelName, 
      userEmail, 
      priority, 
      materialType,    // 🔥 Додали деструктуризацію матеріалу
      requestedColor, 
      quantity, 
      comment, 
      gdriveFileLink, 
      gdriveFolderLink 
    } = req.body;

    // Валідація
    if (!modelName || !userEmail) {
      res.status(400).json({ error: 'Пропущено обовʼязкові поля: modelName або userEmail' });
      return;
    }

    // Оновлений інформативний лог — тепер видно і матеріал з кольором
    console.log(`📥 Webhook: Нове замовлення "${modelName}" x${quantity || 1}шт. [Пріоритет: ${priority || 'MEDIUM'}] [Матеріал: ${materialType || 'PLA'}] від ${userEmail}`);

    const username = userEmail.split('@')[0];

    // Записуємо в базу з урахуванням матеріалу
    const newTask = await prisma.printTask.create({
      data: {
        modelName,
        userEmail,
        username,
        priority: priority || 'MEDIUM',
        materialType: materialType || 'PLA', // 🔥 Записуємо матеріал в базу
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
// :id у посиланні — це динамічний параметр (серійник принтера)
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
      include: { currentSpool: true } // одразу підтягуємо інфо про новий пластик
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



// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущенно на http://localhost:${PORT}`);
});