import React, { useState } from 'react';
import { api } from './api';
import { Mail, ShieldAlert, Lock } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (user: { email: string; role: string }) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/api/auth/login', { email });

      if (response.data.success) {
        const userData = response.data.user;

        if (rememberMe) {
          localStorage.setItem('smartfarm_user', JSON.stringify(userData));
        }

        onLoginSuccess(userData);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Не вдалося підключитися до сервера. Перевірте, чи запущений бекенд.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="max-w-md w-full space-y-6 bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-xl">
        
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/30 mb-4">
            <Lock className="h-6 w-6 text-purple-400" />
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white">
            SmartFarm Lab
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Введіть вашу пошту для входу
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3 text-sm text-red-400">
            <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">
              E-mail адреса
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ТВОЯ ПОШТА"
                className="block w-full pl-10 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>

          <div className="flex items-center">
            <input
              id="remember-me"
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 bg-slate-950 border-slate-800 rounded text-purple-600 focus:ring-purple-500 accent-purple-500"
            />
            <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-400 select-none cursor-pointer">
              Запам'ятати мене на цьому пристрої
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-3 px-4 text-sm font-medium rounded-xl text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-600/20"
          >
            {loading ? 'Перевірка...' : 'Увійти в систему'}
          </button>
        </form>
      </div>
    </div>
  );
};