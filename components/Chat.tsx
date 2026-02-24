
import React, { useState, useRef, useEffect, useMemo, ClipboardEvent } from 'react';
import { Send, User, Bot, Network, CheckCircle2, Circle, Layers, BrainCircuit, ChevronDown, ChevronRight, Play, FileText, ListTodo, MessageSquare, FileSearch, Zap, Search, MessageSquarePlus, Sparkles, Scale, AlertTriangle, ShieldCheck, XCircle, Square, Briefcase, Users, RefreshCcw, ArrowRight, Lightbulb, GitPullRequest, Star, List, Undo2, LayoutTemplate, Eye, ChevronUp, FastForward, StopCircle, Map, PenTool, Radio, Terminal, Quote, Activity, Check, X, Shield, Image as ImageIcon, Plus, Globe, Download, Link as LinkIcon } from 'lucide-react';
import { ChatMessage, AnalysisResult, OrchestratorPlan, SourceViewData, CollaborationStep, AdvisorReview, OutputQualityVerdict, ClarificationRequest, ResearchEvaluation, ExecutionLog, IntentClassification, ExecutionResultLog, LeadArbitration } from '../types';
import { createCollaborativePlan, getSwarmStatus, refinePlanWithAdvisor, cancelRunningAgent, reviewOutputWithBoard, arbitrateReviewBoardFeedback, generateClarificationQuestions, executePlanTasks, evaluateResearchResults, synthesizeReport, classifyUserIntent, executeQuickAnswer } from '../services/geminiService';
import { exportReportToDocx } from '../utils/docxExport';

interface ChatProps {
    analysisResults?: AnalysisResult[];
    swarmReadyTimestamp: number;
    onViewSource?: (data: SourceViewData) => void;
    onAddFileClick?: () => void;
}

type SwarmPhase = 'IDLE' | 'INTENT' | 'PLANNING' | 'REVIEW' | 'EXECUTION' | 'SYNTHESIS';

const getAllTasks = (plan: OrchestratorPlan) => {
    return plan.steps.flatMap(step => step.tasks);
};

// --- SMALL COMPONENTS FOR RENDERING ---

interface CitationChipProps {
    source: string;
    quote: string;
    page: string;
    context?: string;
    onClick?: () => void;
    children: React.ReactNode;
}

const CitationChip: React.FC<CitationChipProps> = ({ source, quote, page, context, onClick, children }) => {
    const isUrl = source.startsWith('http') || source.startsWith('www');

    if (isUrl) {
        return (
            <a
                href={source}
                target="_blank"
                rel="noopener noreferrer"
                className="relative inline-block group cursor-pointer no-underline"
                onClick={(e) => e.stopPropagation()}
            >
                <span className="border-b border-dashed border-blue-400/50 text-blue-300 hover:bg-blue-500/20 hover:text-white transition-colors rounded px-0.5 mx-0.5 inline-flex items-center gap-1 font-medium">
                    {children}
                    <Network className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                </span>
            </a>
        );
    }

    return (
        <span
            className="relative inline-block group cursor-pointer"
            onClick={onClick}
        >
            <span className="border-b border-dashed border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/20 hover:text-white transition-colors rounded px-0.5 mx-0.5 inline-flex items-center gap-1 font-medium">
                {children}
                <FileSearch className="w-3 h-3 opacity-50 group-hover:opacity-100" />
            </span>
        </span>
    );
};

const parseAndRenderClaims = (text: string, onViewSource?: (data: SourceViewData) => void) => {
    if (!text) return null;

    const claimTagRegex = /<claim([\s\S]*?)>([\s\S]*?)<\/claim>/g;

    type Part =
        | { type: 'text'; content: string }
        | { type: 'claim'; source: string; quote: string; page: string; context: string; logic: string; content: string };

    const parts: Part[] = [];
    let lastIndex = 0;
    let match;

    while ((match = claimTagRegex.exec(text)) !== null) {
        const [fullMatch, attributesString, content] = match;
        const startIndex = match.index;

        if (startIndex > lastIndex) {
            parts.push({ type: 'text', content: text.substring(lastIndex, startIndex) });
        }

        const attrRegex = /(\w+)="([^"]*)"/g;
        const attrs: Record<string, string> = {};
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attributesString)) !== null) {
            attrs[attrMatch[1]] = attrMatch[2];
        }

        parts.push({
            type: 'claim',
            source: attrs.source || 'Unknown Source',
            quote: attrs.quote || '',
            page: attrs.page || '',
            context: attrs.context || '',
            logic: attrs.logic || '',
            content: content
        });

        lastIndex = claimTagRegex.lastIndex;
    }

    if (lastIndex < text.length) {
        parts.push({ type: 'text', content: text.substring(lastIndex) });
    }

    return (
        <>
            {parts.map((part, i) => {
                if (part.type === 'text') {
                    return <span key={i}>{part.content}</span>;
                } else {
                    return (
                        <CitationChip
                            key={i}
                            source={part.source}
                            quote={part.quote}
                            page={part.page}
                            context={part.context}
                            onClick={() => onViewSource && onViewSource({
                                fileName: part.source,
                                page: part.page,
                                quote: part.quote,
                                contextBlock: part.context || part.quote,
                                rationale: part.logic
                            })}
                        >
                            {part.content}
                        </CitationChip>
                    );
                }
            })}
        </>
    );
};

interface MarkdownTableProps {
    content: string;
    onViewSource?: (data: SourceViewData) => void;
}

const MarkdownTable: React.FC<MarkdownTableProps> = ({ content, onViewSource }) => {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return null;

    const parseRow = (row: string) => {
        return row.split('|').filter((cell, idx, arr) => {
            if (idx === 0 && cell.trim() === '') return false;
            if (idx === arr.length - 1 && cell.trim() === '') return false;
            return true;
        });
    };

    const headers = parseRow(lines[0]);
    const bodyRows = lines.slice(2).map(line => parseRow(line));

    return (
        <div className="overflow-x-auto my-4 rounded-lg border border-slate-700 shadow-sm">
            <table className="w-full text-sm text-left text-slate-300">
                <thead className="text-xs uppercase bg-slate-800 text-slate-400">
                    <tr>
                        {headers.map((h, i) => (
                            <th key={i} className="px-6 py-3 border-b border-slate-700 whitespace-nowrap font-bold">
                                {parseAndRenderClaims(h, onViewSource)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                    {bodyRows.map((row, i) => (
                        <tr key={i} className="bg-slate-900/30 hover:bg-slate-800/50 transition-colors">
                            {row.map((cell, j) => (
                                <td key={j} className="px-6 py-4">
                                    {parseAndRenderClaims(cell, onViewSource)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const FormattedMessage = ({ text, onViewSource }: { text: string, onViewSource?: (data: SourceViewData) => void }) => {
    if (!text) return null;

    const lines = text.split('\n');
    const blocks: { type: 'text' | 'table', content: string[] }[] = [];

    let currentBlock: { type: 'text' | 'table', content: string[] } = { type: 'text', content: [] };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const isTableLine = trimmed.startsWith('|') && trimmed.endsWith('|');

        if (isTableLine) {
            const nextLine = lines[i + 1]?.trim();
            const isNextSeparator = nextLine?.startsWith('|') && nextLine?.includes('---');

            if (currentBlock.type === 'text') {
                if (isNextSeparator || (currentBlock.content.length === 0 && trimmed.includes('|'))) {
                    if (currentBlock.content.length > 0) blocks.push({ ...currentBlock });
                    currentBlock = { type: 'table', content: [] };
                }
            }
        } else if (currentBlock.type === 'table') {
            blocks.push({ ...currentBlock });
            currentBlock = { type: 'text', content: [] };
        }

        currentBlock.content.push(line);
    }

    if (currentBlock.content.length > 0) blocks.push({ ...currentBlock });

    return (
        <div>
            {blocks.map((block, idx) => {
                if (block.type === 'table') {
                    const content = block.content.join('\n');
                    if (block.content.length >= 2 && block.content[1].includes('---')) {
                        return <MarkdownTable key={idx} content={content} onViewSource={onViewSource} />;
                    } else {
                        return <div key={idx} className="whitespace-pre-wrap mb-2">{parseAndRenderClaims(content, onViewSource)}</div>;
                    }
                } else {
                    const content = block.content.join('\n');
                    return (
                        <div key={idx} className="whitespace-pre-wrap mb-2">
                            {parseAndRenderClaims(content, onViewSource)}
                        </div>
                    );
                }
            })}
        </div>
    );
};

// --- HELPERS ---

const getReportTitle = (text: string) => {
    if (!text) return "ANALYSIS REPORT";
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // 1. Look for explicit headers
    const header = lines.find(l => l.startsWith('#'));
    if (header) {
        return header.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
    }

    // 2. Look for bolded start lines that look like titles (short)
    const boldLine = lines.find(l => l.startsWith('**') && l.length < 80);
    if (boldLine) {
        return boldLine.replace(/\*\*/g, '').trim();
    }

    return "FINAL ANALYSIS REPORT";
};

// --- VISUALIZATION COMPONENTS ---

interface AgentNodeProps {
    id: string;
    label: string;
    icon: React.ReactNode;
    isActive: boolean; // "Working" state
    isEnabled: boolean; // "Selected" state
    isSystem?: boolean;
    onClick?: () => void;
    pulseColor?: string;
}

const AgentNode: React.FC<AgentNodeProps> = ({ id, label, icon, isActive, isEnabled, onClick, isSystem = false, pulseColor = 'text-emerald-500' }) => (
    <div className={`relative z-10 flex flex-col items-center gap-2 w-full group ${!isSystem && onClick ? 'cursor-pointer' : ''}`} onClick={!isSystem ? onClick : undefined}>
        {/* Glow behind active node */}
        <button
            className={`
                w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 relative bg-slate-900 group-hover:scale-105
                ${isActive
                    ? `border-${pulseColor.split('-')[1]}-500 shadow-[0_0_20px_rgba(255,255,255,0.2)] scale-110 z-20 bg-slate-800`
                    : isEnabled
                        ? 'border-slate-600 text-slate-300 hover:border-emerald-400 hover:text-emerald-400 shadow-lg shadow-black/50'
                        : 'border-slate-800 border-dashed text-slate-600 hover:border-slate-500 hover:text-slate-400 bg-[#050b14]'
                }
                ${!isSystem && isEnabled ? 'cursor-pointer' : !isSystem ? 'cursor-pointer' : 'cursor-default'}
            `}
            title={isSystem ? "System Agent - Always Active" : isEnabled ? "Click to disable expert" : "Click to enable expert"}
        >
            {icon}

            {/* Status Indicator Badge (Visual Cue for Toggle) */}
            <div className={`absolute -bottom-1 -right-1 z-20 transition-transform group-hover:scale-110 ${!isEnabled ? 'group-hover:opacity-100 opacity-80' : ''}`}>
                {isSystem ? (
                    <div className="bg-slate-800 text-slate-400 rounded-full p-0.5 border border-[#0b1221]" title="Always On">
                        <Shield className="w-2.5 h-2.5" />
                    </div>
                ) : isEnabled ? (
                    <div className="bg-emerald-500 text-white rounded-full p-0.5 border border-[#0b1221] shadow-sm">
                        <Check className="w-2.5 h-2.5" />
                    </div>
                ) : (
                    <div className="bg-slate-800 text-slate-400 rounded-full p-0.5 border border-[#0b1221] group-hover:bg-slate-700 group-hover:text-white transition-colors">
                        <Plus className="w-2.5 h-2.5" />
                    </div>
                )}
            </div>

            {isActive && (
                <span className={`absolute -inset-1 rounded-full border border-current animate-ping opacity-50 ${pulseColor}`}></span>
            )}
        </button>

        {/* Label & Hint Area */}
        <div className="flex flex-col items-center gap-1">
            <div className={`
                text-[9px] font-bold uppercase tracking-wider transition-colors max-w-full text-center leading-tight break-words
                ${isActive ? pulseColor : isEnabled ? 'text-slate-300' : 'text-slate-600 group-hover:text-slate-400'}
            `}>
                {label}
            </div>
            {!isSystem && !isEnabled && (
                <div className="text-[8px] text-emerald-500/0 group-hover:text-emerald-400/80 transition-colors uppercase tracking-widest font-semibold absolute -bottom-4 whitespace-nowrap">
                    Click to Enable
                </div>
            )}
        </div>
    </div>
);

const TeamNetwork: React.FC<{
    agents: string[];
    activeAgents: string[];
    onToggle: (agent: string) => void;
    phase: SwarmPhase;
    workingAgents: string[];
    onAddFileClick?: () => void;
}> = ({ agents, activeAgents, onToggle, phase, workingAgents, onAddFileClick }) => {

    // States for animations
    const isReviewActive = phase === 'REVIEW';
    const isPlanningActive = phase === 'PLANNING' || phase === 'INTENT' || phase === 'SYNTHESIS';
    const isExecutionActive = phase === 'EXECUTION';

    return (
        <div className="w-20 lg:w-[100px] bg-[#0b1221] border-r border-white/5 py-6 select-none shadow-2xl relative z-20 flex-shrink-0 h-full overflow-y-auto custom-scrollbar hide-scrollbar">
            <div className="relative flex flex-col items-center justify-start gap-6 w-full h-full">

                {/* --- ROW 1: SYSTEM AGENTS --- */}
                <div className="flex flex-col items-center justify-center gap-5 w-full">
                    {/* 1. Review Board */}
                    <AgentNode
                        id="sys_reviewer"
                        label="Review Board"
                        icon={<ShieldCheck className="w-4 h-4" />}
                        isActive={isReviewActive}
                        isEnabled={true}
                        isSystem={true}
                        pulseColor="text-rose-400"
                    />

                    {/* 2. Lead Researcher */}
                    <AgentNode
                        id="sys_lead"
                        label="Lead Researcher"
                        icon={<BrainCircuit className="w-4 h-4" />}
                        isActive={isPlanningActive || isExecutionActive || isReviewActive}
                        isEnabled={true}
                        isSystem={true}
                        pulseColor="text-indigo-400"
                    />
                </div>

                {/* Separator */}
                <div className="w-8 h-px bg-slate-800" />

                {/* --- ROW 2: EXPERT AGENTS --- */}
                <div className="flex flex-col items-center justify-center gap-5 w-full">
                    {/* --- FILE AGENTS --- */}
                    {agents.map((agent, i) => {
                        const isEnabled = activeAgents.includes(agent);
                        const isWorking = workingAgents.includes(agent) && isExecutionActive;
                        const IconComponent = agent === 'Web Expert' ? Globe : agent === 'URL Expert' ? LinkIcon : FileText;

                        return (
                            <AgentNode
                                key={agent}
                                id={agent}
                                label={agent}
                                icon={<IconComponent className="w-4 h-4" />}
                                isActive={isWorking}
                                isEnabled={isEnabled}
                                onClick={() => onToggle(agent)}
                                pulseColor="text-emerald-400"
                            />
                        );
                    })}

                    {agents.length === 0 && (
                        <div className="text-[10px] text-slate-600 italic px-2 text-center">Enable experts</div>
                    )}

                    {/* --- ADD FILE ACTION TILE --- */}
                    {onAddFileClick && (
                        <div className="relative z-10 flex flex-col items-center gap-1 w-full group cursor-pointer mt-2" onClick={onAddFileClick}>
                            <button
                                className="w-10 h-10 rounded-full flex items-center justify-center border-2 border-slate-800 border-dashed text-slate-600 bg-[#050b14] hover:border-slate-500 hover:text-slate-400 group-hover:scale-105 transition-all duration-300 relative"
                                title="Upload PDF Document"
                            >
                                <FileText className="w-4 h-4" />
                                <div className="absolute -bottom-1 -right-1 z-20 bg-slate-800 text-slate-400 rounded-full p-0.5 border border-[#0b1221] group-hover:bg-slate-700 group-hover:text-white transition-colors">
                                    <Plus className="w-2.5 h-2.5" />
                                </div>
                            </button>
                            <div className="flex flex-col items-center gap-0.5">
                                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600 group-hover:text-slate-400 transition-colors text-center w-max mt-1">
                                    PDF Expert
                                </div>
                                <div className="text-[8px] text-emerald-500/0 group-hover:text-emerald-400/80 transition-colors uppercase tracking-widest font-semibold absolute -bottom-3 whitespace-nowrap">
                                    Upload File
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};


// --- SWARM ACTIVITY COMPONENT ---

const CollaborationLog = ({ steps }: { steps: CollaborationStep[] }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current && isExpanded) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [steps, isExpanded]);

    if (!steps || steps.length === 0) return null;

    return (
        <div className="mb-6 rounded-lg border border-slate-800 bg-[#0b1221] overflow-hidden w-full">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between p-3 bg-slate-900/50 hover:bg-slate-800/50 transition-colors border-b border-slate-800"
            >
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Activity className="w-4 h-4 text-emerald-400" />
                    </div>
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Team Activity</span>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{steps.length} events</span>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>

            {isExpanded && (
                <div ref={scrollRef} className="p-3 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar scroll-smooth bg-[#0b1221]">
                    {steps.map((step, idx) => {
                        const isOrchestrator = step.type === 'ORCHESTRATOR';
                        const isBoardReview = step.type === 'BOARD_REVIEW';
                        const isAdvisor = step.type === 'ADVISOR';
                        const isEvaluation = step.type === 'RESEARCH_EVALUATION';
                        const isExecution = step.type === 'EXECUTION_LOG';
                        const isResults = step.type === 'EXECUTION_RESULTS';
                        const isLeadArbitration = step.type === 'LEAD_ARBITRATION';

                        // Filter out internal results if too verbose, or show condensed
                        if (isResults) return null;

                        return (
                            <div key={idx} className="relative pl-4 animate-in fade-in slide-in-from-left-2 duration-300">

                                {/* Timeline Connector */}
                                {idx < steps.length - 1 && <div className="absolute left-[5px] top-3 bottom-[-20px] w-px bg-slate-800"></div>}

                                {/* Timeline Dot */}
                                <div className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full z-10 ${isOrchestrator ? 'bg-indigo-500' :
                                    isAdvisor ? 'bg-blue-500' :
                                        isBoardReview ? 'bg-orange-500' :
                                            isLeadArbitration ? 'bg-fuchsia-500' :
                                                isEvaluation ? 'bg-purple-500' :
                                                    'bg-emerald-500'
                                    }`} />

                                {/* HEADER ROW */}
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className={`text-[10px] font-bold uppercase tracking-widest ${isOrchestrator ? 'text-indigo-400' :
                                        isAdvisor ? 'text-blue-400' :
                                            isBoardReview ? 'text-orange-400' :
                                                isLeadArbitration ? 'text-fuchsia-400' :
                                                    isEvaluation ? 'text-purple-400' :
                                                        'text-emerald-400'
                                        }`}>
                                        {isOrchestrator ? 'Research Strategy' :
                                            isAdvisor ? 'Review Board (Advisor)' :
                                                isBoardReview ? 'Consultant Opinion' :
                                                    isLeadArbitration ? 'Lead Researcher Decision' :
                                                        isEvaluation ? 'Analysis Phase' :
                                                            'Lead Researcher'}
                                    </span>
                                    <span className="text-[10px] text-slate-600 font-mono">
                                        {new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                    </span>
                                </div>

                                {/* CONTENT CARD */}
                                <div className={`rounded border p-3 text-xs leading-relaxed ${isBoardReview ? 'bg-orange-950/10 border-orange-500/20' :
                                    isLeadArbitration ? 'bg-fuchsia-950/10 border-fuchsia-500/20' :
                                        isEvaluation ? 'bg-purple-900/10 border-purple-500/20' :
                                            isAdvisor ? 'bg-blue-950/10 border-blue-500/20' :
                                                'bg-[#0f1623] border-slate-800'
                                    }`}>

                                    {/* ORCHESTRATOR */}
                                    {isOrchestrator && (
                                        <div className="space-y-3">
                                            <div className="text-slate-300 italic">"{(step.content as OrchestratorPlan).thought_process}"</div>

                                            {/* Plan Details Unfolded */}
                                            <div className="space-y-2 mt-2">
                                                {(step.content as OrchestratorPlan).steps.map((s, i) => (
                                                    <div key={i} className="flex items-start gap-2 text-[10px] text-slate-400">
                                                        <span className="font-bold text-indigo-400 shrink-0">{i + 1}.</span>
                                                        <span><span className="font-bold text-slate-300">{s.step_title}:</span> {s.description}</span>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="flex items-center gap-2 pt-2 border-t border-indigo-500/10">
                                                <div className="bg-indigo-500/10 text-indigo-300 px-2 py-1 rounded text-[10px] font-bold border border-indigo-500/20 uppercase">
                                                    {(step.content as OrchestratorPlan).plan_type}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ADVISOR (COMMITTEE REVIEW) */}
                                    {isAdvisor && (
                                        <div className="space-y-3">
                                            {/* Scorecard Grid */}
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                                {Object.entries((step.content as AdvisorReview).scorecard).map(([key, score]) => (
                                                    <div key={key} className="flex items-center justify-between">
                                                        <span className="text-[9px] text-slate-500 lowercase truncate pr-2">{key.replace(/_/g, ' ')}</span>
                                                        <div className="flex gap-0.5">
                                                            {[1, 2, 3, 4, 5].map((s) => (
                                                                <div
                                                                    key={s}
                                                                    className={`w-4 h-1 rounded-sm ${s <= score ? 'bg-emerald-500' : 'bg-slate-800'}`}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Risks */}
                                            {(step.content as AdvisorReview).key_risks.length > 0 && (
                                                <div className="border-t border-blue-900/30 pt-2 mt-2">
                                                    <div className="text-[9px] font-bold text-rose-400 uppercase mb-1 flex items-center gap-1">
                                                        <AlertTriangle className="w-3 h-3" /> Risks Identified
                                                    </div>
                                                    <ul className="list-disc list-inside text-slate-400 space-y-0.5 pl-1">
                                                        {(step.content as AdvisorReview).key_risks.map((risk, i) => (
                                                            <li key={i} className="leading-snug">{risk}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* EXECUTION LOG - CARD STYLE */}
                                    {isExecution && (
                                        <div className="space-y-2">
                                            <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-2">
                                                Goal: {(step.content as ExecutionLog).tasks[0].rationale.substring(0, 30)}...
                                            </div>
                                            {(step.content as ExecutionLog).tasks.map((t, i) => (
                                                <div key={i} className="bg-[#161b2c] border border-slate-700/50 rounded p-2 flex items-start gap-3">
                                                    <FileText className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                                                    <div className="min-w-0">
                                                        <div className="text-emerald-400/80 font-bold text-[9px] mb-0.5 truncate uppercase">{t.file_name}</div>
                                                        <div className="text-slate-300 text-[10px] line-clamp-2">"{t.specific_question}"</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* ANALYSIS PHASE - PURPLE */}
                                    {isEvaluation && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded text-[9px] font-bold border border-purple-500/30 uppercase">
                                                    GAP ANALYSIS: {(step.content as ResearchEvaluation).status}
                                                </span>
                                            </div>
                                            <div className="text-slate-300 italic pl-2 border-l-2 border-purple-500/30">
                                                {(step.content as ResearchEvaluation).gap_analysis}
                                            </div>
                                        </div>
                                    )}

                                    {/* BOARD AUDIT (CONSULTANT) - ORANGE */}
                                    {isBoardReview && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold border uppercase bg-orange-500/20 text-orange-400 border-orange-500/30`}>
                                                    CONSULTANT OPINION
                                                </span>
                                            </div>
                                            <div className="text-slate-300 text-[10px]">
                                                <strong>Answers Query:</strong> {(step.content as OutputQualityVerdict).does_answer_query ? 'Yes' : 'No'}
                                                <br />
                                                <strong>Has Hallucinations:</strong> {(step.content as OutputQualityVerdict).has_hallucinations ? 'Yes' : 'No'}
                                            </div>
                                            <div className="text-slate-400 text-[10px] leading-relaxed italic border-t border-orange-500/20 pt-1 mt-1">
                                                {(step.content as OutputQualityVerdict).consultant_opinion}
                                            </div>
                                        </div>
                                    )}

                                    {/* LEAD ARBITRATION - FUCHSIA */}
                                    {isLeadArbitration && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold border uppercase ${(step.content as LeadArbitration).verdict === 'APPROVED'
                                                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                                    : (step.content as LeadArbitration).verdict === 'DEBATE'
                                                        ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                                        : (step.content as LeadArbitration).verdict === 'INCREMENTAL'
                                                            ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                                                            : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                                                    }`}>
                                                    FINAL DECISION: {(step.content as LeadArbitration).verdict}
                                                </span>
                                            </div>
                                            <div className="text-slate-300 text-[10px] leading-relaxed">
                                                {(step.content as LeadArbitration).reasoning}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};


// --- ARTIFACT PANEL (RIGHT SIDE) ---

type ArtifactMode =
    | { type: 'PLAN'; data: OrchestratorPlan }
    | { type: 'REPORT'; data: string; thinking?: string };

const ArtifactPanel: React.FC<{
    artifact: ArtifactMode | null;
    isThinking: boolean;
    onViewSource?: (data: SourceViewData) => void;
}> = ({ artifact, isThinking, onViewSource }) => {

    const [isLogicOpen, setIsLogicOpen] = useState(false);

    if (!artifact) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 bg-[#020617] border-l border-white/5 p-8">
                <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center border border-slate-800 mb-4">
                    <BrainCircuit className="w-8 h-8 opacity-20" />
                </div>
                <div className="text-center">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Awaiting Strategy</h3>
                    <p className="text-xs text-slate-600 mt-2 max-w-[200px]">Submit a query to generate a research plan.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-[#020617] border-l border-white/5 shadow-2xl overflow-hidden relative animate-in fade-in slide-in-from-right-4 duration-500">

            {/* Header matches screenshot */}
            <div className="p-6 pb-6 border-b border-white/5 bg-[#020617] z-10">
                <div className="flex items-center gap-3 mb-1">
                    <div className={`p-2 rounded-lg border text-white ${artifact.type === 'REPORT'
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-[#1e293b] border-slate-700 text-indigo-400'
                        }`}>
                        {artifact.type === 'REPORT' ? <FileText className="w-5 h-5" /> : <ListTodo className="w-5 h-5" />}
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight">
                            {artifact.type === 'REPORT' ? "Final Report" : "Research Strategy"}
                        </h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            {artifact.type === 'REPORT' ? (
                                <>
                                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Verified Output</span>
                                    <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Includes Synthesis Logic</span>
                                </>
                            ) : (
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                    {artifact.data.plan_type?.replace('_', ' ') || "DEEP ANALYSIS"}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {artifact.type === 'REPORT' && (
                    <button
                        onClick={() => exportReportToDocx(artifact.data)}
                        className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/50 rounded-lg transition-all text-xs font-bold uppercase tracking-widest"
                    >
                        <Download className="w-4 h-4" />
                        Export to DOCX
                    </button>
                )}
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">

                {/* --- PLAN VIEW --- */}
                {artifact.type === 'PLAN' && (
                    <div className="space-y-8">
                        {/* INTENT BOX */}
                        <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5">
                            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                LEAD RESEARCHER'S INTENT
                            </div>
                            <div className="text-sm text-slate-300 italic leading-relaxed mb-4">
                                "{artifact.data.thought_process}"
                            </div>
                            <div className="text-xs text-slate-100 font-medium">
                                {artifact.data.strategy_explanation}
                            </div>
                        </div>

                        {/* STEPS TIMELINE */}
                        <div className="relative pl-2">
                            <div className="absolute left-[7px] top-2 bottom-0 w-px bg-slate-800"></div>
                            <div className="space-y-8">
                                {artifact.data.steps.map((step, idx) => (
                                    <div key={idx} className="relative pl-8 group">
                                        <div className="absolute left-0 top-1.5 w-4 h-4 rounded-full border-2 border-slate-700 bg-[#020617] z-10 flex items-center justify-center">
                                            <div className="w-1.5 h-1.5 bg-slate-700 rounded-full"></div>
                                        </div>
                                        <div className="mb-3">
                                            <h4 className="text-sm font-bold text-white mb-1">{step.step_title}</h4>
                                            <p className="text-xs text-slate-500">{step.description}</p>
                                        </div>
                                        <div className="space-y-2">
                                            {step.tasks.map((task, tIdx) => (
                                                <div key={tIdx} className="bg-[#0f1623] border border-slate-800 p-3 rounded hover:border-emerald-500/30 transition-all flex flex-col gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <FileText className="w-3 h-3 text-emerald-500" />
                                                        <span className="text-[10px] font-bold text-emerald-500 font-mono uppercase truncate">{task.file_name}</span>
                                                    </div>
                                                    <div className="text-xs text-slate-300 leading-snug">
                                                        "{task.specific_question}"
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* --- REPORT VIEW --- */}
                {artifact.type === 'REPORT' && (
                    <div className="space-y-6">
                        {/* Synthesis Logic Toggle */}
                        {artifact.thinking && (
                            <div className="rounded-lg border border-slate-800 bg-[#0f1623] overflow-hidden">
                                <button
                                    onClick={() => setIsLogicOpen(!isLogicOpen)}
                                    className="w-full flex items-center justify-between p-3 hover:bg-slate-800/50 transition-colors"
                                >
                                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest">
                                        <BrainCircuit className="w-4 h-4" />
                                        View Synthesis Logic
                                    </div>
                                    {isLogicOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                                </button>
                                {isLogicOpen && (
                                    <div className="p-4 pt-0 border-t border-slate-800/50">
                                        <div className="mt-4 text-xs text-slate-400 font-mono leading-relaxed bg-black/20 p-3 rounded border border-white/5">
                                            {artifact.thinking}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Report Content */}
                        <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed">
                            <FormattedMessage text={artifact.data} onViewSource={onViewSource} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};


// --- MAIN CHAT COMPONENT ---

const Chat: React.FC<ChatProps> = ({ analysisResults, swarmReadyTimestamp, onViewSource, onAddFileClick }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [urlInput, setUrlInput] = useState('');
    const [urlList, setUrlList] = useState<string[]>([]);
    const [isUrlInputExpanded, setIsUrlInputExpanded] = useState(true);
    const [imageAttachments, setImageAttachments] = useState<File[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState('');
    const [activeArtifactIndex, setActiveArtifactIndex] = useState<number | null>(null);

    // Swarm State
    const [swarmPhase, setSwarmPhase] = useState<SwarmPhase>('IDLE');
    const [workingFileAgents, setWorkingFileAgents] = useState<string[]>([]); // Subset of agents actively working

    // Clarification state
    const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string[]>>({});
    const [customInputMap, setCustomInputMap] = useState<Record<string, string>>({});

    const [availableAgents, setAvailableAgents] = useState<string[]>([]);
    const [activeAgents, setActiveAgents] = useState<string[]>([]); // User selected agents

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const agents = getSwarmStatus();
        setAvailableAgents(agents);
        // Turn off web agents by default, but preserve their active state if they were turned on
        setActiveAgents(prev => {
            if (prev.length === 0) {
                return agents.filter(a => a !== 'Web Expert' && a !== 'URL Expert');
            }

            const hasWeb = prev.includes('Web Expert');
            const hasUrl = prev.includes('URL Expert');

            return agents.filter(a => {
                if (a === 'Web Expert') return hasWeb;
                if (a === 'URL Expert') return hasUrl;
                // Keep other file agents active by default
                return true;
            });
        });
    }, [analysisResults, swarmReadyTimestamp]);

    const toggleAgent = (agentName: string) => {
        if (activeAgents.includes(agentName)) {
            setActiveAgents(prev => prev.filter(a => a !== agentName));
        } else {
            setActiveAgents(prev => [...prev, agentName]);
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, loadingStatus]);

    // Determine what to show in the Right Panel (Strategy Plan OR Final Report)
    const activeArtifact = useMemo<ArtifactMode | null>(() => {
        // 1. Explicit Selection Override
        if (activeArtifactIndex !== null && messages[activeArtifactIndex]) {
            const msg = messages[activeArtifactIndex];

            // Case A: Report
            if (msg.role === 'model' && msg.text && !msg.clarification) {
                return { type: 'REPORT', data: msg.text, thinking: msg.thinking };
            }

            // Case B: Explicit Plan attached to message
            if (msg.plan) return { type: 'PLAN', data: msg.plan };

            // Case C: Plan inside collaboration steps
            if (msg.collaborationSteps) {
                const planStep = [...msg.collaborationSteps].reverse().find(s => s.type === 'ORCHESTRATOR');
                if (planStep) return { type: 'PLAN', data: planStep.content as OrchestratorPlan };
            }
        }

        // 2. Default "Latest" Logic (Fallback)
        // Iterate backwards to find the most recent state
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];

            // Priority: Active Plan during processing
            if (isProcessing) {
                if (msg.plan) return { type: 'PLAN', data: msg.plan };
                if (msg.collaborationSteps) {
                    const planStep = [...msg.collaborationSteps].reverse().find(s => s.type === 'ORCHESTRATOR');
                    if (planStep) return { type: 'PLAN', data: planStep.content as OrchestratorPlan };
                }
            }

            // Normal Priority: Report first, then Plan
            if (msg.role === 'model' && msg.text && !msg.clarification) {
                return { type: 'REPORT', data: msg.text, thinking: msg.thinking };
            }

            if (msg.plan) return { type: 'PLAN', data: msg.plan };

            if (msg.collaborationSteps) {
                const planStep = [...msg.collaborationSteps].reverse().find(s => s.type === 'ORCHESTRATOR');
                if (planStep) return { type: 'PLAN', data: planStep.content as OrchestratorPlan };
            }
        }
        return null;
    }, [messages, isProcessing, activeArtifactIndex]);

    const handleStop = () => {
        cancelRunningAgent();
        setIsProcessing(false);
        setSwarmPhase('IDLE');
        setWorkingFileAgents([]);
        setLoadingStatus('Stopped by user.');
        setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg.role === 'model' && !lastMsg.text && !lastMsg.plan && !lastMsg.clarification) {
                return prev.slice(0, -1);
            }
            return prev;
        });
    };

    const updateMessagePlan = (idx: number, plan: OrchestratorPlan) => {
        setMessages(prev => {
            const newMsgs = [...prev];
            if (newMsgs[idx]) {
                newMsgs[idx] = { ...newMsgs[idx], plan };
            }
            return newMsgs;
        });
    };

    const appendCollaborationStep = (idx: number, step: CollaborationStep) => {
        setMessages(prev => {
            const newMsgs = [...prev];
            if (newMsgs[idx]) {
                const existingSteps = newMsgs[idx].collaborationSteps || [];
                newMsgs[idx] = {
                    ...newMsgs[idx],
                    collaborationSteps: [...existingSteps, step]
                };
            }
            return newMsgs;
        });

        // Update Phase based on step type
        if (step.type === 'ORCHESTRATOR') setSwarmPhase('PLANNING');
        else if (step.type === 'ADVISOR' || step.type === 'BOARD_REVIEW') setSwarmPhase('REVIEW');
        else if (step.type === 'EXECUTION_LOG') {
            setSwarmPhase('EXECUTION');
            const log = step.content as ExecutionLog;
            setWorkingFileAgents(log.tasks.map(t => t.file_name));
        }
        else if (step.type === 'RESEARCH_EVALUATION') setSwarmPhase('SYNTHESIS');
    };

    // --- EXECUTION LOGIC (Simulated from original) ---
    const startResearchExecution = async (initialQuery: string, attachedImages: File[], currentHistory: ChatMessage[]) => {
        const placeholderIndex = currentHistory.length;
        setMessages(prev => [...prev, { role: 'model', collaborationSteps: [] }]);
        setIsUrlInputExpanded(false);

        // Switch view to the new research task immediately
        setActiveArtifactIndex(placeholderIndex);

        try {
            setLoadingStatus("Research Lead is evaluating strategy...");
            setSwarmPhase('PLANNING');

            // 1. Initial Plan
            const plan = await createCollaborativePlan(
                initialQuery,
                attachedImages,
                activeAgents,
                currentHistory,
                (status) => setLoadingStatus(status),
                (step) => appendCollaborationStep(placeholderIndex, step)
            );

            updateMessagePlan(placeholderIndex, plan);

            // 2. Pre-Execution Advisor Debate
            let finalExecutionPlan = plan;
            const allTasks = getAllTasks(plan);

            if (plan.plan_type === 'DEEP_ANALYSIS' && allTasks.length > 0) {
                setLoadingStatus("Committee Session: Consulting Reviewer...");
                setSwarmPhase('REVIEW');
                finalExecutionPlan = await refinePlanWithAdvisor(
                    initialQuery,
                    finalExecutionPlan,
                    activeAgents,
                    (status) => setLoadingStatus(status),
                    (step) => appendCollaborationStep(placeholderIndex, step)
                );
                updateMessagePlan(placeholderIndex, finalExecutionPlan);
            }

            // 3. Execution & Recursion
            await handleExecuteWithQualityControl(finalExecutionPlan, placeholderIndex, currentHistory, initialQuery);

        } catch (error: any) {
            if (error.message === 'USER_ABORTED') {
                setMessages(prev => {
                    const newMsgs = [...prev];
                    if (newMsgs[placeholderIndex]) {
                        newMsgs[placeholderIndex] = { ...newMsgs[placeholderIndex], text: "🛑 Execution stopped by user." };
                    }
                    return newMsgs;
                });
            } else {
                console.error(error);
                setMessages(prev => {
                    const clean = prev.slice(0, prev.length - 1);
                    return [...clean, { role: 'model', text: "Sorry, the Research Team encountered an error." }];
                });
            }
        } finally {
            setIsProcessing(false);
            setSwarmPhase('IDLE');
            setWorkingFileAgents([]);
            setLoadingStatus('');
        }
    };

    const handleExecuteWithQualityControl = async (initialPlan: OrchestratorPlan, msgIndex: number, historyContext: ChatMessage[], userQuery: string) => {
        let currentPlan = initialPlan;
        let attempt = 0;
        const MAX_RETRYS = 4;
        let accumulatedResults: { file: string, question: string, response: string }[] = [];
        let researchRound = 0;
        const MAX_RESEARCH_ROUNDS = 4; // Allow multiple rounds of fact finding

        const historyText = historyContext.slice(-10).map(msg => `${msg.role.toUpperCase()}: ${msg.text || ""}`).join('\n');

        while (true) {
            while (researchRound <= MAX_RESEARCH_ROUNDS) {
                setLoadingStatus(researchRound > 0 ? `Research Pivot (Round ${researchRound + 1}): Testing new angle...` : `Deploying Team (Round 1)...`);

                const tasks = getAllTasks(currentPlan);
                if (tasks.length > 0) {
                    appendCollaborationStep(msgIndex, { type: 'EXECUTION_LOG', round: researchRound + 1, content: { tasks: tasks }, timestamp: Date.now() });
                }

                const results = await executePlanTasks(currentPlan, (status) => setLoadingStatus(status));
                accumulatedResults = [...accumulatedResults, ...results];

                // NEW: Log the actual results from agents
                appendCollaborationStep(msgIndex, {
                    type: 'EXECUTION_RESULTS',
                    round: researchRound + 1,
                    content: { results: results },
                    timestamp: Date.now()
                });

                if (currentPlan.plan_type === 'DEEP_ANALYSIS' && researchRound < MAX_RESEARCH_ROUNDS) {
                    setLoadingStatus("Lead Researcher analyzing findings...");
                    setSwarmPhase('SYNTHESIS');
                    const evaluation = await evaluateResearchResults(userQuery, currentPlan, accumulatedResults, historyText);
                    appendCollaborationStep(msgIndex, { type: 'RESEARCH_EVALUATION', round: researchRound + 1, content: evaluation, timestamp: Date.now() });

                    if (evaluation.status === 'CONTINUE_RESEARCH' && evaluation.new_plan) {
                        currentPlan = evaluation.new_plan;
                        researchRound++;
                        // Add the new plan to the chat UI so the user sees the Lead Researcher's pivot
                        updateMessagePlan(msgIndex, currentPlan);
                        continue;
                    }
                }
                break;
            }

            setLoadingStatus("Synthesizing Final Report...");
            setSwarmPhase('SYNTHESIS');
            const { thinking, content } = await synthesizeReport(userQuery, currentPlan, historyText, accumulatedResults);

            let debateRound = 0;
            const MAX_DEBATE_ROUNDS = 2;
            let debateHistory: string[] = [];

            setLoadingStatus("Consultant reviewing final report...");
            setSwarmPhase('REVIEW');
            let consultantOpinion = await reviewOutputWithBoard(userQuery, content, currentPlan);
            appendCollaborationStep(msgIndex, { type: 'BOARD_REVIEW', round: attempt + 1, content: consultantOpinion, timestamp: Date.now() });

            let arbitration: LeadArbitration;

            // DEBATE LOOP
            while (true) {
                setLoadingStatus("Lead Researcher deciding next steps...");
                setSwarmPhase('REVIEW');
                arbitration = await arbitrateReviewBoardFeedback(userQuery, content, consultantOpinion, activeAgents, debateHistory, accumulatedResults);
                appendCollaborationStep(msgIndex, { type: 'LEAD_ARBITRATION', round: attempt + 1, content: arbitration, timestamp: Date.now() });

                if (arbitration.verdict === 'DEBATE') {
                    if (debateRound < MAX_DEBATE_ROUNDS) {
                        debateRound++;
                        debateHistory.push(arbitration.reasoning);

                        setLoadingStatus(`Consultant reviewing Lead's defense (Debate Round ${debateRound})...`);
                        setSwarmPhase('REVIEW');
                        consultantOpinion = await reviewOutputWithBoard(userQuery, content, currentPlan, debateHistory);
                        appendCollaborationStep(msgIndex, { type: 'BOARD_REVIEW', round: attempt + 1, content: consultantOpinion, timestamp: Date.now() });

                        continue; // Go back to Lead Researcher Arbitration
                    } else {
                        // Max debates reached, force an approval to break loop
                        const forcedArbitration: LeadArbitration = {
                            verdict: 'APPROVED',
                            reasoning: "[SYSTEM] Debate limit reached. Overriding Consultant to proceed with the current report to prevent infinite argument."
                        };
                        arbitration = forcedArbitration;
                        appendCollaborationStep(msgIndex, { type: 'LEAD_ARBITRATION', round: attempt + 1, content: forcedArbitration, timestamp: Date.now() });
                        break;
                    }
                }
                break; // Break if APPROVED, REJECTED, INCREMENTAL, or NEEDS_CLARIFICATION
            }

            // --- INCREMENTAL: Targeted follow-up without full restart ---
            if (arbitration.verdict === 'INCREMENTAL' && attempt < MAX_RETRYS && arbitration.remediation_plan) {
                setLoadingStatus("Lead Researcher: Running targeted follow-up (Incremental)...");
                const incrementalPlan = arbitration.remediation_plan;

                const incrementalTasks = getAllTasks(incrementalPlan);
                if (incrementalTasks.length > 0) {
                    appendCollaborationStep(msgIndex, { type: 'EXECUTION_LOG', round: attempt + 10, content: { tasks: incrementalTasks }, timestamp: Date.now() });
                    const newResults = await executePlanTasks(incrementalPlan, (status) => setLoadingStatus(status));
                    accumulatedResults = [...accumulatedResults, ...newResults];
                    appendCollaborationStep(msgIndex, { type: 'EXECUTION_RESULTS', round: attempt + 10, content: { results: newResults }, timestamp: Date.now() });
                }

                // Re-synthesize with ALL accumulated results (old + new)
                setLoadingStatus("Re-synthesizing report with new findings...");
                setSwarmPhase('SYNTHESIS');
                const { thinking: newThinking, content: newContent } = await synthesizeReport(userQuery, currentPlan, historyText, accumulatedResults);

                // Loop back to consultant review with the improved report
                setLoadingStatus("Consultant reviewing updated report...");
                setSwarmPhase('REVIEW');
                consultantOpinion = await reviewOutputWithBoard(userQuery, newContent, currentPlan);
                appendCollaborationStep(msgIndex, { type: 'BOARD_REVIEW', round: attempt + 2, content: consultantOpinion, timestamp: Date.now() });

                // Reset debate state for next arbitration round
                debateRound = 0;
                debateHistory = [];
                attempt++;

                // Re-run arbitration on the new content
                setLoadingStatus("Lead Researcher evaluating updated report...");
                arbitration = await arbitrateReviewBoardFeedback(userQuery, newContent, consultantOpinion, activeAgents, debateHistory, accumulatedResults);
                appendCollaborationStep(msgIndex, { type: 'LEAD_ARBITRATION', round: attempt + 1, content: arbitration, timestamp: Date.now() });

                if (arbitration.verdict === 'APPROVED' || arbitration.verdict === 'NEEDS_CLARIFICATION' || attempt >= MAX_RETRYS) {
                    // Finalize with the new content
                    if (arbitration.verdict === 'NEEDS_CLARIFICATION') {
                        const clarificationMsg = arbitration.clarification_message || "I need more information or specific expert agents to complete this request.";
                        setMessages(prev => {
                            const newMsgs = [...prev];
                            if (newMsgs[msgIndex]) {
                                newMsgs[msgIndex] = { ...newMsgs[msgIndex], text: `**Lead Researcher needs help:**\n\n${clarificationMsg}`, thinking: newThinking };
                            }
                            return newMsgs;
                        });
                        break;
                    }
                    setMessages(prev => {
                        const newMsgs = [...prev];
                        if (newMsgs[msgIndex]) {
                            newMsgs[msgIndex] = { ...newMsgs[msgIndex], text: newContent, thinking: newThinking };
                        }
                        return newMsgs;
                    });
                    break;
                }
                // If still INCREMENTAL or REJECTED, let the outer while(true) loop handle it
                continue;
            }

            // --- REJECTED: Full restart (last resort) ---
            if (arbitration.verdict === 'REJECTED' && attempt < MAX_RETRYS && arbitration.remediation_plan) {
                setLoadingStatus("Lead Researcher decided to Re-research (Full Restart). Re-calibrating...");
                let newPlan = arbitration.remediation_plan;

                const allTasks = getAllTasks(newPlan);
                if (allTasks.length > 0) {
                    setLoadingStatus("Committee Session: Reviewing Remediation Plan...");
                    newPlan = await refinePlanWithAdvisor(userQuery, newPlan, activeAgents, (status) => setLoadingStatus(status), (step) => appendCollaborationStep(msgIndex, step));
                }
                currentPlan = newPlan;
                // DO NOT clear accumulatedResults here; we want to retain the old facts too!
                researchRound = 0;
                updateMessagePlan(msgIndex, newPlan);
                attempt++;
                continue;
            }

            if (arbitration.verdict === 'NEEDS_CLARIFICATION') {
                const clarificationMsg = arbitration.clarification_message || "I need more information or specific expert agents to complete this request.";
                setMessages(prev => {
                    const newMsgs = [...prev];
                    if (newMsgs[msgIndex]) {
                        // Attach final partial content if any, alongside the block message
                        newMsgs[msgIndex] = { ...newMsgs[msgIndex], text: `**Lead Researcher needs help:**\n\n${clarificationMsg}`, thinking: thinking };
                    }
                    return newMsgs;
                });
                break; // Exit the loop completely
            }

            setMessages(prev => {
                const newMsgs = [...prev];
                if (newMsgs[msgIndex]) {
                    newMsgs[msgIndex] = { ...newMsgs[msgIndex], text: content, thinking: thinking };
                }
                return newMsgs;
            });
            break;
        }
    };

    // --- CLARIFICATION HANDLING ---
    const submitClarificationAnswers = async (clarification: ClarificationRequest) => {
        const answers: string[] = [];
        clarification.questions.forEach(q => {
            const selectedOptions = clarificationAnswers[q.id] || [];
            if (selectedOptions.length > 0) {
                const finalAnswers = selectedOptions.map(sel => {
                    const opt = q.options.find(o => o.id === sel);
                    if (opt?.isCustomInput) {
                        return customInputMap[q.id] || "Custom Input";
                    }
                    return opt?.text || sel;
                });
                answers.push(`Question: "${q.text}"\nAnswer: ${finalAnswers.join(', ')}`);
            }
        });

        if (answers.length === 0) return;

        const clarificationContext = answers.join('\n\n');
        const originalMsg = messages[messages.length - 2];
        const fullQuery = `${originalMsg.text}\n\n[User Clarification Context]:\n${clarificationContext}`;

        setMessages(prev => {
            const newHistory = prev.slice(0, prev.length - 1);
            newHistory[newHistory.length - 1] = { ...newHistory[newHistory.length - 1], text: fullQuery };
            return newHistory;
        });

        const updatedHistory = messages.slice(0, messages.length - 1);
        updatedHistory[updatedHistory.length - 1] = { ...updatedHistory[updatedHistory.length - 1], text: fullQuery };

        await startResearchExecution(fullQuery, originalMsg.images || [], updatedHistory);
    };

    const handleSendMessage = async () => {
        let userMsg = input.trim();
        const activeUrls = urlInput.trim() ? [...urlList, urlInput.trim()] : urlList;

        if ((!userMsg && imageAttachments.length === 0 && activeUrls.length === 0) || isProcessing) return;

        // Safety check: if no agents selected, warn user
        if (activeAgents.length === 0) {
            setMessages(prev => [...prev, { role: 'model', text: "⚠️ Please select at least one expert from the Team Network to continue." }]);
            return;
        }

        if (activeAgents.includes('URL Expert') && activeUrls.length > 0) {
            userMsg = `[Target URLs:\n${activeUrls.map(u => `- ${u}`).join('\n')}]\n\n${userMsg || "Please pull the precise facts, figures, and insights from these URLs. No filler."}`;
        }

        const attachedImagesToSent = [...imageAttachments];
        setInput('');
        setUrlInput('');
        setUrlList([]);
        setImageAttachments([]);
        setIsProcessing(true);
        setIsUrlInputExpanded(false);
        setSwarmPhase('INTENT');

        // User message logic
        const newHistory = [...messages, { role: 'user', text: userMsg, images: attachedImagesToSent } as ChatMessage];
        setMessages(newHistory);

        // Auto-reset selection so we default to following the new generation
        setActiveArtifactIndex(null);

        try {
            setLoadingStatus("Analyzing intent...");
            const intent = await classifyUserIntent(userMsg, attachedImagesToSent, activeAgents);

            if (intent.type === 'QUICK_ANSWER') {
                setLoadingStatus("Quick Retrieval Mode...");
                setSwarmPhase('EXECUTION');
                setWorkingFileAgents(activeAgents);
                const response = await executeQuickAnswer(userMsg, attachedImagesToSent, activeAgents, newHistory, (s) => setLoadingStatus(s));
                setMessages(prev => [...prev, { role: 'model', text: response.text }]);
                setIsProcessing(false);
                setSwarmPhase('IDLE');
                setWorkingFileAgents([]);
                setLoadingStatus('');
                // When quick answer returns, we want to auto-select it if possible, or let useMemo default to it.
                // Default logic will pick up the new text message.
                return;
            }

            setLoadingStatus("Checking for ambiguity...");
            const clarification = await generateClarificationQuestions(userMsg, attachedImagesToSent, activeAgents);

            if (clarification.requires_clarification) {
                setMessages(prev => {
                    return [...prev, { role: 'model', clarification: clarification }];
                });
                setIsProcessing(false);
                setSwarmPhase('IDLE');
                setLoadingStatus('');
                return;
            }

            await startResearchExecution(userMsg, attachedImagesToSent, newHistory);

        } catch (e) {
            console.error(e);
            setIsProcessing(false);
            setSwarmPhase('IDLE');
            setLoadingStatus('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData.items;
        const imagesToAttach: File[] = [];

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) {
                    imagesToAttach.push(blob);
                }
            }
        }

        if (imagesToAttach.length > 0) {
            setImageAttachments(prev => [...prev, ...imagesToAttach]);
        }
    };

    const removeAttachment = (indexToRemove: number) => {
        setImageAttachments(prev => prev.filter((_, idx) => idx !== indexToRemove));
    };

    return (
        <div className="flex flex-col h-full bg-[#050b14] border border-white/5 overflow-hidden">

            {/* LEFT COLUMN: HEADER (Chat) */}
            <div className="bg-[#050b14] border-b border-white/5 p-4 flex items-center justify-between lg:hidden">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="font-bold text-white text-sm">Team Chat</span>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20">{availableAgents.length} Experts</span>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-row overflow-hidden">

                {/* LEFT SIDEBAR: TEAM NETWORK */}
                <TeamNetwork
                    agents={availableAgents}
                    activeAgents={activeAgents}
                    onToggle={toggleAgent}
                    phase={swarmPhase}
                    workingAgents={workingFileAgents}
                    onAddFileClick={onAddFileClick}
                />

                {/* CENTER COLUMN: CHAT STREAM */}
                <div className="flex-1 flex flex-col min-w-0 bg-[#050b14] relative border-r border-white/5">



                    <div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth custom-scrollbar" ref={scrollContainerRef}>
                        {messages.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full opacity-20 gap-6">
                                <Bot className="w-20 h-20 text-slate-400" />
                                <div className="text-center space-y-2">
                                    <h2 className="text-xl font-bold text-white mb-2 tracking-tight">Research Team Ready</h2>
                                    <p className="text-slate-400 max-w-sm leading-relaxed text-sm">
                                        Ask a question or provide instructions. Your team will strategize, coordinate, and deliver a researched answer.
                                    </p>
                                </div>
                            </div>)}

                        {messages.map((msg, idx) => (
                            <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>

                                {/* Avatar */}
                                {msg.role === 'model' && (
                                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                        <Bot className="w-5 h-5" />
                                    </div>
                                )}

                                <div className={`flex flex-col max-w-[90%] lg:max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>

                                    {/* COLLABORATION LOGS (SWARM ACTIVITY) */}
                                    {msg.collaborationSteps && msg.collaborationSteps.length > 0 && (
                                        <div className="w-full mb-4">
                                            <CollaborationLog steps={msg.collaborationSteps} />
                                        </div>
                                    )}

                                    {/* MAIN MESSAGE BUBBLE */}
                                    {(msg.text || msg.thinking) && (
                                        <div className={`relative ${msg.role === 'user'
                                            ? 'bg-[#1e293b] text-slate-100 rounded-2xl rounded-tr-sm px-5 py-3 border border-slate-700'
                                            : 'w-full'
                                            }`}>
                                            {msg.role === 'model' ? (
                                                // RESULT CARD STYLE FOR MODEL RESPONSE
                                                // If report is on the right, we just show a summary card here
                                                <div
                                                    onClick={() => setActiveArtifactIndex(idx)}
                                                    className={`bg-[#0b1221] border rounded-lg overflow-hidden shadow-2xl p-4 flex items-center justify-between cursor-pointer transition-colors group ${activeArtifactIndex === idx ? 'border-emerald-500 bg-slate-900' : 'border-emerald-500/20 hover:bg-slate-900/50'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                                        <div className="p-2 bg-emerald-500/10 rounded-lg group-hover:bg-emerald-500/20 transition-colors shrink-0">
                                                            <FileText className="w-5 h-5 text-emerald-400" />
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-emerald-400 font-bold text-xs uppercase tracking-wider mb-0.5 whitespace-normal leading-relaxed pr-2">
                                                                {getReportTitle(msg.text)}
                                                            </div>
                                                            <div className="text-[10px] text-slate-500 font-mono">
                                                                {msg.text.length} characters
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-[10px] text-slate-500 flex items-center gap-1 group-hover:text-emerald-400 transition-colors shrink-0 ml-4">
                                                        View <ArrowRight className="w-3 h-3" />
                                                    </div>
                                                </div>
                                            ) : (
                                                // USER MESSAGE
                                                <div className="text-sm font-medium">
                                                    {msg.images && msg.images.length > 0 && (
                                                        <div className="flex flex-wrap gap-2 mb-3">
                                                            {msg.images.map((img, i) => (
                                                                <img
                                                                    key={i}
                                                                    src={URL.createObjectURL(img)}
                                                                    alt="Attached"
                                                                    className="h-20 w-auto rounded border border-slate-600 object-cover"
                                                                />
                                                            ))}
                                                        </div>
                                                    )}
                                                    {msg.text}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* CLARIFICATION UI */}
                                    {msg.clarification && (
                                        <div className="w-full max-w-xl bg-[#0b1221] border border-emerald-500/20 rounded-lg p-6 mt-4 shadow-2xl">
                                            <div className="flex items-center gap-2 mb-4">
                                                <Sparkles className="w-4 h-4 text-emerald-400" />
                                                <span className="text-emerald-400 font-bold text-xs uppercase tracking-wider">NEEDED INPUT</span>
                                            </div>
                                            <div className="text-xs text-slate-500 mb-6 italic">
                                                Clarification provided.
                                            </div>

                                            <div className="space-y-6 pl-4 border-l border-slate-800">
                                                {msg.clarification.questions.map(q => (
                                                    <div key={q.id}>
                                                        <p className="text-sm text-slate-200 font-medium mb-3 leading-snug">{q.text}</p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {q.options.map(opt => {
                                                                const isSelected = clarificationAnswers[q.id]?.includes(opt.id);
                                                                return (
                                                                    <button
                                                                        key={opt.id}
                                                                        onClick={() => {
                                                                            setClarificationAnswers(prev => {
                                                                                const current = prev[q.id] || [];
                                                                                if (q.multiple_choice) {
                                                                                    return { ...prev, [q.id]: isSelected ? current.filter(x => x !== opt.id) : [...current, opt.id] };
                                                                                } else {
                                                                                    return { ...prev, [q.id]: [opt.id] }; // Single choice
                                                                                }
                                                                            });
                                                                        }}
                                                                        className={`px-3 py-1.5 rounded text-xs transition-all border ${isSelected
                                                                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                                                                            : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-200'
                                                                            }`}
                                                                    >
                                                                        {opt.text}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        {/* Custom Input Field if last option selected and isCustom */}
                                                        {q.options.some(o => o.isCustomInput && clarificationAnswers[q.id]?.includes(o.id)) && (
                                                            <input
                                                                type="text"
                                                                placeholder="Type specific context..."
                                                                className="mt-3 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
                                                                onChange={(e) => setCustomInputMap(prev => ({ ...prev, [q.id]: e.target.value }))}
                                                            />
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="mt-8 flex justify-end">
                                                <button
                                                    onClick={() => submitClarificationAnswers(msg.clarification!)}
                                                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wide rounded transition-all flex items-center gap-2"
                                                >
                                                    <span>Continue Research</span>
                                                    <ArrowRight className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="p-6 bg-[#050b14] border-t border-white/5 relative z-20">
                        {(loadingStatus || isProcessing) && (
                            <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-emerald-400 text-xs px-4 py-1.5 rounded-full border border-slate-700 shadow-xl flex items-center gap-2 animate-in slide-in-from-bottom-2 fade-in whitespace-nowrap z-30">
                                <RefreshCcw className="w-3 h-3 animate-spin" />
                                {loadingStatus || 'Processing...'}
                            </div>
                        )}

                        <div className="relative max-w-4xl mx-auto flex flex-col gap-3">
                            {/* URL Expert Input Row */}
                            {activeAgents.includes('URL Expert') && (
                                <div className="flex flex-col gap-2 p-3 bg-[#0b1221] border border-blue-500/30 rounded-xl shadow-inner mb-1 animate-in zoom-in-95 duration-200">
                                    <div
                                        className="flex items-center justify-between cursor-pointer group"
                                        onClick={() => setIsUrlInputExpanded(!isUrlInputExpanded)}
                                    >
                                        <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 ml-1">
                                            <Globe className="w-3.5 h-3.5" />
                                            URL Links Attachment
                                            {urlList.length > 0 && !isUrlInputExpanded && <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[9px]">{urlList.length}</span>}
                                        </div>
                                        {isUrlInputExpanded ? <ChevronUp className="w-4 h-4 text-blue-400 opacity-50 group-hover:opacity-100 transition-opacity" /> : <ChevronDown className="w-4 h-4 text-blue-400 opacity-50 group-hover:opacity-100 transition-opacity" />}
                                    </div>
                                    <div className={`flex flex-col gap-2 transition-all ${isUrlInputExpanded ? '' : 'hidden'}`}>
                                        {urlList.length > 0 && (
                                            <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto custom-scrollbar">
                                                {urlList.map((u, i) => (
                                                    <div key={i} className="flex items-center gap-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2 py-1 rounded-md text-[11px] shadow-sm">
                                                        <span className="truncate max-w-[300px]">{u}</span>
                                                        <button onClick={() => setUrlList(urlList.filter((_, idx) => idx !== i))} className="hover:text-amber-400 transition-colors ml-1">
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="relative w-full">
                                            <input
                                                type="url"
                                                placeholder="Paste a URL here and press Enter..."
                                                value={urlInput}
                                                onChange={(e) => setUrlInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        if (urlInput.trim()) {
                                                            setUrlList([...urlList, urlInput.trim()]);
                                                            setUrlInput('');
                                                        }
                                                    }
                                                }}
                                                className="w-full bg-[#161b2c] border border-blue-500/30 rounded-lg pl-3 pr-10 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/60 transition-colors"
                                            />
                                            <button
                                                onClick={() => {
                                                    if (urlInput.trim()) {
                                                        setUrlList([...urlList, urlInput.trim()]);
                                                        setUrlInput('');
                                                    }
                                                }}
                                                disabled={!urlInput.trim()}
                                                className="absolute right-1.5 top-1 bottom-1 px-1.5 bg-blue-500/10 text-blue-400 rounded-md hover:bg-blue-500 hover:text-white transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed border border-transparent hover:border-blue-500"
                                                title="Add URL"
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Image Preview Area Row */}
                            {imageAttachments.length > 0 && (
                                <div className="flex gap-3 mb-3 p-3 bg-[#0b1221] border border-slate-800 rounded-xl overflow-x-auto custom-scrollbar">
                                    {imageAttachments.map((file, i) => (
                                        <div key={i} className="relative group shrink-0">
                                            <img
                                                src={URL.createObjectURL(file)}
                                                alt="Attachment preview"
                                                className="h-16 w-auto object-cover rounded border border-slate-700 shadow-sm"
                                            />
                                            <button
                                                onClick={() => removeAttachment(i)}
                                                className="absolute -top-2 -right-2 bg-slate-800 hover:bg-rose-500 text-slate-300 hover:text-white rounded-full p-1 shadow-md transition-colors"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="relative">
                                <textarea
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    onPaste={handlePaste}
                                    placeholder={activeAgents.length > 0 ? "Ask a question" : "Select a file to begin..."}
                                    className="w-full bg-[#0b1221] text-slate-200 placeholder-slate-600 rounded-xl pl-5 pr-14 py-4 border border-slate-800 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 outline-none resize-none h-14 transition-all shadow-inner text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={isProcessing || availableAgents.length === 0}
                                />
                                <div className="absolute right-2 top-2">
                                    {(loadingStatus || isProcessing) ? (
                                        <button
                                            onClick={handleStop}
                                            className="p-2.5 bg-rose-500 text-white rounded-lg hover:bg-rose-400 transition-all shadow-lg"
                                            title="Stop Generation"
                                        >
                                            <StopCircle className="w-5 h-5" />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleSendMessage}
                                            disabled={(!input.trim() && imageAttachments.length === 0) || activeAgents.length === 0}
                                            className="p-2.5 bg-[#1e293b] text-emerald-500 rounded-lg hover:bg-emerald-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all border border-slate-700 hover:border-emerald-500"
                                        >
                                            <ArrowRight className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Web Reminder UI Hint */}
                            {!activeAgents.includes('Web Expert') && (
                                <div className="text-center mt-2 animate-in fade-in">
                                    <span className="text-[10px] text-slate-500 inline-block">
                                        <Globe className="w-3 h-3 text-blue-500/60 inline-flex mr-1 align-text-bottom" />
                                        Need live internet data? Toggle the{' '}
                                        <button
                                            onClick={() => toggleAgent('Web Expert')}
                                            className="text-blue-400 hover:text-blue-300 font-medium underline decoration-blue-500/30 underline-offset-2 transition-colors focus:outline-none inline-flex"
                                        >
                                            Web Expert
                                        </button>
                                        {' '}in the Team Network.
                                    </span>
                                </div>
                            )}

                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: ARTIFACTS (Research Strategy) */}
                <div className="hidden lg:block w-[60%] min-w-[400px]">
                    <ArtifactPanel
                        artifact={activeArtifact}
                        isThinking={isProcessing}
                        onViewSource={onViewSource}
                    />
                </div>
            </div>
        </div>
    );
};

export default Chat;
