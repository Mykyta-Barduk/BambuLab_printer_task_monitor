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

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущенно на http://localhost:${PORT}`);
});