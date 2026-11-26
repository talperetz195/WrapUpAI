import React, { useState } from 'react';
import { Lock, ShieldCheck, KeyRound, ArrowLeft } from 'lucide-react';
import { loginOperator, setupInitialOperator, type AuthStatusResponse } from '../api';

interface AuthGateProps {
  status: AuthStatusResponse;
  onAuthenticated: (token: string, operator: { name: string; role: string }) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ status, onAuthenticated }) => {
  const isFirstRunSetup = !status.envConfigured && !status.claimed;
  const [operatorName, setOperatorName] = useState('נועה כהן — מנהלת מוקד');
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = isFirstRunSetup
        ? await setupInitialOperator(operatorName, passcode)
        : await loginOperator(passcode);
      onAuthenticated(result.token, result.operator);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה באימות הגישה.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-[#0F2942] text-white px-7 py-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-blue-200" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">מוסד תגמולים וביטוח ארצי</h1>
              <p className="text-xs text-slate-300">פורטל מרכזיה מאובטח וניהול תיקי מבוטחים</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-7 space-y-5">
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold text-slate-900">
              {isFirstRunSetup ? 'הגדרת גישה ראשונית למרכזיה' : 'הזדהות נציג מורשה'}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              {isFirstRunSetup
                ? 'הגדירו שם נציג וקוד גישה אישי להפעלת הסביבה הפנימית. כל הפעולות מאומתות בשרת באמצעות אסימון זיכרון.'
                : 'הזינו את קוד הגישה האישי לצורך גישה להקלטות המרכזיה, לכרטיסי הלקוחות וליומן.'}
            </p>
          </div>

          {isFirstRunSetup && (
            <div>
              <label htmlFor="operator-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                שם הנציג / המנהל
              </label>
              <input
                id="operator-name"
                type="text"
                required
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                placeholder="לדוגמה: נועה כהן"
              />
            </div>
          )}

          <div>
            <label htmlFor="operator-passcode" className="block text-xs font-medium text-slate-700 mb-1.5">
              קוד גישה מאובטח
            </label>
            <div className="relative">
              <input
                id="operator-passcode"
                type="password"
                required
                minLength={4}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                placeholder={isFirstRunSetup ? 'בחרו קוד בן 4 תווים לפחות' : 'הזינו קוד גישה'}
              />
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Lock className="w-4 h-4" />
            <span>{loading ? 'מאמת גישה...' : isFirstRunSetup ? 'הפעל מערכת והיכנס' : 'כניסה מאובטחת'}</span>
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between">
            <span>הפרדת רשויות פעילה מול המערכת החיצונית</span>
            <span className="font-mono tabular-nums">HMAC-SHA256</span>
          </div>
        </form>
      </div>
    </div>
  );
};
