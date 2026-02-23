import React from 'react';
import { BrainCircuit, Sparkles, ShieldAlert, CheckCircle2, Network, FileText, ArrowRight, Bot } from 'lucide-react';

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
    <div className="flex flex-col w-full min-h-[calc(100vh-120px)] max-w-5xl mx-auto px-4 relative z-10 justify-center items-center text-center py-4">
      {/* Decorative Glow behind text */}
      <div className="absolute top-[30%] left-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none mix-blend-screen" />

      <div className="space-y-5 relative z-10 max-w-3xl flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-emerald-500/20 text-emerald-300 text-xs font-medium animate-in fade-in slide-in-from-bottom-4 duration-700 backdrop-blur-md shadow-lg shadow-emerald-900/10">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="tracking-wide">Next-Gen Autonomous Agent</span>
        </div>

        <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.1] animate-in fade-in slide-in-from-bottom-6 duration-700 drop-shadow-sm">
          Meet <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300">
            Jarvis
          </span>
        </h1>

        <p className="text-base text-slate-400 leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100 max-w-2xl px-4">
          Don't just chat with an AI. Orchestrate a <strong>team of specialized experts</strong> that read documents, search the web, and verify facts for you.
        </p>

        <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150">
          <span className="text-emerald-400 text-xs font-medium inline-flex items-center gap-2 bg-emerald-500/10 px-3 py-2 rounded-xl border border-emerald-500/20 shadow-inner">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Zero-trust architecture: Every claim is audited and cited.</span>
          </span>
        </div>

        <div className="w-full max-w-sm pt-2 animate-in fade-in zoom-in-95 duration-700 delay-200">
          <button
            onClick={onStartResearch}
            disabled={isLoading}
            className="w-full group relative flex items-center justify-center gap-3 py-3.5 px-6 bg-slate-900 border border-emerald-500/30 rounded-2xl hover:bg-slate-800 hover:border-emerald-400 transition-all shadow-[0_0_30px_rgba(16,185,129,0.1)] hover:shadow-[0_0_50px_rgba(16,185,129,0.25)] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-1 duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-transparent rounded-2xl pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity" />
            <BrainCircuit className="w-5 h-5 text-emerald-400 group-hover:scale-110 group-hover:text-emerald-300 transition-all duration-300" />
            <span className="text-lg font-bold text-white tracking-wide group-hover:text-emerald-50 transition-colors">
              Initialize Jarvis
            </span>
          </button>
        </div>

        {!isLoading && (
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 pt-4 opacity-70 animate-in fade-in slide-in-from-bottom-10 duration-700 delay-300">
            {/* ChatGPT Comparison Section */}
            <div className="w-full flex flex-col md:flex-row items-center justify-center gap-3 md:gap-6 bg-slate-900/50 border border-white/5 rounded-xl p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-slate-400">
                <Bot className="w-4 h-4 opacity-60" />
                <span className="text-xs font-medium">Standard ChatGPT</span>
              </div>

              <div className="flex items-center gap-2 text-emerald-500/50">
                <ArrowRight className="w-3.5 h-3.5" />
              </div>

              <div className="flex items-center gap-2 text-emerald-300">
                <Network className="w-4 h-4" />
                <div className="text-left text-xs">
                  <span className="font-bold block">Jarvis Multi-Agent Swarm</span>
                  <span className="text-slate-400 text-[10px]">Parallel research, planning, & critical review</span>
                </div>
              </div>
            </div>

            <div className="flex w-full justify-center gap-6 mt-2 pt-3 border-t border-white/5">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 uppercase tracking-widest font-semibold">
                <Network className="w-3.5 h-3.5" /> Web Search
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 uppercase tracking-widest font-semibold">
                <FileText className="w-3.5 h-3.5" /> Document Analysis
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 uppercase tracking-widest font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" /> Self-Correcting
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LandingPage;