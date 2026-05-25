import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { CheckCircle2, XCircle, RefreshCw, Cpu, Layers, User, Plus, Sliders, MessageSquare, X, Download, Clock, AlertTriangle } from 'lucide-react';

interface PrintTask {
  id: number;
  modelName: string;
  userEmail: string;
  username: string;
  quantity: number;
  status: string;
  priority: string;
  materialType: string;
  requestedColor: string;
  comment: string | null;
  gdriveFileLink?: string; 
  gdriveFolderLink?: string;
}

interface Printer {
  id: string;
  name: string;
  model: string;
  status: string;
  progress?: number;
  remainingMins?: number;
}

interface PrintJob {
  id: string;
  fileName: string;
  status: string;
  printerId: string;
  printTasks: PrintTask[];
  progress?: number;       
  remainingMins?: number;  
  bedTemp?: number;        
  nozzleTemp?: number;     
}

export const AdminDashboard: React.FC = () => {
  const [activeJobs, setActiveJobs] = useState<PrintJob[]>([]);
  const [allTasks, setAllTasks] = useState<PrintTask[]>([]);
  const [allPrinters, setAllPrinters] = useState<Printer[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'printers'>('tasks');
  const [loading, setLoading] = useState(true);

  const [selectedComment, setSelectedComment] = useState<string | null>(null);
  const [selectedPrinterJob, setSelectedPrinterJob] = useState<PrintJob | null>(null);
  const [selectedPrinterName, setSelectedPrinterName] = useState<string>('');

  const [newPrinterSerial, setNewPrinterSerial] = useState('');
  const [newPrinterName, setNewPrinterName] = useState('');

  const fetchData = async () => {
    try {
      const [jobsRes, tasksRes, printersRes] = await Promise.all([
        axios.get('http://localhost:5000/api/jobs/active').catch(() => ({ data: [] })),
        axios.get('http://localhost:5000/api/tasks').catch(() => ({ data: [] })),
        axios.get('http://localhost:5000/api/printers').catch(() => ({ data: [] }))
      ]);
      
      const currentJobs: PrintJob[] = Array.isArray(jobsRes.data) ? jobsRes.data : [];
      setActiveJobs(currentJobs);
      
      if (Array.isArray(tasksRes.data)) {
        setAllTasks(tasksRes.data);
      } else if (tasksRes.data && Array.isArray(tasksRes.data.data)) {
        setAllTasks(tasksRes.data.data);
      } else {
        setAllTasks([]);
      }

      // Синхронізуємо живі статуси принтерів з бази даних
      const printersData = Array.isArray(printersRes.data) ? printersRes.data : [];
      const mappedPrinters = printersData.map((p: any) => {
        const matchingJob = currentJobs.find(j => j.printerId.toLowerCase() === p.id.toLowerCase());
        return {
          ...p,
          status: p.status || matchingJob?.status || 'idle',
          progress: p.progress ?? matchingJob?.progress ?? 0,
          remainingMins: p.remainingMins ?? matchingJob?.remainingMins ?? 0
        };
      });
      setAllPrinters(mappedPrinters);

      setSelectedPrinterJob(prev => {
        if (!prev || !prev.printerId) return null;
        const fresh = currentJobs.find(j => j.printerId.toLowerCase() === prev.printerId.toLowerCase());
        return fresh || prev;
      });

    } catch (err) {
      console.error('Помилка завантаження даних:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000); 
    return () => clearInterval(interval);
  }, []);

  const handleConfirmJob = async (jobId: string, success: boolean) => {
    try {
      await axios.post(`http://localhost:5000/api/jobs/${jobId}/confirm`, { success });
      setSelectedPrinterJob(null);
      fetchData();
    } catch (err) {
      alert('Помилка при підтвердженні друку');
    }
  };

  const handleResetPrinterStatus = async (printerId: string) => {
    try {
      await axios.post(`http://localhost:5000/api/printers/${printerId}/reset`);
      alert('Статус принтера успішно скинуто в IDLE!');
      fetchData();
    } catch (err) {
      console.error('Помилка скидання статусу принтера:', err);
      alert('Не вдалося очистити стіл принтера');
    }
  };

  const handleAddPrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrinterSerial || !newPrinterName) return;
    try {
      await axios.post('http://localhost:5000/api/printers', {
        id: newPrinterSerial.trim(),
        name: newPrinterName.trim(),
        model: 'Bambu Lab',
        status: 'idle'
      });
      setNewPrinterSerial('');
      setNewPrinterName('');
      fetchData();
      alert('Принтер успішно додано!');
    } catch (err) {
      alert('Помилка додавання принтера.');
    }
  };

  const openPrinterDetails = (printer: Printer, currentJob: PrintJob | undefined) => {
    setSelectedPrinterName(printer.name);
    if (currentJob) {
      setSelectedPrinterJob(currentJob);
    } else {
      setSelectedPrinterJob({
        id: '',
        fileName: 'Немає активних файлів на друці',
        status: printer.status,
        printerId: printer.id,
        printTasks: [],
        progress: printer.progress,
        remainingMins: printer.remainingMins
      });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-3 text-slate-400">
        <RefreshCw className="h-6 w-6 animate-spin text-purple-500" />
        <span className="text-sm tracking-wide font-mono">Синхронізація бази даних KPI...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative">
      
      {/* 🧭 ВЕРХНІ ТАБИ */}
      <div className="flex border-b border-slate-800 gap-6">
        <button onClick={() => setActiveTab('tasks')} className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-all ${activeTab === 'tasks' ? 'border-purple-500 text-purple-400 font-semibold' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
          <Layers className="h-4 w-4" /> <span>Черга замовлень</span>
        </button>
        <button onClick={() => setActiveTab('printers')} className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-all ${activeTab === 'printers' ? 'border-purple-500 text-purple-400 font-semibold' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
          <Cpu className="h-4 w-4" /> <span>Керування принтерами ({allPrinters.length})</span>
        </button>
      </div>

      {/* ==================== ВКЛАДКА 1: ЧЕРГА ЗАМОВЛЕНЬ ==================== */}
      {activeTab === 'tasks' && (
        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2 uppercase tracking-wider">
              <RefreshCw className="h-3.5 w-3.5 text-purple-500 animate-spin" /> Активні процеси на принтерах
            </h3>
            {activeJobs.length === 0 ? (
              <div className="p-4 text-xs text-center text-slate-500 bg-slate-900 border border-slate-800 rounded-xl">Наразі активних запусків не виявлено.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeJobs.map((job) => (
                  <div key={job.id} className={`p-5 bg-slate-900 border rounded-xl space-y-3 ${job.status === 'waiting_confirmation' ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-slate-800'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold font-mono text-slate-400">SN: {job.printerId}</span>
                      <div className="flex items-center gap-2">
                        {job.remainingMins !== undefined && job.status === 'printing' && <span className="text-xs text-slate-400 font-mono flex items-center gap-1"><Clock className="h-3 w-3" /> {job.remainingMins} хв</span>}
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wide ${job.status === 'waiting_confirmation' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-blue-500/20 text-blue-400 animate-pulse'}`}>
                          {job.status === 'waiting_confirmation' ? '🛑 Контроль' : `▶ ДРУК ${job.progress !== undefined ? `${job.progress}%` : ''}`}
                        </span>
                      </div>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/60 font-mono text-xs text-purple-400 break-all">📄 {job.fileName}</div>
                    {job.status === 'printing' && job.progress !== undefined && (
                      <div className="w-full bg-slate-950 rounded-full h-1.5 border border-slate-800/40 overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-1.5" style={{ width: `${job.progress}%` }} />
                      </div>
                    )}
                    <div className="space-y-1">
                      {job.printTasks && job.printTasks.length > 0 ? (
                        job.printTasks.map(t => (
                          <div key={t.id} className="text-xs bg-slate-950 px-2.5 py-1.5 rounded flex justify-between text-slate-300 border border-slate-900">
                            <span>👤 {t.username} — <span className="font-mono text-slate-400">{t.modelName}</span></span>
                            <span className="text-purple-400 font-bold">x{t.quantity} шт</span>
                          </div>
                        ))
                      ) : <div className="text-[11px] text-slate-500 italic px-1">Сторонній запуск (локальний друк деталей)</div>}
                    </div>
                    {job.status === 'waiting_confirmation' && job.id && !job.id.startsWith('virtual-') && (
                      <div className="pt-2 grid grid-cols-2 gap-2">
                        <button onClick={() => handleConfirmJob(job.id, true)} className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2 px-3 rounded-lg text-xs transition-all"><CheckCircle2 className="h-3.5 w-3.5" /> <span>Успішно</span></button>
                        <button onClick={() => handleConfirmJob(job.id, false)} className="flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-500 text-white font-medium py-2 px-3 rounded-lg text-xs transition-all"><XCircle className="h-3.5 w-3.5" /> <span>Брак</span></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Таблиця замовлень */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wider">Загальний пул замовлень з форми Google</h3>
            <div className="bg-slate-900 border border-slate-800 rounded-xl max-h-[550px] overflow-y-auto relative shadow-inner">
              <table className="w-full text-left border-collapse table-auto">
                <thead className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 shadow-sm">
                  <tr className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                    <th className="p-4 bg-slate-950">Користувач</th>
                    <th className="p-4 bg-slate-950">Назва 3D-моделі</th>
                    <th className="p-4 bg-slate-950">Матеріал</th>
                    <th className="p-4 bg-slate-950">Колір</th>
                    <th className="p-4 bg-slate-950 text-center">Коментар</th>
                    <th className="p-4 bg-slate-950 text-center">Залишок</th>
                    <th className="p-4 bg-slate-950 text-right">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50 text-sm">
                  {allTasks && allTasks.length > 0 ? (
                    allTasks.map((task) => (
                      <tr key={task.id} className="hover:bg-slate-850/30 transition-colors">
                        <td className="p-4">
                          <div className="font-medium text-white flex items-center gap-2"><User className="h-3.5 w-3.5 text-slate-500" />{task.username || 'Анонім'}</div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">{task.userEmail}</div>
                        </td>
                        <td className="p-4 font-mono text-xs max-w-[220px]">
                          {task.gdriveFileLink ? (
                            <a href={task.gdriveFileLink} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 hover:underline flex items-center gap-1 truncate w-full">
                              <span className="truncate">{task.modelName}</span> <Download className="h-3 w-3 text-purple-500/70" />
                            </a>
                          ) : <span className="text-slate-300 truncate block w-full">{task.modelName}</span>}
                        </td>
                        <td className="p-4"><span className="px-2 py-0.5 text-xs font-semibold rounded bg-slate-950 text-purple-300 border border-purple-500/20">{task.materialType || '—'}</span></td>
                        <td className="p-4 text-slate-300">{task.requestedColor || '—'}</td>
                        <td className="p-4 text-center">
                          {task.comment && task.comment.trim().length > 0 ? (
                            <button onClick={() => setSelectedComment(task.comment)} className="relative inline-flex items-center justify-center p-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-purple-400">
                              <MessageSquare className="h-4 w-4" /> <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-black text-slate-950 border border-slate-900 shadow-sm animate-pulse">!</span>
                            </button>
                          ) : <span className="text-slate-600 text-xs italic">немає</span>}
                        </td>
                        <td className="p-4 text-center font-bold text-purple-400">{task.quantity} шт</td>
                        <td className="p-4 text-right">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium border ${
                            task.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            task.status === 'printing' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse' :
                            task.status === 'finished' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}>{task.status === 'pending' ? 'В черзі' : task.status === 'printing' ? 'Друкується' : task.status === 'finished' ? 'Готово' : 'Помилка'}</span>
                        </td>
                      </tr>
                    ))
                  ) : <tr><td colSpan={7} className="p-8 text-center text-slate-500 italic text-xs">Дані відсутні.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ВКЛАДКА 2: ПРИНТЕРИ (АНАТОМІЧНО ПРАВИЛЬНА ВЕРСТКА БЕЗ БЛОКУВАННЯ) ==================== */}
      {activeTab === 'printers' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl h-fit space-y-4">
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2 uppercase tracking-wide"><Plus className="h-4 w-4 text-purple-400" /> Додати 3D-принтер</h3>
            <form onSubmit={handleAddPrinter} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Серійний номер</label>
                <input type="text" required placeholder="Напр. 01S00A12345678" value={newPrinterSerial} onChange={(e) => setNewPrinterSerial(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-lg text-xs text-white focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Назва принтера</label>
                <input type="text" required placeholder="Напр. Splinter" value={newPrinterName} onChange={(e) => setNewPrinterName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-lg text-xs text-white focus:outline-none" />
              </div>
              <button type="submit" className="w-full bg-purple-600 hover:bg-purple-500 font-medium py-2 px-4 rounded-lg text-xs text-white">Зберегти</button>
            </form>
          </div>

          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2 uppercase tracking-wide"><Sliders className="h-4 w-4 text-purple-400" /> Зареєстроване обладнання</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {allPrinters.map((p) => {
                const currentJob = activeJobs.find(j => j.printerId.toLowerCase() === p.id.toLowerCase());
                
                const isWaitingConfirm = p.status === 'waiting_confirmation' || currentJob?.status === 'waiting_confirmation';
                const isRealPrinting = !isWaitingConfirm && currentJob && currentJob.status === 'printing';
                const showProgress = isRealPrinting && (p.progress !== undefined || currentJob?.progress !== undefined);
                const progressValue = p.progress ?? currentJob?.progress ?? 0;
                
                return (
                  <div key={p.id} className="relative flex flex-col pt-4">
                    
                    {/* 🚨 ІЗОЛЬОВАНИЙ БАНЕР З КНОПКАМИ (z-30 та z-40 повністю виключають конфлікти кліку) */}
                    {isWaitingConfirm && (
                      <div className="absolute -top-4 left-2 right-2 z-30 bg-gradient-to-r from-amber-500 to-yellow-600 text-slate-950 text-xs font-bold px-3 py-2.5 rounded-xl shadow-2xl border border-yellow-400 flex flex-col gap-2 animate-bounce">
                        <div className="flex items-center gap-1.5 justify-between">
                          <span className="flex items-center gap-1 uppercase tracking-wider text-[10px] text-slate-900 font-extrabold">
                            <AlertTriangle className="h-3.5 w-3.5 fill-slate-900 text-amber-400 animate-pulse" /> Друк завершено!
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 bg-slate-950/20 rounded font-mono text-slate-900 font-black">Контроль</span>
                        </div>
                        <p className="text-[11px] font-mono font-bold truncate max-w-full text-slate-950/90 bg-slate-950/10 p-1 rounded">
                          📄 {currentJob?.fileName || 'Локальний запуск (Бортова памʼять)'}
                        </p>
                        
                        <div className="grid grid-cols-2 gap-2 pt-0.5 relative z-40">
                          {currentJob && currentJob.id && !currentJob.id.startsWith('virtual-') ? (
                            <>
                              {/* Реальні кнопки для офіційних замовлень */}
                              <button 
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleConfirmJob(currentJob.id, true); }} 
                                className="bg-slate-950 text-emerald-400 hover:bg-slate-900 py-2 px-2 rounded-lg font-black text-[10px] transition-all flex items-center justify-center gap-1 border border-emerald-500/20 shadow-md cursor-pointer active:scale-95"
                              >
                                ✔ Успішно
                              </button>
                              <button 
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleConfirmJob(currentJob.id, false); }} 
                                className="bg-slate-950 text-red-400 hover:bg-slate-900 py-2 px-2 rounded-lg font-black text-[10px] transition-all flex items-center justify-center gap-1 border border-red-500/20 shadow-md cursor-pointer active:scale-95"
                              >
                                ✖ Брак
                              </button>
                            </>
                          ) : (
                            // Кнопка для стороннього локального друку з флешки (Скидає принтер в Idle на бекенді)
                            <button 
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleResetPrinterStatus(p.id); }} 
                              className="bg-slate-950 text-amber-300 hover:bg-slate-900 py-2 px-2 rounded-lg font-black text-[10px] transition-all flex items-center justify-center gap-1 border border-amber-500/20 col-span-2 shadow-md cursor-pointer active:scale-95"
                            >
                              👍 Очистити стіл (Принтер вільний)
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 🖨 КАРТКА ПРИНТЕРА (Тепер це Div, що повністю відкриває кліки на кнопки вище) */}
                    <div 
                      className={`p-4 bg-slate-950 border rounded-xl flex flex-col justify-between text-left transition-all w-full min-h-[110px] ${
                        isWaitingConfirm ? 'border-amber-500 ring-2 ring-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.15)] mt-6' : 'border-slate-800'
                      }`}
                    >
                      <div 
                        onClick={() => openPrinterDetails(p, currentJob)} 
                        className="cursor-pointer hover:opacity-85 transition-opacity flex-1 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-sm text-slate-200">{p.name}</span>
                            <span className={`h-2 w-2 rounded-full ${isWaitingConfirm ? 'bg-amber-500 animate-pulse' : isRealPrinting ? 'bg-blue-500 animate-ping' : 'bg-emerald-500'}`} />
                          </div>
                          <span className="text-[10px] font-mono text-slate-500 block">ID: {p.id}</span>
                        </div>

                        {isRealPrinting && (
                          <div className="w-full bg-slate-900 rounded-full h-1 mt-2 border border-slate-800/40 overflow-hidden">
                            <div className="bg-blue-500 h-1 transition-all duration-300" style={{ width: `${progressValue}%` }} />
                          </div>
                        )}

                        <div className="w-full mt-3 text-xs flex justify-between text-slate-400 border-t border-slate-900/60 pt-2">
                          <span>Поточний стан:</span>
                          <span className={`font-mono text-[11px] uppercase font-bold ${isWaitingConfirm ? 'text-amber-400' : isRealPrinting ? 'text-blue-400' : 'text-emerald-400'}`}>
                            {isWaitingConfirm ? 'контроль якості' : isRealPrinting ? `друк (${progressValue}%)` : 'вільний'}
                          </span>
                        </div>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Модалка коментаря */}
      {selectedComment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-purple-400 flex items-center gap-2 uppercase tracking-wider"><MessageSquare className="h-4 w-4" /> Коментар до замовлення</h4>
              <button onClick={() => setSelectedComment(null)} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="text-sm text-slate-200 bg-slate-950 p-4 rounded-xl border border-slate-800 max-h-[300px] overflow-y-auto break-all whitespace-pre-wrap">{selectedComment}</div>
            <div className="flex justify-end"><button onClick={() => setSelectedComment(null)} className="px-4 py-2 bg-slate-800 text-xs font-semibold rounded-lg text-white">Зрозуміло</button></div>
          </div>
        </div>
      )}

      {/* ==================== 🖨 ДИНАМІЧНИЙ МОНІТОР ПРИНТЕРА ==================== */}
      {selectedPrinterJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl p-6 relative space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider"><Cpu className="h-4 w-4 text-purple-400" /> Монітор: {selectedPrinterName}</h4>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">SN: {selectedPrinterJob.printerId}</p>
              </div>
              <button onClick={() => setSelectedPrinterJob(null)} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 block mb-1.5 font-semibold">Поточний файл друку</span>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs text-purple-400 break-all leading-relaxed">📄 {selectedPrinterJob.fileName}</div>
              </div>

              {selectedPrinterJob.fileName !== 'Немає активних файлів на друці' && (
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5 sm:col-span-2">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-400 font-bold uppercase">Прогрес друку:</span>
                      <span className="text-blue-400 font-extrabold">{selectedPrinterJob.progress ?? 0}%</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-3 border border-slate-800 overflow-hidden">
                      <div className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 h-3 transition-all duration-300" style={{ width: `${selectedPrinterJob.progress ?? 0}%` }} />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg border border-purple-500/20"><Clock className="h-4 w-4" /></div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">Залишилось часу</span>
                      <span className="text-sm font-bold text-slate-200 font-mono">{selectedPrinterJob.status === 'waiting_confirmation' ? 'Завершено' : selectedPrinterJob.remainingMins !== undefined ? `${selectedPrinterJob.remainingMins} хв` : 'рахується...'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">🚀</div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-mono">Швидкість</span>
                      <span className="text-sm font-bold text-slate-200 font-mono">100%</span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <span className="text-[11px] uppercase tracking-wider text-slate-500 block mb-1.5 font-semibold">Відповідні замовлення з бази черги</span>
                {selectedPrinterJob.printTasks && selectedPrinterJob.printTasks.length > 0 ? (
                  <div className="space-y-2 max-h-[150px] overflow-y-auto">
                    {selectedPrinterJob.printTasks.map((t) => (
                      <div key={t.id} className="p-3 bg-slate-950 rounded-xl border border-slate-800/60 text-xs space-y-1">
                        <div className="flex justify-between items-center text-slate-400"><span>👤 {t.username || 'Анонім'}</span><span className="font-mono text-[11px]">{t.userEmail}</span></div>
                        <div className="flex justify-between items-center pt-1 font-mono text-[11px]"><span className="text-purple-300 truncate max-w-[320px]">{t.modelName}</span><span className="text-purple-400 font-bold">x{t.quantity} шт</span></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3.5 text-xs text-slate-500 bg-slate-950 border border-slate-850 rounded-xl italic">
                    У черзі лабораторних замовлень немає відповідностей. Скрипт виводить поточні дані з терміналу MQTT.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button onClick={() => setSelectedPrinterJob(null)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg text-white transition-all">Закрити монітор</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};