import { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { AdminDashboard } from './components/AdminDashboard'; // 🔥 Імпортуємо адмінку
import { LogOut } from 'lucide-react';
import { UserDashboard } from './components/UserDashboard'; // 🔥 Імпортуємо дашборд юзера

interface UserSession {
  email: string;
  role: string;
}

function App() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [booting, setBooting] = useState(true);

  // Перевірка "Remember me" при завантаженні сайту
  useEffect(() => {
    const savedUser = localStorage.getItem('smartfarm_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        localStorage.removeItem('smartfarm_user');
      }
    }
    setBooting(false);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('smartfarm_user');
    setUser(null);
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm tracking-wider animate-pulse">ЗАВАНТАЖЕННЯ SMARTFARM...</div>
      </div>
    );
  }

  // Якщо не авторизований — показуємо вікно входу
  if (!user) {
    return <Login onLoginSuccess={(userData) => setUser(userData)} />;
  }

  // Якщо ввійшов — показуємо головний каркас програми
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      
      {/* Навбар */}
      <nav className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
            SmartFarm Lab
          </span>
          <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {user.role === 'ADMIN' ? '🛠 АДМІНІСТРАТОР' : '📦 СТУДЕНТ'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400 font-medium hidden sm:inline">{user.email}</span>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs bg-slate-800 hover:bg-red-500/10 hover:text-red-400 border border-slate-700 hover:border-red-500/30 px-3 py-2 rounded-xl transition-all"
          >
            <LogOut className="h-4 w-4" />
            <span>Вийти</span>
          </button>
        </div>
      </nav>

      {/* Роутер дашбордів */}
      <main className="p-6">
        {user.role === 'ADMIN' ? (
          // 🔥 Замість старої текстової заглушки тепер рендериться твій реальний дашборд
          <AdminDashboard />
        ) : (
  <UserDashboard userEmail={user.email} />
)}
      </main>
    </div>
  );
}

export default App;