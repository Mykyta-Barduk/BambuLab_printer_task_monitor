// backend/prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Початок заселення бази даних тестовими даними...');

  // 1. Очищаємо базу перед заселенням (щоб дані не дублювалися)
  await prisma.printTask.deleteMany({});
  await prisma.printer.deleteMany({});
  await prisma.spool.deleteMany({});

  // 2. Створюємо тестові котушки пластику (імітуємо відскановані QR-коди)
  const spoolBlack = await prisma.spool.create({
    data: {
      id: 'SPL-2026-BLACK',
      materialType: 'PLA',
      colorName: 'Jet Black',
      colorHex: '#000000',
      totalWeightG: 1000,
      remainingWeightG: 850, // Котушка трохи використана
    },
  });

  const spoolRed = await prisma.spool.create({
    data: {
      id: 'SPL-2026-RED',
      materialType: 'PETG',
      colorName: 'Signal Red',
      colorHex: '#FF0000',
      totalWeightG: 1000,
      remainingWeightG: 120, // Ця котушка майже порожня (для тесту паніки адміна!)
    },
  });

  console.log('✅ Тестові котушки додано.');

  // 3. Створюємо фейкові принтери для режиму дебагу
  await prisma.printer.create({
    data: {
      id: 'MOCK_BAMBU_P1S_1',
      name: 'Дебаг Принтер №1 (P1S)',
      model: 'P1S',
      status: 'idle', // Вільний
      currentSpoolId: spoolBlack.id, // Заправлений чорний пластик
    },
  });

  await prisma.printer.create({
    data: {
      id: 'MOCK_BAMBU_X1C_2',
      name: 'Дебаг Принтер №2 (X1C)',
      model: 'X1C',
      status: 'printing', // Імітуємо, що він зараз зайнятий
      currentSpoolId: spoolRed.id, // Заправлений червоний пластик
    },
  });

  console.log('✅ Тестові принтери додано.');

  // 4. Створюємо одну фейкову задачу в черзі, ніби хтось уже заповнив Google Форму
  await prisma.printTask.create({
    data: {
      modelName: 'enclosure_v1.stl',
      userEmail: 'ivan.ivanov@kpi.ua',
      username: 'ivan.ivanov',
      priority: 'HIGH', // Горить!
      requestedColor: 'Jet Black',
      status: 'pending', // Чекає в черзі
    },
  });

  console.log('✅ Тестову задачу в чергу додано.');
  console.log('🎉 Базу даних успішно наповнено!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });