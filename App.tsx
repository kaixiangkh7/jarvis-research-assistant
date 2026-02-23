
import React, { useState, useRef, useEffect, useMemo } from 'react';
import Chat from './components/Chat';
import SourceSidebar from './components/SourceSidebar';
import LandingPage from './components/LandingPage';
import { AnalysisResult, SourceViewData } from './types';
import { analyzeFinancialReport, initializeAgentSwarm, removeAgent } from './services/geminiService';
import { Loader2, Sparkles, BrainCircuit, Bot } from 'lucide-react';

const MAX_FILES = 5;

const App: React.FC = () => {
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Processing...");
  const [loadingProgress, setLoadingProgress] = useState(0); // 0 to 100
  const [swarmReadyTimestamp, setSwarmReadyTimestamp] = useState<number>(0);

  // Sidebar State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarData, setSidebarData] = useState<SourceViewData | null>(null);

  const additionalFileInputRef = useRef<HTMLInputElement>(null);

  // Dynamic Browser Title Effect
  useEffect(() => {
    if (analysisResults && analysisResults.length > 0) {
      const mainTitle = analysisResults[0].doc_title;
      const count = analysisResults.length;
      // If single file, use title. If multiple, use count.
      const title = count > 1
        ? `Swarm Analysis (${count} docs)`
        : mainTitle;
      document.title = `${title} | Jarvis`;
    } else {
      document.title = "Jarvis - AI Research Agent";
    }
  }, [analysisResults]);

  const handleStartResearch = async () => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingStatus("Initializing Swarm Interface...");

    try {
      // Phase 1: Agent Swarm Initialization (Web & URL Agents only, no files)
      await initializeAgentSwarm([], (idx, total, msg) => {
        setLoadingStatus(msg);
        const percentage = Math.round(((idx + 1) / total) * 100);
        setLoadingProgress(Math.min(percentage, 99));
      });

      setLoadingProgress(100);
      setLoadingStatus("Research Team Ready!");
      setSwarmReadyTimestamp(Date.now());

      // Set empty results to trigger App Mode
      setAnalysisResults([]);

    } catch (error) {
      console.error("Error initializing swarm:", error);
      alert("Failed to initialize the research swarm.");
    } finally {
      setTimeout(() => {
        setIsLoading(false);
        setLoadingProgress(0);
      }, 500);
    }
  };

  const handleFileUpload = async (files: File[]) => {
    const currentCount = analysisResults ? analysisResults.length : 0;
    if (currentCount + files.length > MAX_FILES) {
      alert(`Limit reached. You can analyze a maximum of ${MAX_FILES} documents at a time.`);
      return;
    }

    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingStatus("Analyzing Documents (Structure Extraction)...");

    const totalSteps = files.length * 2;

    try {
      const structuralResults = await analyzeFinancialReport(files, (idx, total, msg) => {
        setLoadingStatus(msg);
        const completedSteps = idx;
        const percentage = Math.round((completedSteps / totalSteps) * 100);
        setLoadingProgress(percentage);
      });

      setLoadingProgress(50);
      setLoadingStatus("Briefing Research Team (Context Loading)...");

      await initializeAgentSwarm(files, (idx, total, msg) => {
        setLoadingStatus(msg);
        const completedSteps = files.length + idx;
        const percentage = Math.round((completedSteps / totalSteps) * 100);
        setLoadingProgress(Math.min(percentage, 99));
      });

      setLoadingProgress(100);
      setLoadingStatus("Research Team Ready!");
      setSwarmReadyTimestamp(Date.now());

      setAnalysisResults(prev => {
        if (!prev) return structuralResults;
        const existingNames = new Set(structuralResults.map(r => r.source_file));
        const keptPrev = prev.filter(p => !existingNames.has(p.source_file));
        return [...keptPrev, ...structuralResults];
      });

    } catch (error) {
      console.error("Error processing file:", error);
      alert("Failed to analyze the documents.");
    } finally {
      setTimeout(() => {
        setIsLoading(false);
        setLoadingProgress(0);
      }, 500);
    }
  };

  const handleRemoveFile = (fileName: string) => {
    if (window.confirm(`Are you sure you want to remove ${fileName}?`)) {
      // 1. Remove from backend swarm
      removeAgent(fileName);

      // 2. Remove from frontend state
      setAnalysisResults(prev => {
        if (!prev) return null;
        const updated = prev.filter(r => r.source_file !== fileName);
        return updated.length > 0 ? updated : null;
      });
    }
  };

  const onAdditionalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files) as File[];
      const pdfFiles = selectedFiles.filter(file => file.type === 'application/pdf');

      if (pdfFiles.length > 0) {
        handleFileUpload(pdfFiles);
      } else {
        alert("Only PDF files are supported.");
      }
    }
    // Reset input
    if (additionalFileInputRef.current) {
      additionalFileInputRef.current.value = '';
    }
  };

  const handleViewSource = (data: SourceViewData) => {
    setSidebarData(data);
    setIsSidebarOpen(true);
  };

  const currentFileCount = analysisResults ? analysisResults.length : 0;
  const isAppMode = !!analysisResults;

  return (
    <div className={`bg-[#050b14] text-slate-100 font-sans selection:bg-emerald-500/30 relative flex flex-col ${isAppMode ? 'h-screen overflow-hidden' : 'min-h-screen overflow-x-hidden'}`}>
      {/* --- GRID BACKGROUND --- */}
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: `
              linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), 
              linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
            `,
          backgroundSize: '40px 40px',
          backgroundColor: '#050b14'
        }}
      />

      {/* Subtle Glows */}
      <div className="fixed top-0 left-0 w-full h-32 bg-gradient-to-b from-indigo-900/10 to-transparent pointer-events-none" />

      {/* Hidden Input for Additional Uploads */}
      <input
        type="file"
        ref={additionalFileInputRef}
        onChange={onAdditionalFileChange}
        className="hidden"
        multiple
        accept="application/pdf"
      />

      {/* Main Landing Navbar */}
      {!isAppMode && (
        <nav className="flex-none px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full pt-4 pb-2 z-50">
          <div className="bg-slate-900/70 backdrop-blur-xl border border-white/5 rounded-2xl shadow-lg shadow-black/10 h-16 flex items-center justify-between px-6 transition-all hover:border-white/10">
            <div className="flex items-center gap-3 cursor-pointer group">
              <div className="bg-gradient-to-tr from-emerald-500 to-emerald-600 p-1.5 rounded-lg shadow-lg shadow-emerald-500/20 group-hover:shadow-emerald-500/40 transition-shadow">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white group-hover:text-emerald-400 transition-colors duration-300">Jarvis</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/40 border border-slate-700/50 hover:bg-slate-800/60 transition-colors">
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase">
                Gemini 3.0
              </span>
            </div>
          </div>
        </nav>
      )}

      {isLoading && analysisResults && (
        <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-md flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-700 p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm text-center relative overflow-hidden w-full mx-4">
            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 via-transparent to-transparent" />
            <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mb-4 relative z-10" />
            <h3 className="text-lg font-semibold text-white relative z-10 mb-2">Expanding Research Team</h3>
            <div className="w-full bg-slate-800 rounded-full h-1.5 mb-4 overflow-hidden border border-slate-700/50 relative z-10">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <p className="text-sm text-slate-400 relative z-10 animate-pulse">{loadingStatus}</p>
          </div>
        </div>
      )}

      <SourceSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        data={sidebarData}
      />

      <main className={`w-full mx-auto relative z-10 flex-col ${isAppMode ? 'flex-1 flex min-h-0 p-4 max-w-[98%]' : 'flex-grow flex max-w-[98%]'}`}>
        {!analysisResults ? (
          <LandingPage
            onStartResearch={handleStartResearch}
            isLoading={isLoading}
            loadingProgress={loadingProgress}
            loadingStatus={loadingStatus}
          />
        ) : (
          <div className="flex flex-col h-full animate-in fade-in zoom-in-95 duration-500">
            <div className="flex-1 min-h-0 relative h-full">
              <Chat
                analysisResults={analysisResults}
                swarmReadyTimestamp={swarmReadyTimestamp}
                onViewSource={handleViewSource}
                onAddFileClick={() => {
                  if (currentFileCount >= MAX_FILES) {
                    alert(`Maximum ${MAX_FILES} reports allowed.`);
                    return;
                  }
                  additionalFileInputRef.current?.click();
                }}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
