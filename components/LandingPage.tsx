import React from 'react';
import { BrainCircuit, Sparkles, ShieldAlert, CheckCircle2, Network, FileText, ArrowRight, Bot, Globe, ShieldCheck, Link as LinkIcon, Database, Search } from 'lucide-react';

interface LandingPageProps {
  onStartResearch: () => void;
  isLoading: boolean;
  loadingProgress: number;
  loadingStatus: string;
}

const LandingPage: React.FC<LandingPageProps> = ({
  onStartResearch,
  isLoading,
  loadingProgress,
  loadingStatus
}) => {

  return (
    <div className="flex flex-col lg:flex-row w-full min-h-screen max-w-6xl mx-auto px-8 relative z-10 justify-center items-center py-4 gap-12 lg:gap-20">
      {/* Decorative Glow behind text */}
      <div className="absolute top-[30%] lg:left-[25%] left-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none mix-blend-screen" />

      {/* LEFT SIDE: TEXT BLOCK */}
      <div className="flex-1 space-y-6 relative z-10 flex flex-col items-center lg:items-start text-center lg:text-left">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-emerald-500/20 text-emerald-300 text-xs font-medium animate-in fade-in slide-in-from-bottom-4 duration-700 backdrop-blur-md shadow-lg shadow-emerald-900/10">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="tracking-wide">Multi-Agent System</span>
        </div>

        <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.1] animate-in fade-in slide-in-from-bottom-6 duration-700 drop-shadow-sm">
          Meet <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300">
            Jarvis
          </span>
        </h1>

        <p className="text-base text-slate-400 leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100 max-w-xl">
          Don't just chat with an AI. Orchestrate a <strong>multi-agent system</strong> where specialized experts discuss, debate, and work together to uncover the truth.
        </p>

        <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150">
          <span className="text-emerald-400 text-xs font-medium inline-flex items-center gap-2 bg-emerald-500/10 px-3 py-2 rounded-xl border border-emerald-500/20 shadow-inner">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Zero-trust architecture: Every claim is audited and cited.</span>
          </span>
        </div>

        <div className="w-full max-w-md pt-2 animate-in fade-in zoom-in-95 duration-700 delay-200">
          <button
            onClick={onStartResearch}
            disabled={isLoading}
            className="w-full group relative flex items-center justify-center gap-4 py-4 px-8 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl hover:from-emerald-500 hover:to-teal-500 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-1 duration-300 overflow-hidden"
          >
            <div className="absolute inset-0 bg-white/20 w-full h-full -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] skew-x-12" />
            <BrainCircuit className="w-6 h-6 text-white group-hover:scale-110 transition-transform duration-300 relative z-10" />
            <span className="text-lg font-bold text-white tracking-wide relative z-10 drop-shadow-md">
              Initialize Jarvis
            </span>
          </button>
        </div>
      </div>

      {/* RIGHT SIDE: ARCHITECTURE DIAGRAM */}
      {!isLoading && (
        <div className="hidden lg:flex flex-1 relative items-center justify-center w-full max-w-lg aspect-square animate-in zoom-in-95 duration-1000 delay-300">
          {/* Decorative Background */}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent rounded-full border border-emerald-500/10 blur-[4px]" />

          {/* Connecting Lines (SVG overlay right in the middle layer) */}
          <svg className="absolute inset-0 w-full h-full text-emerald-500/30 z-0 drop-shadow-lg animate-[pulse_4s_ease-in-out_infinite]" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="50" y1="50" x2="20" y2="25" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" className="animate-[dash_3s_linear_infinite]" />
            <line x1="50" y1="50" x2="75" y2="15" stroke="currentColor" strokeWidth="0.3" strokeDasharray="1 1" className="animate-[dash_4s_linear_infinite]" />
            <line x1="50" y1="50" x2="80" y2="65" stroke="currentColor" strokeWidth="0.4" strokeDasharray="2 2" className="animate-[dash_2.5s_linear_infinite]" />
            <line x1="50" y1="50" x2="25" y2="75" stroke="currentColor" strokeWidth="0.4" strokeDasharray="2 2" className="animate-[dash_3.5s_linear_infinite]" />
            <line x1="50" y1="50" x2="55" y2="85" stroke="currentColor" strokeWidth="0.2" strokeDasharray="1 1" className="animate-[dash_4.5s_linear_infinite]" />
            <line x1="50" y1="50" x2="45" y2="12" stroke="currentColor" strokeWidth="0.2" strokeDasharray="1 2" className="animate-[dash_2s_linear_infinite]" />

            {/* Interconnections */}
            <style>
              {`
                  @keyframes dash {
                    to {
                      stroke-dashoffset: -20;
                    }
                  }
                  .animate-\\[dash_3s_linear_infinite\\] { animation: dash 3s linear infinite; }
                  .animate-\\[dash_4s_linear_infinite\\] { animation: dash 4s linear infinite; }
                  .animate-\\[dash_2\\.5s_linear_infinite\\] { animation: dash 2.5s linear infinite; }
                  .animate-\\[dash_3\\.5s_linear_infinite\\] { animation: dash 3.5s linear infinite; }
                  .animate-\\[dash_4\\.5s_linear_infinite\\] { animation: dash 4.5s linear infinite; }
                  .animate-\\[dash_2s_linear_infinite\\] { animation: dash 2s linear infinite; }
                `}
            </style>
            <line x1="20" y1="25" x2="45" y2="12" stroke="currentColor" strokeWidth="0.1" opacity="0.4" />
            <line x1="45" y1="12" x2="75" y2="15" stroke="currentColor" strokeWidth="0.1" opacity="0.4" />
            <line x1="75" y1="15" x2="80" y2="65" stroke="currentColor" strokeWidth="0.15" opacity="0.4" />
            <line x1="80" y1="65" x2="55" y2="85" stroke="currentColor" strokeWidth="0.1" opacity="0.4" />
            <line x1="55" y1="85" x2="25" y2="75" stroke="currentColor" strokeWidth="0.1" opacity="0.4" />
            <line x1="25" y1="75" x2="20" y2="25" stroke="currentColor" strokeWidth="0.15" opacity="0.4" />
          </svg>

          {/* Central Brain - Orchestrator */}
          <div className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center">
            <div className="relative w-20 h-20 bg-slate-900 border border-emerald-500 rounded-full shadow-[0_0_30px_rgba(16,185,129,0.3)] flex items-center justify-center">
              <span className="absolute -inset-1 rounded-full border border-emerald-500 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] opacity-20" />
              <BrainCircuit className="w-10 h-10 text-emerald-400" />
            </div>
            <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase absolute top-full mt-3">Lead</span>
          </div>

          {/* Node 1: Web Expert */}
          <div className="absolute top-[25%] left-[20%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
            <div className="relative w-14 h-14 bg-slate-800 border border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)] rounded-full flex items-center justify-center">
              <span className="absolute -inset-1 rounded-full border border-blue-500 animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite] opacity-20" style={{ animationDelay: '0.5s' }} />
              <Globe className="w-6 h-6 text-blue-400" />
            </div>
            <span className="text-[10px] font-semibold text-slate-400 whitespace-nowrap absolute top-full mt-2">Web Expert</span>
          </div>

          {/* Node 2: URL Expert */}
          <div className="absolute top-[15%] left-[75%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
            <div className="relative w-10 h-10 bg-slate-800 border border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)] rounded-full flex items-center justify-center">
              <span className="absolute -inset-1 rounded-full border border-indigo-500 animate-[ping_3.5s_cubic-bezier(0,0,0.2,1)_infinite] opacity-20" style={{ animationDelay: '1.2s' }} />
              <LinkIcon className="w-4 h-4 text-indigo-400" />
            </div>
            <span className="text-[9px] font-medium text-slate-500 whitespace-nowrap absolute top-full mt-2">URL</span>
          </div>

          {/* Node 3: PDF Expert */}
          <div className="absolute top-[65%] left-[80%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
            <div className="relative w-16 h-16 bg-slate-800 border border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)] rounded-full flex items-center justify-center">
              <span className="absolute -inset-1 rounded-full border border-amber-500 animate-[ping_5s_cubic-bezier(0,0,0.2,1)_infinite] opacity-20" style={{ animationDelay: '2.5s' }} />
              <FileText className="w-7 h-7 text-amber-400" />
            </div>
            <span className="text-[10px] font-semibold text-slate-400 whitespace-nowrap absolute top-full mt-2">PDF Expert</span>
          </div>

          {/* Node 4: Review Board */}
          <div className="absolute top-[75%] left-[25%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
            <div className="relative w-14 h-14 bg-slate-800 border border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)] rounded-full flex items-center justify-center">
              <span className="absolute -inset-1 rounded-full border border-rose-500 animate-[ping_4.5s_cubic-bezier(0,0,0.2,1)_infinite] opacity-20" style={{ animationDelay: '0.8s' }} />
              <ShieldCheck className="w-6 h-6 text-rose-400" />
            </div>
            <span className="text-[10px] font-semibold text-slate-400 whitespace-nowrap absolute top-full mt-2">Review Board</span>
          </div>

          {/* Node 5: Knowledge/Memory */}
          <div className="absolute top-[85%] left-[55%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
            <div className="relative w-12 h-12 bg-slate-800 border border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.3)] rounded-full flex items-center justify-center">
              <span className="absolute -inset-1 rounded-full border border-purple-500 animate-[ping_3.2s_cubic-bezier(0,0,0.2,1)_infinite] opacity-20" style={{ animationDelay: '2s' }} />
              <Database className="w-5 h-5 text-purple-400" />
            </div>
            <span className="text-[9px] font-medium text-slate-500 whitespace-nowrap absolute top-full mt-2">Memory</span>
          </div>

          {/* Node 6: Search */}
          <div className="absolute top-[12%] left-[45%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
            <div className="relative w-8 h-8 bg-slate-800 border border-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.3)] rounded-full flex items-center justify-center">
              <span className="absolute -inset-1 rounded-full border border-teal-500 animate-[ping_2.8s_cubic-bezier(0,0,0.2,1)_infinite] opacity-20" style={{ animationDelay: '1.7s' }} />
              <Search className="w-3 h-3 text-teal-400" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;