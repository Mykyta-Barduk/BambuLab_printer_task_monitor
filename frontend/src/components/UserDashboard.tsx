import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Clock, CheckCircle2, RefreshCw, Box, ExternalLink } from 'lucide-react';

interface UserDashboardProps {
  userEmail: string;
}

interface PrintTask {
  id: number;
  modelName: string;
  quantity: number;
  status: string;
  materialType: string;
  requestedColor: string;
  createdAt: string;
  printJob?: {
    printer?: {
      name: string;
    };
  } | null;
}

export const UserDashboard: React.FC<UserDashboardProps> = ({ userEmail }) => {
  const [myTasks, setMyTasks] = useState<PrintTask[]>([]);
  const [loading, setLoading] = useState(true);

  // Сюди встав реальне посилання на твою Google Форму SmartFarm
  const googleFormLink = "https://docs.google.com/forms/d/e/1FAIpQLSfOhQCqQce84D89NBYzqtQzedxCT2-9Ob6LAon5r58L8F6Tqw/viewform";

 const fetchUserTasks = async () => {
    try {
      const response = await axios.get(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/tasks/user/${encodeURIComponent(userEmail)}`);
      setMyTasks(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      console.error('Помилка завантаження замовлень:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserTasks();
    const interval = setInterval(fetchUserTasks, 5000);
    return () => clearInterval(interval);
  }, [userEmail]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-2 text-slate-400">
        <RefreshCw className="h-5 w-5 animate-spin text-purple-500" />
        <span className="text-xs font-mono">Завантаження вашого кабінету...</span>
      </div>
    );
  }

  // Розрахунок статистики деталей
  const pendingCount = myTasks.filter(t => t.status === 'pending').reduce((acc, t) => acc + t.quantity, 0);
  const printingCount = myTasks.filter(t => t.status === 'printing').length;
  const finishedCount = myTasks.filter(t => t.status === 'finished').length;

  return (
    <div className="space-y-6 animate-fadeIn">
      
      {/* ШАПКА КАБІНЕТУ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-white">Кабінет користувача SmartFarm</h2>
          <p className="text-xs text-slate-400 mt-0.5">Відстеження друку деталей</p>
        </div>
        
        {/* КНОПКА ДЛЯ НОВОГО ЗАМОВЛЕННЯ */}
        <a 
          href={googleFormLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-bold py-3 px-5 rounded-xl transition-all shadow-lg shadow-purple-600/15 group shrink-0"
        >
          <span>Зробити замовлення</span>
          <ExternalLink className="h-3.5 w-3.5 text-purple-200 group-hover:text-white transition-colors" />
        </a>
      </div>

      {/* СТАТИСТИКА БАЛАНСУ користувача */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 text-amber-400">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block uppercase tracking-wider font-medium">Залишилось надрукувати</span>
            <span className="text-xl font-bold text-white font-mono">{pendingCount} шт</span>
          </div>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20 text-blue-400">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block uppercase tracking-wider font-medium">Зараз на принтері</span>
            <span className="text-xl font-bold text-white font-mono">
              {printingCount > 0 ? `${printingCount} моделі` : 'Немає'}
            </span>
          </div>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20 text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block uppercase tracking-wider font-medium">Повністю готові таски</span>
            <span className="text-xl font-bold text-white font-mono">{finishedCount} замовлень</span>
          </div>
        </div>
      </div>

      {/* СПИСОК ЗАМОВЛЕНЬ З ФОРМИ */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <Box className="h-4 w-4 text-purple-400" />
          Ваша поточна черга деталей
        </h3>

        {myTasks.length === 0 ? (
          <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl text-slate-500 text-sm">
            Ви ще не подавали заявок через Google Форму або вказали інший e-mail при авторизації.
          </div>
        ) : (
          <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
            {myTasks.map((task) => (
              <div 
                key={task.id} 
                className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-700 transition-colors"
              >
                <div className="space-y-1 max-w-xl">
                  <span className="text-xs text-slate-500 block font-mono">
                    Подано: {new Date(task.createdAt).toLocaleDateString('uk-UA')}
                  </span>
                  <h4 className="text-sm font-semibold text-white font-mono truncate" title={task.modelName}>
                    {task.modelName}
                  </h4>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-950 text-purple-300 border border-purple-500/20">
                      {task.materialType || 'PLA'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] rounded bg-slate-950 text-slate-300 border border-slate-800">
                      🎨 {task.requestedColor || 'Стандартний'}
                    </span>
                    {task.status === 'printing' && task.printJob?.printer?.name && (
                      <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse">
                        🖨 {task.printJob.printer.name}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0 border-t sm:border-t-0 border-slate-800/60 pt-3 sm:pt-0">
                  <div className="text-left sm:text-right">
                    <span className="text-[11px] text-slate-500 block uppercase">Залишок деталей</span>
                    <span className="text-sm font-bold text-purple-400 font-mono">{task.quantity} шт</span>
                  </div>

                  <div className="w-28 text-right">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border ${
                      task.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                      task.status === 'printing' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse' :
                      task.status === 'finished' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                      {task.status === 'pending' && 'В черзі'}
                      {task.status === 'printing' && 'Друкується'}
                      {task.status === 'finished' && 'Готово'}
                      {task.status === 'failed' && 'Брак'}
                    </span>
                  </div>
                </div>

              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};