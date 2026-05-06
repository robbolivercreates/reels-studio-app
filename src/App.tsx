import { useState, useEffect } from 'react';
import { ReelsStudio } from './components/ReelsStudio';
import { SettingsModal } from './components/SettingsModal';

export default function App() {
  const [hasRequiredKeys, setHasRequiredKeys] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const fal = localStorage.getItem('FAL_KEY');
    const heygen = localStorage.getItem('HEYGEN_API_KEY');
    setHasRequiredKeys(!!(fal && heygen));
  }, []);

  const handleKeysSaved = () => {
    const fal = localStorage.getItem('FAL_KEY');
    const heygen = localStorage.getItem('HEYGEN_API_KEY');
    setHasRequiredKeys(!!(fal && heygen));
    setShowSettings(false);
  };

  if (hasRequiredKeys === null) return null;

  if (!hasRequiredKeys) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-6">
        <div className="bg-[#141416] border border-white/10 rounded-3xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-violet-500/20 border border-violet-400/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.867V15.133a1 1 0 01-1.447.902L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100 mb-2">Reels Studio</h1>
          <p className="text-zinc-400 text-sm mb-8">Configure suas chaves de API pra começar.</p>
          <button
            onClick={() => setShowSettings(true)}
            className="w-full py-3.5 bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-white font-semibold rounded-xl transition-colors shadow-[0_0_20px_rgba(124,58,237,0.4)]"
          >
            Configurar chaves
          </button>
        </div>
        {showSettings && (
          <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} onSave={handleKeysSaved} />
        )}
      </div>
    );
  }

  return (
    <>
      <ReelsStudio />
      {showSettings && (
        <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} onSave={handleKeysSaved} />
      )}
    </>
  );
}
