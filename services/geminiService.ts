
import { Type, Schema, Chat } from "@google/genai";
import { AnalysisResult, OrchestratorPlan, ChatMessage, CollaborationStep, AdvisorReview, OutputQualityVerdict, ClarificationRequest, ResearchEvaluation, IntentClassification, LeadArbitration } from "../types";
import { ai } from "./proxyClient";

// --- ABORT CONTROLLER LOGIC ---
let activeController: AbortController | null = null;

export const cancelRunningAgent = () => {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
};

const initController = () => {
  cancelRunningAgent();
  activeController = new AbortController();
};

const checkAbort = () => {
  if (activeController?.signal.aborted) {
    throw new Error("USER_ABORTED");
  }
};

// Helper to convert File to Base64
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Data = (reader.result as string).split(',')[1];
      resolve({
        inlineData: {
          data: base64Data,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Robustly balances a truncated JSON string.
 */
function balanceJSON(jsonString: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  let processedString = jsonString.trim();

  for (let i = 0; i < processedString.length; i++) {
    const char = processedString[i];

    if (inString) {
      if (char === '\\') escaped = !escaped;
      else if (char === '"' && !escaped) inString = false;
      else escaped = false;
    } else {
      if (char === '"') inString = true;
      else if (char === '{') stack.push('}');
      else if (char === '[') stack.push(']');
      else if (char === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '}') stack.pop();
      }
      else if (char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === ']') stack.pop();
      }
    }
  }

  if (inString) processedString += '"';
  while (stack.length > 0) {
    processedString += stack.pop();
  }

  return processedString;
}

/**
 * Tries multiple strategies to parse a potentially dirty or markdown-wrapped JSON string.
 */
function cleanAndParseJSON(text: string): any {
  if (!text) throw new Error("Empty response text");

  // Strategy 1: Direct Parse
  try {
    return JSON.parse(text);
  } catch (e) {
    // continue
  }

  // Strategy 2: Remove Markdown Code Blocks
  let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // continue
  }

  // Strategy 3: Extract JSON object substring
  const firstOpen = cleaned.indexOf('{');
  const lastClose = cleaned.lastIndexOf('}');
  if (firstOpen !== -1 && lastClose !== -1) {
    const substring = cleaned.substring(firstOpen, lastClose + 1);
    try {
      return JSON.parse(substring);
    } catch (e) {
      // continue
    }
  }

  // Strategy 4: Balance the cleaned string (for truncation)
  try {
    const balanced = balanceJSON(cleaned);
    return JSON.parse(balanced);
  } catch (e) {
    // continue
  }

  throw new Error("Unable to parse JSON structure from response.");
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- ROBUST API WRAPPER FOR 429 HANDLING ---
async function callGeminiWithRetry<T>(
  apiCall: (abortSignal?: AbortSignal) => Promise<T>,
  retries = 3,
  baseDelay = 2000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    checkAbort();
    try {
      return await apiCall(activeController?.signal);
    } catch (error: any) {
      if (activeController?.signal?.aborted || error.message === 'USER_ABORTED' || error.name === 'AbortError') {
        throw new Error('USER_ABORTED');
      }

      const status = error.status || error.response?.status;
      const msg = error.message || '';
      const isRateLimit = status === 429 || msg.includes('429') || msg.includes('quota');
      const isOverloaded = status === 503 || msg.includes('503') || msg.includes('overloaded');

      if ((isRateLimit || isOverloaded) && i < retries - 1) {
        const delay = baseDelay * Math.pow(2, i) + (Math.random() * 1000);
        console.warn(`Gemini API busy/limited (Attempt ${i + 1}/${retries}). Waiting ${Math.round(delay)}ms...`);
        await wait(delay);
        continue;
      }

      throw error;
    }
  }
  throw new Error("API call failed after max retries");
}

// AI client is now imported from proxyClient.ts — routes through secure proxy in production

// --- 1. DASHBOARD PARSER (Structure Extraction) ---

const ANALYSIS_SYSTEM_INSTRUCTION = `
You are a Lead Researcher. 
Your goal is to extract the TITLE, TYPE, SUMMARY, TOPICS and 4-6 KEY INSIGHTS from the document.

CRITICAL RULES:
- **SPEED**: Focus on high-level understanding.
- **GROUNDING**: Every key insight must have a \`citation_quote\` and \`context_block\` (surrounding paragraph) from the PDF.
- **Summary**: 2-3 sentences describing the core purpose of the document.
`;

const analysisSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    doc_title: { type: Type.STRING, description: "Official title of the document or main subject" },
    doc_type: { type: Type.STRING, description: "e.g. 'Scientific Paper', 'Financial Report', 'Legal Contract', 'Slide Deck'" },
    summary: { type: Type.STRING, description: "Concise summary of content." },
    topics: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of 3-5 main topics/tags" },
    key_insights: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Short label for this insight (e.g. 'Revenue Growth', 'Key Hypothesis', 'Deadline')" },
          description: { type: Type.STRING, description: "The actual fact, number, or finding." },
          citation_quote: { type: Type.STRING, description: "Exact short phrase from doc." },
          context_block: { type: Type.STRING, description: "Extended text surrounding the quote." },
          page_reference: { type: Type.STRING },
          category: { type: Type.STRING, description: "e.g. 'Stat', 'Person', 'Date', 'Concept'" }
        },
        required: ["title", "description", "citation_quote", "context_block"]
      },
      description: "4-6 most important findings or facts."
    }
  },
  required: ["doc_title", "doc_type", "key_insights", "summary", "topics"]
};

const analyzeSingleReport = async (file: File): Promise<AnalysisResult> => {
  try {
    checkAbort();
    const filePart = await fileToGenerativePart(file);

    // Use the wrapper
    const response = await callGeminiWithRetry(async (abortSignal) => {
      return await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          role: "user",
          parts: [
            filePart,
            { text: "Analyze this document. Extract title, type, summary, and key insights." }
          ]
        },
        config: {
          systemInstruction: ANALYSIS_SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: analysisSchema,
          temperature: 0.1,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 2048 },
          abortSignal
        }
      });
    }, 5, 3000);

    if (!response || !response.text) throw new Error("No response");

    let result: any;
    try {
      result = cleanAndParseJSON(response.text);
    } catch (parseError) {
      throw new Error("Failed to parse AI response.");
    }

    return {
      source_file: file.name,
      doc_title: result.doc_title || "Untitled Document",
      doc_type: result.doc_type || "Document",
      summary: result.summary || "No summary available.",
      key_insights: Array.isArray(result.key_insights) ? result.key_insights : [],
      topics: Array.isArray(result.topics) ? result.topics : []
    };

  } catch (error: any) {
    if (error.message === "USER_ABORTED") throw error;
    console.error(`Analysis failed for ${file.name}:`, error);
    return {
      source_file: file.name,
      doc_title: "Analysis Failed",
      doc_type: "Error",
      summary: `Could not analyze file: ${error.message || 'Unknown error'}`,
      key_insights: [],
      topics: []
    };
  }
};

export const analyzeFinancialReport = async (
  files: File[],
  onProgress?: (idx: number, total: number, message: string) => void
): Promise<AnalysisResult[]> => {
  initController();
  const results: AnalysisResult[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    checkAbort();
    if (onProgress) onProgress(i, files.length, `Analyzing structure: ${file.name}...`);
    const result = await analyzeSingleReport(file);
    results.push(result);
  }
  return results;
};


// --- 2. EXPERT PANEL SYSTEM (Multi-Session Chat) ---

interface AgentSession {
  fileName: string;
  chat: Chat;
  isReady: boolean;
}

let agentSwarm: Map<string, AgentSession> = new Map();

export const initializeAgentSwarm = async (
  files: File[],
  onProgress?: (idx: number, total: number, status: string) => void,
  urls: string[] = []
) => {
  initController();

  // Initialize Web Expert (if not exists)
  if (!agentSwarm.has("Web Expert")) {
    const webChat = ai.chats.create({
      model: "gemini-3.1-pro-preview",
      config: {
        temperature: 0.1, // Lower temperature for more grounded facts
        tools: [{ googleSearch: {} }],
        systemInstruction: `You are a Deep Web Research Agent. 
        YOUR JOB: Search the web for comprehensive and accurate information to answer the user's queries.
        
        CRITICAL RULES FOR GROUND TRUTH & TRACEABILITY:
        1. **ZERO HALLUCINATION**: If you cannot find the answer using Google Search, you MUST state "Information not found based on current available sources." Do not guess.
        2. **STRICT CITATION FORMAT**: Every single claim, fact, or number MUST include the exact source URL. Use this EXACT tag format:
           <claim source="URL" quote="exact text match">fact</claim>
           Example: <claim source="https://en.wikipedia.org/wiki/Apple_Inc." quote="founded on April 1, 1976">Apple was founded on April 1, 1976</claim>
        3. **EXACT URL RULE**: You MUST return the deepest, most exact URL path where you found the information. NEVER return just the generic root domain (e.g., do not use "https://example.com" if the fact was on "https://example.com/deep/page"). Your source attribute MUST be the fully qualified, specific URL.
        4. **URL VERIFICATION**: Ensure the URL cited actually exists and points directly to the information provided.
        5. Focus exclusively on providing accurate, verifiable intelligence.`
      }
    });
    agentSwarm.set("Web Expert", {
      fileName: "Web Expert",
      chat: webChat,
      isReady: true
    });
  }

  // Initialize URL Expert (if not exists)
  if (!agentSwarm.has("URL Expert")) {
    const urlContext = urls.length > 0 ? `The following URLs have been provided for your analysis: \n${urls.join('\n')}\n` : '';

    const urlChat = ai.chats.create({
      model: "gemini-3.1-pro-preview",
      config: {
        temperature: 0.1,
        tools: [{ googleSearch: {} }],
        systemInstruction: `You are a URL Expert. 
        YOUR GOAL: You are ONLY activated when the user provides specific URLs.
        ${urlContext}
        Your job is to deep dive into those specific URLs to extract key information, metrics, and insights.
        Do NOT search the broader web unless explicitly asked to verify the URL's content.
        
        CRITICAL RULES FOR GROUND TRUTH & TRACEABILITY:
        1. **ZERO HALLUCINATION**: Only report facts found directly on the provided URLs or through verification search.
        2. **STRICT CITATION FORMAT**: Every single claim, fact, or number MUST include the source URL. Use this EXACT tag format:
           <claim source="URL" quote="exact text match">fact</claim>
           Example: <claim source="https://example.com" quote="Q4 Revenue was $5M">Q4 Revenue was $5M</claim>
        `
      }
    });
    agentSwarm.set("URL Expert", {
      fileName: "URL Expert",
      chat: urlChat,
      isReady: true
    });
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    checkAbort();
    if (onProgress) onProgress(i, files.length, `Briefing Document Expert for ${file.name}...`);

    const filePart = await fileToGenerativePart(file);

    const chat = ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 24576 },
        systemInstruction: `
          You are a specialized Document Expert dedicated ONLY to the file: "${file.name}".
          YOUR JOB: Answer questions strictly based on the provided document.
          
          CITATION & TRACEABILITY RULES:
          1. **Exact Traceability**: Every single claim, number, or fact must have a citation.
          2. **Numeric Precision**: When citing numbers, you MUST include the "Fiscal Year" or "Period" if available in the context.
          3. **Citation Format**: Use this EXACT tag format:
             [[Page: X | Quote: "exact text match"]]
             
          Example: "Amazon Revenue was $611.3B in FY2024 [[Page: 45 | Quote: 'Net sales... $611.3 billion']]"
          
          If the information is not in the document, state "Not found in document".
        `
      }
    });

    try {
      checkAbort();
      await callGeminiWithRetry(async (abortSignal) => {
        await chat.sendMessage({
          message: [
            filePart,
            { text: "Confirm you have reviewed the document and are ready." }
          ],
          config: { abortSignal }
        });
      }, 3, 3000);

      agentSwarm.set(file.name, {
        fileName: file.name,
        chat: chat,
        isReady: true
      });
    } catch (e) {
      if ((e as Error).message === "USER_ABORTED") throw e;
      console.error(`Failed to init expert for ${file.name}`, e);
      alert(`Failed to load ${file.name}. Please check your API key and connection. Error: ${(e as Error).message}`);
    }
  }

  if (onProgress) onProgress(files.length, files.length, "Research Team Ready.");
};

export const getSwarmStatus = () => {
  return Array.from(agentSwarm.keys());
};

export const removeAgent = (fileName: string) => {
  agentSwarm.delete(fileName);
};


// --- INTENT CLASSIFICATION SYSTEM ---

const intentSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING, enum: ["DEEP_RESEARCH", "QUICK_ANSWER"] },
    reasoning: { type: Type.STRING }
  },
  required: ["type", "reasoning"]
};

export const classifyUserIntent = async (
  userMessage: string,
  attachedImages: File[] = [],
  activeFiles: string[]
): Promise<IntentClassification> => {
  initController();
  checkAbort();

  const prompt = `
    You are an Intent Classifier.
    User Query: "${userMessage}"
    Available Documents: ${JSON.stringify(activeFiles)}

    Decide the appropriate processing path:
    
    1. **QUICK_ANSWER**: 
       - Simple greetings ("Hi", "Hello").
       - General questions NOT requiring specific document data.
       - Simple document retrieval questions (e.g., "Who is the CEO?", "What is the date of the report?").
       - Questions where a single-step search is sufficient.
    
    2. **DEEP_RESEARCH**:
       - Complex multi-part questions (e.g., "Compare the revenue growth between these two companies").
       - Questions requiring thematic analysis or synthesis (e.g., "What are the key risks and how are they mitigated?").
       - Requests to generate tables, long summaries, or specific formats.
       - Questions that are vague and might need clarification.

    Output JSON.
  `;

  let imageParts: any[] = [];
  if (attachedImages.length > 0) {
    for (const img of attachedImages) {
      imageParts.push(await fileToGenerativePart(img));
    }
  }

  return await callGeminiWithRetry(async (abortSignal) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [prompt, ...imageParts],
      config: {
        responseMimeType: "application/json",
        responseSchema: intentSchema,
        temperature: 0.1,
        abortSignal
      }
    });
    if (!response.text) return { type: "DEEP_RESEARCH", reasoning: "Default" };
    return cleanAndParseJSON(response.text) as IntentClassification;
  }, 3, 2000);
};

// --- QUICK ANSWER EXECUTION ---

export const executeQuickAnswer = async (
  userMessage: string,
  attachedImages: File[] = [],
  activeFiles: string[],
  chatHistory: ChatMessage[],
  onStatusUpdate?: (status: string) => void
): Promise<{ text: string }> => {
  initController();
  checkAbort();

  if (activeFiles.length === 0) {
    return { text: "I can help you analyze documents, but none are currently active. Please upload a file." };
  }

  // Optimize: If query is "Hi", don't query docs.
  if (/^(hi|hello|hey|greetings)/i.test(userMessage) && userMessage.split(' ').length < 5) {
    return { text: "Hello! I am ready to analyze your documents. What would you like to know?" };
  }

  if (onStatusUpdate) onStatusUpdate("Quick Retrieval: Scanning documents...");

  const targets = activeFiles.filter(name => agentSwarm.has(name));

  let imageParts: any[] = [];
  if (attachedImages.length > 0) {
    for (const img of attachedImages) {
      imageParts.push(await fileToGenerativePart(img));
    }
  }

  // Parallel query to all experts
  const results = await Promise.all(targets.map(async (fileName) => {
    const session = agentSwarm.get(fileName);
    if (!session) return null;
    try {
      // Send both text and image parts if URL/Web expert or if needed
      const messageContent = [userMessage, ...imageParts];
      const resp = await session.chat.sendMessage({ message: messageContent });
      return { fileName, text: resp.text };
    } catch (e) {
      return { fileName, text: "Error retrieving." };
    }
  }));

  const validResults = results.filter(r => r !== null) as { fileName: string, text: string }[];

  if (onStatusUpdate) onStatusUpdate("Synthesizing answer...");

  // Synthesis
  const prompt = `
    You are a helpful assistant.
    User Query: "${userMessage}"
    
    Context from Documents:
    ${validResults.map(r => `[${r.fileName}]: ${r.text}`).join('\n\n')}
    
    Task: Answer the user's question concisely based on the context. 
    If the context says "Not found", simply state that.
    
    CITATION RULE:
    You MUST cite your sources using <claim> tags. 
    CRITICAL: You MUST WRAP the actual text content with the tag. Do not just append the tag.
    CRITICAL URL RULE: If the Context text provides a specific URL as the source, you MUST use that exact URL as the 'source' attribute in your <claim> tag. Do NOT use the agent's name like "Web Expert" or "URL Expert" as the source if a real URL is provided.

    CORRECT FORMAT:
    <claim source="doc.pdf" page="10" quote="revenue was $5B">Revenue was $5B in 2023</claim>.
    <claim source="https://example.com" quote="Q3 profit">Q3 profit was up</claim>.

    INCORRECT FORMATS (DO NOT USE):
    - Revenue was $5B in 2023 <claim ...>. (Tag at end)
    - Revenue was $5B in 2023 <claim ... />. (Self-closing)
    - <claim source="Web Expert">...</claim> (When the actual text contained a real URL, use the real URL instead)

    Ensure every claim is properly closed with </claim>.
  `;

  const synthesis = await callGeminiWithRetry(async (abortSignal) => {
    const resp = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [prompt, ...imageParts],
      config: { abortSignal }
    });
    return resp.text || "No response generated.";
  });

  return { text: synthesis };
};


// --- 3. LEAD RESEARCHER & PEER REVIEW BOARD SYSTEM ---

// HUMAN-IN-THE-LOOP CLARIFICATION SCHEMA
const clarificationSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    requires_clarification: { type: Type.BOOLEAN, description: "True if the query is vague or could be interpreted in multiple ways. False if simple greeting." },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          text: { type: Type.STRING, description: "The clarification question itself." },
          multiple_choice: { type: Type.BOOLEAN, description: "True if user can select multiple options. False for single choice." },
          options: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                text: { type: Type.STRING, description: "The text of the option." },
                isCustomInput: { type: Type.BOOLEAN, description: "Set to TRUE for the last option to allow user typing." }
              },
              required: ["id", "text"]
            },
            description: "3 to 5 options. Last one can be custom."
          }
        },
        required: ["id", "text", "multiple_choice", "options"]
      },
      description: "List of 3 to 4 distinct clarification questions."
    }
  },
  required: ["requires_clarification", "questions"]
};

const orchestratorSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    plan_type: {
      type: Type.STRING,
      enum: ["SIMPLE_FACT", "DEEP_ANALYSIS"],
      description: "SIMPLE_FACT = retrieval, summarization. DEEP_ANALYSIS = complex reasoning, cross-document synthesis, thematic analysis."
    },
    thought_process: { type: Type.STRING },
    strategy_explanation: { type: Type.STRING },
    revision_commentary: { type: Type.STRING, description: "If this is a revised plan, explain how you addressed the Advisor's feedback. If you rejected the feedback, explain why." },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          step_title: { type: Type.STRING },
          description: { type: Type.STRING },
          tasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                file_name: { type: Type.STRING },
                specific_question: { type: Type.STRING },
                rationale: { type: Type.STRING }
              },
              required: ["file_name", "specific_question", "rationale"]
            }
          }
        },
        required: ["step_title", "description", "tasks"]
      }
    }
  },
  required: ["plan_type", "thought_process", "strategy_explanation", "steps"]
};

// RESEARCH EVALUATION SCHEMA (For the recursive loop)
const researchEvaluationSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ["CONTINUE_RESEARCH", "FINALIZE"] },
    gap_analysis: { type: Type.STRING, description: "Analyze what facts or reasoning are missing from the expert reports to fully answer the query. If experts said 'Not found', or if you need more input, we need to pivot strategy." },
    new_plan: orchestratorSchema // Recursive schema reference if continued research is needed to gather missing facts
  },
  required: ["status", "gap_analysis"]
};

// ADVISOR REVIEW SCHEMA (Committee Mode) - UPDATED TO STRICT SCORECARD
const advisorSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    scorecard: {
      type: Type.OBJECT,
      properties: {
        goal_alignment: { type: Type.INTEGER, description: "1-5 score" },
        insight_quality: { type: Type.INTEGER, description: "1-5 score" },
        accuracy_traceability: { type: Type.INTEGER, description: "1-5 score" },
        robustness: { type: Type.INTEGER, description: "1-5 score" },
        simplicity: { type: Type.INTEGER, description: "1-5 score" },
        feasibility: { type: Type.INTEGER, description: "1-5 score" }
      },
      required: ["goal_alignment", "insight_quality", "accuracy_traceability", "robustness", "simplicity", "feasibility"]
    },
    key_risks: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Concrete risks or weaknesses identified in the plan."
    },
    evidence_references: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Quote or step number from the plan related to each risk."
    }
  },
  required: ["scorecard", "key_risks", "evidence_references"]
};

// PEER REVIEW BOARD SCHEMA (Output Audit Phase - Consultant Role)
const outputQualitySchema: Schema = {
  type: Type.OBJECT,
  properties: {
    does_answer_query: { type: Type.BOOLEAN, description: "True if the report fully answers the user's original query." },
    has_hallucinations: { type: Type.BOOLEAN, description: "True if there are unverified claims or hallucinations." },
    consultant_opinion: { type: Type.STRING, description: "Your detailed evaluation on whether the report succeeds, what is missing, and if there are hallucinations." }
  },
  required: ["does_answer_query", "has_hallucinations", "consultant_opinion"]
};

// LEAD RESEARCHER ARBITRATION SCHEMA
const leadArbitrationSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    verdict: {
      type: Type.STRING,
      enum: ["APPROVED", "REJECTED", "INCREMENTAL", "DEBATE", "NEEDS_CLARIFICATION"],
      description: "APPROVE if report is good. INCREMENTAL if the report is mostly correct but has a narrow gap that can be filled with a small targeted follow-up (previous results are preserved). REJECT only for fundamental structural issues requiring a full restart. NEEDS_CLARIFICATION if you cannot solve the issue without user input."
    },
    reasoning: { type: Type.STRING, description: "Your reasoning for accepting or overriding the consultant's opinion." },
    remediation_plan: orchestratorSchema, // Required if REJECTED or INCREMENTAL
    clarification_message: { type: Type.STRING, description: "Only if NEEDS_CLARIFICATION. A direct message explaining to the user why you are stuck (e.g., 'To find the latest trends, I need you to activate the Web Expert agent')." }
  },
  required: ["verdict", "reasoning"]
};

export const generateClarificationQuestions = async (
  userMessage: string,
  attachedImages: File[] = [],
  activeFiles: string[]
): Promise<ClarificationRequest> => {
  initController();
  checkAbort();

  const prompt = `
    You are a Research Lead preparing to analyze these documents: ${JSON.stringify(activeFiles)}.
    User Query: "${userMessage}"
    
    TASK: Determine if you need to clarify the user's intent to provide a better answer.
    
    1. If the query is vague (e.g., "summarize", "what's important", "compare them"), generate 3 to 4 distinct clarification questions.
       - Decide if each question should be SINGLE-choice (e.g. "Which specific year?") or MULTIPLE-choice (e.g. "Which departments should be included?").
       - Each question must have 3 to 5 options.
       - **MANDATORY**: The FIRST option for every question must be "Let Jarvis decide [context]" (e.g., "Let Jarvis identify key years", "Let Jarvis select top metrics").
       - Include an "Other/Custom" option where relevant as the last choice (set isCustomInput=true).
    2. If the query is already very specific (e.g., "What is the revenue in 2023 for Company X?"), set requires_clarification = false.

    OUTPUT JSON.
  `;

  let imageParts: any[] = [];
  if (attachedImages.length > 0) {
    for (const img of attachedImages) {
      imageParts.push(await fileToGenerativePart(img));
    }
  }

  return await callGeminiWithRetry(async (abortSignal) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [prompt, ...imageParts],
      config: {
        responseMimeType: "application/json",
        responseSchema: clarificationSchema,
        temperature: 0.3,
        abortSignal
      }
    });
    if (!response.text) return { requires_clarification: false, questions: [] };
    return cleanAndParseJSON(response.text) as ClarificationRequest;
  }, 3, 2000);
};

export const createCollaborativePlan = async (
  userMessage: string,
  attachedImages: File[] = [],
  activeFiles: string[] = [],
  chatHistory: ChatMessage[] = [],
  onStatusUpdate?: (status: string) => void,
  onStepUpdate?: (step: CollaborationStep) => void,
  previousFailureContext?: { feedback: string; previousPlan: OrchestratorPlan }
): Promise<OrchestratorPlan> => {
  initController();

  if (agentSwarm.size === 0) throw new Error("Expert Panel not initialized");

  const targets = activeFiles.length > 0
    ? activeFiles.filter(name => agentSwarm.has(name))
    : Array.from(agentSwarm.keys());

  const historyText = chatHistory.slice(-10).map(msg => {
    const content = msg.text || (msg.plan ? "(Plan Generated)" : "(Thinking)");
    const imgNote = msg.images && msg.images.length > 0 ? ` [Attached ${msg.images.length} images]` : "";
    return `${msg.role.toUpperCase()}: ${content}${imgNote}`;
  }).join('\n');

  checkAbort();
  if (onStatusUpdate) {
    if (previousFailureContext) onStatusUpdate("Research Lead: Recalibrating strategy based on Peer Review...");
    else onStatusUpdate("Research Lead: Drafting research strategy...");
  }

  let basePrompt = `
    You are the "Lead Researcher" managing a team of Document Experts.
    
    CRITICAL INSTRUCTION:
    You are ONLY allowed to assign tasks to the "ACTIVE EXPERT AGENTS" listed below.
    Do NOT assign tasks to any file not in this list.

    ACTIVE EXPERT AGENTS: 
    ${targets.map(f => `- ${f}`).join('\n')}
    
    AGENT ROLES:
    - **Web Expert**: Use for broad internet searches, finding latest news, or verifying facts. CITATION MUST INCLUDE URL.
    - **URL Expert**: Use ONLY when the user provides a specific URL to analyze. Do NOT use for general search.
    - **[File Name]**: Use for deep retrieval from that specific uploaded document.

    HISTORY: ${historyText}
    USER QUERY: "${userMessage}"
  `;

  if (previousFailureContext) {
    basePrompt += `
      CRITICAL ALERT: Your previous strategy FAILED the Peer Review.
      REASON: ${previousFailureContext.feedback}
      YOUR TASK: Create a REMEDIATION PLAN.
      `;
  }

  basePrompt += `
    GOAL: Create a structured execution plan for your experts.
    
    DECISION RULES:
    1. **SIMPLE_FACT**: For retrieval, summarization, or simple questions.
    2. **DEEP_ANALYSIS**: For comparison, thematic analysis, or complex reasoning.
    3. **NO_OP RULE**: If answer is in history, return empty steps.
    4. **MULTIMODAL NOTE**: The user may have attached images with their query. Take that into account for planning.

    OUTPUT: JSON.
  `;

  let imageParts: any[] = [];
  if (attachedImages.length > 0) {
    for (const file of attachedImages) {
      imageParts.push(await fileToGenerativePart(file));
    }
  }

  let currentPlan = await generateOrchestratorPlan([basePrompt, ...imageParts]);

  if (onStepUpdate) {
    onStepUpdate({
      type: 'ORCHESTRATOR',
      round: previousFailureContext ? 99 : 0,
      content: currentPlan,
      timestamp: Date.now()
    });
  }

  return currentPlan;
};

// Renamed from improvePlanWithCritic to reflect the new workflow
export const refinePlanWithAdvisor = async (
  userMessage: string,
  initialPlan: OrchestratorPlan,
  activeFiles: string[] = [],
  onStatusUpdate?: (status: string) => void,
  onStepUpdate?: (step: CollaborationStep) => void
): Promise<OrchestratorPlan> => {
  initController();

  const targets = activeFiles.length > 0
    ? activeFiles.filter(name => agentSwarm.has(name))
    : Array.from(agentSwarm.keys());

  const basePrompt = `
        You are the "Research Lead".
        AVAILABLE DOCS: ${targets.map(f => `- ${f}`).join('\n')}
        QUERY: "${userMessage}"
        GOAL: Create a structured plan.
    `;

  // 1. ADVISOR REVIEW (Committee Mode)
  checkAbort();
  if (onStatusUpdate) onStatusUpdate(`Committee Review: Reviewer Agent is scoring plan...`);

  const advisorFeedback = await getAdvisorFeedback(userMessage, initialPlan, targets);

  if (onStepUpdate) {
    onStepUpdate({
      type: 'ADVISOR',
      round: 1,
      content: advisorFeedback,
      timestamp: Date.now()
    });
  }

  // --- CENTRALIZED GATING LOGIC ---
  // If scores are high (>= 4) and no critical risks, we bypass refinement debate.
  const scores = Object.values(advisorFeedback.scorecard);
  const minScore = Math.min(...scores);
  const hasCriticalRisks = advisorFeedback.key_risks.length > 0;

  // Strict Gating: If minScore is low (< 3) OR has risks, we MUST refine. 
  // If minScore is excellent (>= 4) AND no risks, we can proceed.
  // Otherwise (scores 3-4), we bias the debate but let Lead decide.
  if (minScore >= 4 && !hasCriticalRisks) {
    if (onStatusUpdate) onStatusUpdate("Committee endorsed the plan (High Score). Proceeding.");
    return initialPlan;
  }

  // 2. LEAD REFLECTION & DEBATE
  if (onStatusUpdate) onStatusUpdate(`Research Lead: Analyzing Low Scores/Risks...`);

  const refinementPrompt = `
    ${basePrompt}
    
    YOUR INITIAL PLAN: ${JSON.stringify(initialPlan)}
    
    REVIEWER AGENT FEEDBACK:
    Scorecard: ${JSON.stringify(advisorFeedback.scorecard)}
    Key Risks: ${JSON.stringify(advisorFeedback.key_risks)}
    Evidence: ${JSON.stringify(advisorFeedback.evidence_references)}
    
    YOUR TASK:
    1. **Debate**: Evaluate the advice. 
       - The reviewer flagged risks or gave low scores. You MUST address them unless you have a strong counter-argument.
       - Pay attention to "Accuracy & Traceability" and "Robustness".
    2. **Finalize**: Output the FINAL plan (either updated or original).
       - In 'revision_commentary', explicitly state how you addressed the Reviewer's scorecard/risks.
    `;

  const finalPlan = await generateOrchestratorPlan(refinementPrompt);

  if (onStepUpdate) {
    onStepUpdate({
      type: 'ORCHESTRATOR',
      round: 1, // Final round
      content: finalPlan,
      timestamp: Date.now()
    });
  }

  return finalPlan;
}

const generateOrchestratorPlan = async (promptContents: string | any[]): Promise<OrchestratorPlan> => {
  checkAbort();
  return await callGeminiWithRetry(async (abortSignal) => {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: promptContents,
      config: {
        responseMimeType: "application/json",
        responseSchema: orchestratorSchema,
        temperature: 0.2,
        abortSignal
      }
    });
    if (!response.text) throw new Error("No response string formed.");
    return cleanAndParseJSON(response.text) as OrchestratorPlan;
  }, 3, 3000);
}

// Replaces runExecutiveBoard with the Strict Reviewer
async function getAdvisorFeedback(userQuery: string, plan: OrchestratorPlan, availableFiles: string[]): Promise<AdvisorReview> {
  checkAbort();
  const advisorPrompt = `
    You are a REVIEWER agent.
    Your role is to EVALUATE a proposed plan for file analysis and insight generation.

    IMPORTANT RULES:
    - You do NOT own the solution.
    - You must NOT rewrite, redesign, or replace the plan.
    - You must NOT introduce new goals, architectures, or system components.
    - Final decisions always belong to the Research Lead.
    - **NO VERDICTS**: Do not output "Approved" or "Rejected". Only scores and risks.

    You may ONLY:
    1. Score the plan against the criteria below
    2. Identify concrete risks or weaknesses
    3. Reference specific parts of the plan as evidence

    QUERY: "${userQuery}"
    RESOURCES: ${JSON.stringify(availableFiles)}
    PROPOSED PLAN: ${JSON.stringify(plan)}

    ------------------------------------------------

    EVALUATION CRITERIA (Score 1-5)
    1. Goal Alignment: Does the plan support file analysis and insight extraction? Are insights grounded in file content?
    2. Insight Quality: Are insights specific, structured, and useful? Is there a clear method beyond simple summarization?
    3. Accuracy & Traceability: Are claims tied to file sections, data, or citations? Is hallucination risk addressed?
    4. Robustness: Does the plan handle messy, incomplete, or ambiguous files? Are failure cases considered?
    5. Simplicity / Overengineering: Is the solution appropriately scoped? Any unnecessary complexity?
    6. Feasibility: Can this be realistically implemented with current tools?

    OUTPUT JSON matching the schema.
  `;

  return await callGeminiWithRetry(async (abortSignal) => {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: advisorPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: advisorSchema,
        temperature: 0.1,
        abortSignal
      }
    });

    if (!response.text) {
      return {
        scorecard: { goal_alignment: 5, insight_quality: 5, accuracy_traceability: 5, robustness: 5, simplicity: 5, feasibility: 5 },
        key_risks: [],
        evidence_references: []
      };
    }
    return cleanAndParseJSON(response.text) as AdvisorReview;
  }, 3, 2000);
}

// --- NEW SPLIT EXECUTION FUNCTIONS FOR RECURSIVE LOOP ---

// 1. Execute Tasks (Retrieval Only)
export const executePlanTasks = async (
  plan: OrchestratorPlan,
  onStatusUpdate?: (status: string) => void
): Promise<{ file: string, question: string, response: string }[]> => {
  initController();
  const allTasks = plan.steps.flatMap(step => step.tasks);
  if (allTasks.length === 0) return [];

  if (onStatusUpdate) onStatusUpdate(`Execution: Deploying ${allTasks.length} tasks...`);

  const taskPromises = allTasks.map(async (task) => {
    checkAbort();
    const session = agentSwarm.get(task.file_name);
    if (!session) return { file: task.file_name, question: task.specific_question, response: "Error: Expert not assigned." };
    try {
      const text = await callGeminiWithRetry(async (abortSignal) => {
        const response = await session.chat.sendMessage({
          message: task.specific_question,
          config: { abortSignal }
        });
        return response.text;
      }, 3, 2000);
      return { file: task.file_name, question: task.specific_question, response: text || "No response." };
    } catch (e) {
      if ((e as Error).message === "USER_ABORTED") throw e;
      return { file: task.file_name, question: task.specific_question, response: "Error: Retrieval failed." };
    }
  });

  return await Promise.all(taskPromises);
}

// 2. Evaluate Results (Should we pivot?)
export const evaluateResearchResults = async (
  userQuery: string,
  currentPlan: OrchestratorPlan,
  retrievedResults: { file: string, question: string, response: string }[],
  historyText: string
): Promise<ResearchEvaluation> => {
  checkAbort();
  const evalPrompt = `
      You are the Research Lead observing the output from your Document Experts.
      QUERY: "${userQuery}"
      
      CURRENT PLAN: "${currentPlan.strategy_explanation}"
      
      RETRIEVED DATA:
      ${retrievedResults.map(r => `[${r.file}]: Q: ${r.question} -> A: ${r.response}`).join('\n')}
      
      TASK:
      1. Carefully visit and analyze if the retrieved facts are sufficient to fully answer the main query.
      2. If you find the gathered facts are incomplete, or experts reported "Not found," you MUST reason that more input is needed and pivot the strategy.
         - Set status to "CONTINUE_RESEARCH".
         - Propose a NEW PLAN inside 'new_plan' assigning additional tasks to the active expert agents (proxy metrics, different sections, or alternative keywords) to gather the missing facts.
      3. If the data is fully sufficient, status = "FINALIZE". Set gap_analysis to a brief summary of what was successfully found.
      
      OUTPUT JSON.
    `;

  return await callGeminiWithRetry(async (abortSignal) => {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: evalPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: researchEvaluationSchema,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 4096 },
        abortSignal
      }
    });

    if (!response.text) return { status: "FINALIZE", gap_analysis: "Auto-proceed." };
    return cleanAndParseJSON(response.text) as ResearchEvaluation;
  }, 3, 3000);
}

// 3. Final Synthesis (Writing the report)
export const synthesizeReport = async (
  userQuery: string,
  plan: OrchestratorPlan,
  historyText: string,
  allAccumulatedResults: { file: string, question: string, response: string }[]
): Promise<{ thinking: string; content: string }> => {
  checkAbort();
  const isDeep = plan.plan_type === 'DEEP_ANALYSIS';

  const synthesisPrompt = `
        You are the Research Lead.
        MODE: ${isDeep ? "DEEP ANALYSIS" : "PRECISE ANSWER"}
        ORIGINAL USER QUERY: "${userQuery}"
        STRATEGY: "${plan.strategy_explanation}"
        HISTORY: ${historyText}
        
        ALL EXPERT REPORTS (Accumulated from all rounds):
        ${allAccumulatedResults.map(r => `SOURCE: "${r.file}"\nCONTENT: ${r.response}`).join("\n\n")}

        TASK: Synthesize a comprehensive final report that fully answers the ORIGINAL USER QUERY using ALL the gathered expert reports. Do not just answer the remediation task; you must provide the complete, big-picture answer.

        PRIORITIZATION RULE: You MUST prioritize answering the user's query using the user-provided files as the primary source of truth. Use external web resources (URLs) ONLY to supplement or fill in gaps when the provided files do not contain the complete answer.

        STRICT OUTPUT FORMAT RULES:
        1. First line: <thinking>Explain synthesis logic here...</thinking>
        2. Then, the detailed response.
        3. **CITATION RULE**: EVERY fact/claim MUST be wrapped in a <claim> tag.
           - Attributes: source="filename or URL", page="X", quote="exact substring".
           - **CRITICAL URL RULE**: If the EXPERT REPORT provides its own citation with a specific source URL, you MUST preserve and use THAT EXACT URL as the 'source' attribute. Do NOT use the agent's name (e.g., "Web Expert") as the source if an actual URL is available.
           - **EXACT URL PRESERVATION**: Do NOT truncate, strip paths, or simplify the URLs provided by the expert agents. You must copy the exact, full URL string into the <claim source="URL"> attribute without any modification. No generic domains.
           - **LOGIC RULE**: If the conclusion is derived, ADD logic="Reasoning used".
           
        Example:
        <claim source="Doc.pdf" page="10" quote="Project starts June" logic="Inferred from Q2 timeline">Start Date: June</claim>
        <claim source="https://example.com" quote="launched July">Launched in July</claim>
        
        4. **TABLES**: When generating Markdown tables, ensure the VALUES inside the table cells are wrapped in <claim> tags.
    `;

  return await callGeminiWithRetry(async (abortSignal) => {
    const coordinator = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: synthesisPrompt,
      config: {
        thinkingConfig: { thinkingBudget: isDeep ? 32768 : 4096 },
        abortSignal
      }
    });

    const rawText = coordinator.text || "Synthesis failed.";
    const thinkingMatch = rawText.match(/<thinking>([\s\S]*?)<\/thinking>/);
    const thinking = thinkingMatch ? thinkingMatch[1].trim() : "";
    const content = rawText.replace(/<thinking>[\s\S]*?<\/thinking>/, "").trim();

    return { thinking, content };
  }, 3, 5000);
}


export const reviewOutputWithBoard = async (
  userQuery: string,
  synthesizedOutput: string,
  originalPlan: OrchestratorPlan,
  debateHistory: string[] = []
): Promise<OutputQualityVerdict> => {
  checkAbort();

  const debateContext = debateHistory.length > 0
    ? `\n\nLEAD RESEARCHER'S DEBATE Defense:\n${debateHistory.map((msg, i) => `Round ${i + 1}: ${msg}`).join('\n')}\n\nRead the Lead Researcher's defense. Determine if you agree with their logic and should change your opinion, or if you hold your ground.`
    : "";

  const auditPrompt = `
      You are the **Peer Review Board Consultant**.
      Review the Final Research Report.
      
      ORIGINAL USER QUERY: "${userQuery}"
      REPORT: 
      ${synthesizedOutput}
      ${debateContext}
      
      GOAL: **CONSULT THE LEAD RESEARCHER**.
      
      1. **Address User Request**: Does the synthesis fundamentally address the user's main request?
      2. **Hallucination Detection**: Are there factual claims not grounded in sources?
         - **EXTERNAL URL RULE**: The Lead Researcher has access to external Web Experts. Citations that reference external URLs or web resources are VALID and should NOT be flagged as hallucinations. Only flag claims that have no source or contradict logical facts.
      
      RULES:
      - **DO NOT provide a verdict (no approve/reject).** Leave the final decision to the Lead Researcher.
      - **DO NOT provide recommended fixes.** Just state your factual observations.
      - Think of yourself as a consultant providing an honest opinion on these two criteria.
      
      Output JSON.
    `;

  return await callGeminiWithRetry(async (abortSignal) => {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: auditPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: outputQualitySchema,
        temperature: 0.1,
        abortSignal
      }
    });

    if (!response.text) return { does_answer_query: true, has_hallucinations: false, consultant_opinion: "Auto-approved on error" };
    return cleanAndParseJSON(response.text) as OutputQualityVerdict;
  }, 3, 2000);
}

export const arbitrateReviewBoardFeedback = async (
  userQuery: string,
  synthesizedOutput: string,
  consultantOpinion: OutputQualityVerdict,
  activeFiles: string[],
  debateHistory: string[] = [],
  accumulatedResults: { file: string, question: string, response: string }[] = []
): Promise<LeadArbitration> => {
  checkAbort();

  const debateContext = debateHistory.length > 0
    ? `\n\nPREVIOUS DEBATE HISTORY:\n${debateHistory.map((msg, i) => `Round ${i + 1}: ${msg}`).join('\n')}\n\nYou are still arguing with the Consultant over these points.`
    : "";

  // Build a concise summary of what has already been gathered
  const accumulatedSummary = accumulatedResults.length > 0
    ? `\n\nALREADY GATHERED DATA (${accumulatedResults.length} results from previous rounds):\n${accumulatedResults.map(r => `- [${r.file}] Q: "${r.question}" → A: ${r.response.substring(0, 200)}...`).join('\n')}\n`
    : "";

  const arbitrationPrompt = `
      You are the **Lead Researcher**.
      You just wrote a Final Research Report. The Peer Review Board Consultant has reviewed it.
      
      ORIGINAL QUERY: "${userQuery}"
      YOUR REPORT:
      ${synthesizedOutput}
      ${accumulatedSummary}
      CONSULTANT OPINION:
      Does it answer the query? ${consultantOpinion.does_answer_query}
      Has hallucinations? ${consultantOpinion.has_hallucinations}
      Opinion details: "${consultantOpinion.consultant_opinion}"
      ${debateContext}

      AVAILABLE EXPERTS (For further research if needed): ${JSON.stringify(activeFiles)}
      
      TASK: 
      1. Decide if you will accept or reject the consultant's feedback based on OBJECTIVE facts, not blind agreement.
      2. **OBJECTIVITY RULE**: You must independently evaluate the Consultant's opinion against your report and the sources. Do NOT default to agreeing with the Consultant. If the Consultant is overly pedantic, misinterprets a source, or flags a false hallucination, you MUST push back.
      3. **DEBATE VERDICT**: If you disagree with the Consultant, output "DEBATE" as your verdict and explain your counter-argument in the 'reasoning' field. The Consultant will read it and reply.
      4. **APPROVED VERDICT**: If you believe the report is good enough, output "APPROVED".

      5. **INCREMENTAL vs REJECTED — DECISION FRAMEWORK**:
         - **INCREMENTAL** (PREFERRED): The existing report is mostly correct, but is missing specific data points or has a narrow gap. Provide a small, targeted remediation_plan to fill ONLY the gap. All previously gathered data will be PRESERVED and MERGED with the new findings. Use this when:  
           • Only 1-2 specific facts are missing  
           • The overall structure and approach are sound  
           • The Consultant's concern is a minor omission, not a fundamental flaw  
         - **REJECTED** (LAST RESORT): The report has fundamental structural issues, a completely wrong approach, or widespread hallucinations. A full re-research from scratch is necessary. Use this ONLY when:  
           • The entire approach or structure is wrong  
           • Most claims are ungrounded or hallucinated  
           • An incremental fix would not resolve the core problem  
         - **DEFAULT TO INCREMENTAL** when in doubt. Most Consultant feedback is about missing details, not structural failures.

      6. **NEEDS_CLARIFICATION VERDICT**: If the Consultant correctly points out missing data (e.g. "latest trends absent"), BUT you cannot find this data because you don't have the right active expert agents (for example, you only have static PDFs, but need the 'Web Expert' agent), you MUST output 'NEEDS_CLARIFICATION'. Do NOT continually output 'REJECTED' with a new plan for the same static file. Use 'clarification_message' to explain the root cause and ask the user to turn on the required agent or provide newer files.
      
      Output JSON.
    `;

  return await callGeminiWithRetry(async (abortSignal) => {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: arbitrationPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: leadArbitrationSchema,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 4096 },
        abortSignal
      }
    });

    if (!response.text) return { verdict: "APPROVED", reasoning: "Auto-approved on error" };
    return cleanAndParseJSON(response.text) as LeadArbitration;
  }, 3, 4000);
}

// Deprecated: Kept for compatibility if called directly, but Chat.tsx should use granular functions
export const executeOrchestratorPlan = async (
  userQuery: string,
  plan: OrchestratorPlan,
  chatHistory: ChatMessage[] = [],
  onStatusUpdate?: (status: string) => void
): Promise<{ thinking: string; content: string }> => {
  const results = await executePlanTasks(plan, onStatusUpdate);
  const historyText = chatHistory.slice(-10).map(msg => `${msg.role.toUpperCase()}: ${msg.text || ""}`).join('\n');
  return synthesizeReport(userQuery, plan, historyText, results);
};
