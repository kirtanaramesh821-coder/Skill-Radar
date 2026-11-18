/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Rocket, 
  FileText, 
  ChevronRight, 
  Briefcase, 
  CheckCircle2, 
  Target, 
  Map, 
  Bell, 
  Play,
  ArrowLeft,
  Loader2,
  ExternalLink,
  GraduationCap,
  RotateCcw,
  Sparkles,
  Flower,
  Heart,
  Moon,
  Sun,
  Palette,
  Cloud,
  Sticker,
  Star,
  AlertCircle,
  X
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface RoleSuggestion {
  title: string;
  matchPercentage: number;
  matchReason: string;
  existingSkills: string[];
  missingSkills: string[];
  readinessPercentage: number;
}

interface RoadmapDay {
  day: number;
  goal: string;
  resource: string;
  resourceType: string;
  completed?: boolean;
}

interface RoadmapWeek {
  weekNumber: number;
  focus: string;
  days: RoadmapDay[];
  weeklySimulation: {
    title: string;
    description: string;
  };
}

interface Roadmap {
  weeks: RoadmapWeek[];
}

interface Scenario {
  title: string;
  situation: string;
  options: string[];
  correctIndex: number;
  feedbacks: string[];
}

// --- Components ---

const Doodle = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={cn("absolute opacity-20 pointer-events-none", className)}>
    <path 
      d="M20,50 Q30,20 50,50 T80,50" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      className="animate-pulse"
    />
    <circle cx="20" cy="20" r="5" fill="currentColor" />
    <circle cx="80" cy="80" r="8" fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>
);

const FloatingDoodle = ({ icon: Icon, className, color }: { icon: any, className?: string, color?: string }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0 }}
    animate={{ opacity: 0.15, scale: 1 }}
    transition={{ duration: 1 }}
    className={cn("fixed pointer-events-none z-[-1]", className, color)}
  >
    <Icon className="w-12 h-12 doodle-float" />
  </motion.div>
);

export default function App() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [resumeText, setResumeText] = useState("");
  const [roleSuggestions, setRoleSuggestions] = useState<RoleSuggestion[]>([]);
  const [selectedRole, setSelectedRole] = useState<RoleSuggestion | null>(null);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [simulation, setSimulation] = useState<Scenario[]>([]);
  const [simStep, setSimStep] = useState(0);
  const [simFeedback, setSimFeedback] = useState<string | null>(null);
  const [userAnswers, setUserAnswers] = useState<number[]>([]);
  const [isPrefetching, setIsPrefetching] = useState(false);
  const [activeWeeklyChallenge, setActiveWeeklyChallenge] = useState<{title: string, description: string} | null>(null);
  const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisSeqRef = useRef(0);

  const showToast = useCallback((type: "error" | "success", message: string) => {
    setToast({ type, message });
  }, []);

  // --- Handlers ---

  // Prefetch simulation data in the background
  const prefetchSimulation = useCallback(async (roleTitle: string) => {
    if (simulation.length > 0 || isPrefetching) return;
    setIsPrefetching(true);
    try {
      const res = await fetch("/api/get-simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: roleTitle }),
      });
      if (!res.ok) throw new Error("Failed prefetch");
      const data = await res.json();
      if (data && data.scenarios) {
        setSimulation(data.scenarios);
      }
    } catch (err) {
      console.warn("Simulation prefetch failed:", err);
    } finally {
      setIsPrefetching(false);
    }
  }, [simulation.length, isPrefetching]);

  const analyzeResume = async (file?: File) => {
    if (analysisAbortRef.current) {
      analysisAbortRef.current.abort();
    }
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const reqId = ++analysisSeqRef.current;

    setToast(null);
    setSelectedFileName(file ? file.name : null);
    setLoading(true);
    setSimulation([]); // Clear previous simulations
    try {
      const formData = new FormData();
      if (file) {
        if (file.size === 0) {
          throw new Error("The selected file is empty. Please choose another file.");
        }
        formData.append("resume", file);
      } else {
        formData.append("text", resumeText);
      }

      const res = await fetch("/api/analyze-resume", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 413) {
          throw new Error("File is too large for the server limit. Please use a smaller PDF or paste your resume text.");
        }
        const text = await res.text();
        let errMsg = `Error ${res.status}`;
        try {
          const json = JSON.parse(text);
          errMsg = json.error || json.details || errMsg;
        } catch (e) {
          const cleanText = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          if (cleanText) {
            errMsg = `Error ${res.status}: ${cleanText.slice(0, 180)}`;
          }
        }
        throw new Error(errMsg);
      }

      const data = await res.json();
      if (reqId !== analysisSeqRef.current) return;

      if (data && Array.isArray(data.roles) && data.roles.length > 0) {
        setRoleSuggestions(data.roles);
        setStep(3); // Move to tailored career options
      } else {
        throw new Error("The server returned an unexpected response format.");
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError" || reqId !== analysisSeqRef.current) return;
      console.error("Analysis Error:", err);
      showToast("error", err instanceof Error ? err.message : "Failed to analyze resume. Please try a different file.");
    } finally {
      if (reqId === analysisSeqRef.current) {
        setLoading(false);
        setSelectedFileName(null);
      }
    }
  };

  const generateRoadmap = async (role: RoleSuggestion) => {
    setToast(null);
    setSelectedRole(role);
    setLoading(true);
    try {
      const res = await fetch("/api/generate-roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: role.title,
          currentSkills: role.existingSkills,
          missingSkills: role.missingSkills
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let errMsg = `Error ${res.status}`;
        try {
          const json = JSON.parse(text);
          errMsg = json.error || errMsg;
        } catch (e) {}
        throw new Error(errMsg);
      }

      const data = await res.json();
      
      // Deep validation to prevent crashes and ensure days exist
      if (data && data.weeks && Array.isArray(data.weeks) && data.weeks.length > 0) {
        // Double check that at least some days exist in the first week
        if (!data.weeks[0]?.days || !Array.isArray(data.weeks[0].days)) {
          throw new Error("The AI provided an empty schedule. Please try generating again.");
        }
        setRoadmap(data);
        setStep(5);
        // Start prefetching simulation immediately after roadmap success
        prefetchSimulation(role.title);
      } else {
        throw new Error("Invalid roadmap structure received");
      }
    } catch (err) {
      console.error(err);
      showToast("error", err instanceof Error ? err.message : "Unable to generate a valid roadmap. Please try again!");
    } finally {
      setLoading(false);
    }
  };

  const startSimulation = async () => {
    if (!selectedRole) return;
    setToast(null);
    
    // If we already have prefetched data, go straight to it
    if (simulation.length > 0) {
      setSimStep(0);
      setSimFeedback(null);
      setUserAnswers([]);
      setStep(6);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/get-simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: selectedRole.title }),
      });

      if (!res.ok) {
        const text = await res.text();
        let errMsg = `Error ${res.status}`;
        try {
          const json = JSON.parse(text);
          errMsg = json.error || errMsg;
        } catch (e) {}
        throw new Error(errMsg);
      }

      const data = await res.json();
      
      // Deep validation
      if (data && data.scenarios && Array.isArray(data.scenarios) && data.scenarios.length > 0) {
        setSimulation(data.scenarios);
        setSimStep(0);
        setSimFeedback(null);
        setUserAnswers([]);
        setStep(6);
      } else {
        throw new Error("Invalid simulation scenarios received");
      }
    } catch (err) {
      console.error(err);
      showToast("error", err instanceof Error ? err.message : "Could not load simulation scenarios. Please try again!");
    } finally {
      setLoading(false);
    }
  };

  const toggleDayCompletion = (weekIdx: number, dayIdx: number) => {
    if (!roadmap || !roadmap.weeks || !roadmap.weeks[weekIdx]?.days) return;
    const newRoadmap = JSON.parse(JSON.stringify(roadmap)); // Deep clone
    newRoadmap.weeks[weekIdx].days[dayIdx].completed = !newRoadmap.weeks[weekIdx].days[dayIdx].completed;
    setRoadmap(newRoadmap);
  };

  const calculateProgress = () => {
    if (!roadmap || !roadmap.weeks) return 0;
    let totalDays = 0;
    let completedDays = 0;
    
    roadmap.weeks.forEach(w => {
      if (w.days && Array.isArray(w.days)) {
        totalDays += w.days.length;
        completedDays += w.days.filter(d => d.completed).length;
      }
    });

    if (totalDays === 0) return 0;
    return Math.round((completedDays / totalDays) * 100);
  };

  const handleSimAnswer = (idx: number) => {
    const currentSim = simulation[simStep];
    setUserAnswers([...userAnswers, idx]);
    setSimFeedback(
      currentSim?.feedbacks?.[idx] ||
        "Great thinking! Review the recommended approach above and continue to the next scene."
    );
  };

  const nextSimOrFinish = () => {
    if (simStep < simulation.length - 1) {
      setSimStep(simStep + 1);
      setSimFeedback(null);
    } else {
      // Completed last scenario
      setSimFeedback("SUCCESS_COMPLETE");
    }
  };

  const resetAndSwitchRole = () => {
    setRoadmap(null);
    setSimulation([]);
    setSimStep(0);
    setSimFeedback(null);
    setSelectedRole(null);
    setStep(3);
  };

  // --- Screens ---

  const renderLoadingState = (message: string, submessage?: string) => (
    <div className="flex flex-col items-center justify-center p-20 glass-card w-full max-w-lg border-neon-cyan/25">
      <div className="relative mb-6">
        <Loader2 className="w-16 h-16 text-neon-cyan animate-spin" />
        <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-neon-pink animate-bounce" />
      </div>
      <p className="text-slate-50 font-bold text-2xl font-rounded mb-2">{message}</p>
      {submessage && <p className="text-slate-300 font-medium text-center">{submessage}</p>}
    </div>
  );

  const renderScreen1 = () => (
    <motion.div
      key="screen-1"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-12 text-center relative overflow-hidden max-w-xl w-full border-neon-purple/25"
    >
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute -top-10 -right-10 opacity-15"
      >
        <Flower className="w-40 h-40 text-neon-purple" />
      </motion.div>
      
      <div className="bg-neon-cyan/15 border border-neon-cyan/30 w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-8 rotate-3 shadow-[0_0_30px_rgba(114,239,221,0.2)]">
        <Target className="w-12 h-12 text-neon-cyan" />
      </div>
      
      <h1 className="text-5xl font-black text-slate-50 mb-6 font-rounded tracking-tight">
        Skill<span className="text-neon-pink">Radar</span>
      </h1>
      
      <p className="text-xl text-slate-300 mb-10 font-medium leading-relaxed">
        Let's find your dream path together! Upload your resume and watch the magic happen. ✨
      </p>
      
      <button 
        onClick={() => setStep(2)}
        className="btn-pastel bg-neon-pink text-slate-950 text-xl hover:scale-105 shadow-[0_0_28px_rgba(255,143,171,0.45)] flex items-center gap-3 mx-auto px-12"
      >
        Let's Go! <Rocket className="w-6 h-6" />
      </button>
    </motion.div>
  );

  const renderScreen2 = () => (
    <motion.div
      key="screen-2"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="w-full max-w-4xl"
    >
      <div className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => setStep(1)} className="p-3 hover:bg-white/10 rounded-2xl transition-colors cursor-pointer">
            <ArrowLeft className="text-slate-200" />
          </button>
          <h2 className="text-4xl font-black text-slate-50 font-rounded">Upload Resume</h2>
        </div>
        <Sticker className="w-10 h-10 text-neon-peach animate-pulse" />
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!loading) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (loading) return;
            const file = e.dataTransfer.files?.[0];
            if (file) analyzeResume(file);
          }}
          className={cn(
            "glass-card p-10 border-2 border-dashed transition-all flex flex-col items-center justify-center text-center group",
            isDragging
              ? "border-neon-cyan bg-neon-cyan/10 scale-[1.01]"
              : "border-neon-purple/40 hover:border-neon-purple"
          )}
        >
          <div className="bg-neon-purple/15 border border-neon-purple/30 p-6 rounded-3xl mb-6 group-hover:rotate-6 transition-transform shadow-[0_0_24px_rgba(196,181,253,0.18)]">
            <FileText className="w-12 h-12 text-neon-purple font-bold" />
          </div>
          <h3 className="text-2xl font-bold text-slate-50 mb-3">Document</h3>
          <p className="text-slate-300 mb-8 font-medium">
            {loading && selectedFileName
              ? `Reading ${selectedFileName}...`
              : "Drop your PDF, DOCX, or TXT here"}
          </p>
          
          <input 
            type="file" 
            accept="application/pdf,.pdf,.docx,.doc,.txt" 
            disabled={loading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) analyzeResume(file);
            }}
            className="hidden" 
            id="resume-upload" 
          />
          <label 
            htmlFor="resume-upload"
            className={cn(
              "btn-pastel bg-neon-purple text-slate-950 text-lg shadow-[0_0_22px_rgba(196,181,253,0.4)] cursor-pointer w-full text-center flex items-center justify-center gap-2",
              loading && "opacity-60 pointer-events-none"
            )}
          >
            {loading ? <Loader2 className="animate-spin mx-auto" /> : "Upload File"}
          </label>
        </div>

        <div className="glass-card p-10 flex flex-col border-white/10">
          <h3 className="text-2xl font-bold text-slate-50 mb-6">Paste Text</h3>
          <textarea 
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="I am a passionate student looking for..."
            className="input-pastel flex-1 min-h-[200px]"
          />
          <button 
            onClick={() => analyzeResume()}
            disabled={!resumeText || loading}
            className="mt-6 btn-pastel bg-neon-cyan text-slate-950 text-lg shadow-[0_0_22px_rgba(114,239,221,0.35)] flex items-center justify-center gap-3"
          >
            {loading ? <Loader2 className="animate-spin" /> : <Palette className="w-5 h-5" />}
            Analyze Now
          </button>
        </div>
      </div>
    </motion.div>
  );

  const renderScreen3 = () => (
    <motion.div
      key="screen-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full max-w-6xl"
    >
      <div className="mb-12 flex flex-wrap gap-4 justify-between items-end">
        <div>
          <h2 className="text-4xl font-black text-slate-50 mb-2 font-rounded">Your Career Vibes</h2>
          <p className="text-slate-300 font-medium text-xl">We found some amazing paths for you! ✨</p>
        </div>
        <button 
          onClick={() => setStep(2)}
          className="btn-pastel bg-dark-surface text-slate-200 border border-white/15 hover:border-neon-cyan/60 hover:text-neon-cyan flex items-center gap-2"
        >
          <RotateCcw className="w-4 h-4" /> Try different resume
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
        {roleSuggestions?.map((role, idx) => (
          <motion.div 
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            whileHover={{ y: -8, scale: 1.02 }}
            className="glass-card p-8 flex flex-col border border-white/10 hover:border-neon-pink/40 transition-colors"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="bg-neon-purple/15 border border-neon-purple/30 p-4 rounded-2xl">
                <Briefcase className="text-neon-purple w-8 h-8" />
              </div>
              <div className="bg-neon-cyan/15 border border-neon-cyan/30 text-neon-cyan px-4 py-1.5 rounded-full text-sm font-black tabular-nums">
                {role.matchPercentage}% Match
              </div>
            </div>
            
            <h3 className="text-2xl font-black text-slate-50 mb-4 font-rounded leading-tight">{role?.title}</h3>
            <p className="text-slate-300 font-medium mb-8 flex-1 leading-relaxed">{role?.matchReason}</p>
            
            <button 
              onClick={() => {
                setSelectedRole(role);
                setStep(4);
              }}
              className="w-full btn-pastel bg-neon-pink/15 text-neon-pink border border-neon-pink/40 hover:bg-neon-pink hover:text-slate-950 hover:shadow-[0_0_24px_rgba(255,143,171,0.4)] flex items-center justify-center gap-2"
            >
              Choose This one <ChevronRight className="w-5 h-5" />
            </button>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );

  const renderScreen4 = () => (
    <motion.div
      key="screen-4"
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="w-full max-w-4xl"
    >
      <div className="mb-10 flex items-center gap-4">
        <button onClick={() => setStep(3)} className="p-3 hover:bg-white/10 rounded-2xl transition-colors cursor-pointer">
          <ArrowLeft className="text-slate-200" />
        </button>
        <h2 className="text-4xl font-black text-slate-50 font-rounded">Skill Check</h2>
      </div>

      <div className="glass-card p-10 mb-10 overflow-hidden relative border-white/10">
        <Doodle className="top-0 right-0 w-40 text-neon-pink opacity-15" />
        
        <div className="flex flex-col md:flex-row items-center gap-12 mb-12 relative z-10">
          <div className="relative w-48 h-48">
            <svg className="w-full h-full transform -rotate-90">
              <circle cx="96" cy="96" r="84" stroke="currentColor" strokeWidth="16" fill="transparent" className="text-white/10" />
              <motion.circle 
                cx="96" cy="96" r="84" stroke="currentColor" strokeWidth="16" fill="transparent"
                strokeDasharray={527}
                initial={{ strokeDashoffset: 527 }}
                animate={{ strokeDashoffset: 527 - (527 * (selectedRole?.readinessPercentage || 0)) / 100 }}
                transition={{ duration: 1.5, ease: "easeOut" }}
                className="text-neon-cyan drop-shadow-[0_0_10px_rgba(114,239,221,0.6)]"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-5xl font-black text-slate-50 font-rounded tabular-nums">{selectedRole?.readinessPercentage}%</span>
              <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Ready</span>
            </div>
          </div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="text-3xl font-black text-slate-50 mb-3 font-rounded">{selectedRole?.title}</h3>
            <p className="text-slate-300 font-medium text-lg italic">
              "You're already doing great! We just need to polish a few things to make you a pro."
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8 relative z-10">
          <div className="bg-neon-cyan/10 p-8 rounded-[32px] border border-neon-cyan/25">
            <h4 className="flex items-center gap-3 font-black text-neon-cyan mb-6 uppercase tracking-wider text-sm">
              <CheckCircle2 className="w-6 h-6" /> Your Superpowers
            </h4>
            <div className="flex flex-wrap gap-3">
              {selectedRole?.existingSkills?.map((s, i) => (
                <span key={i} className="bg-dark-deep/90 text-slate-100 border border-neon-cyan/25 px-5 py-2.5 rounded-2xl text-sm font-bold shadow-sm">
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-neon-peach/10 p-8 rounded-[32px] border border-neon-peach/25">
            <h4 className="flex items-center gap-3 font-black text-neon-peach mb-6 uppercase tracking-wider text-sm">
              <Target className="w-6 h-6" /> Growth Areas
            </h4>
            <div className="flex flex-wrap gap-3">
              {selectedRole?.missingSkills?.map((s, i) => (
                <span key={i} className="bg-dark-deep/90 text-slate-100 border border-neon-peach/25 px-5 py-2.5 rounded-2xl text-sm font-bold shadow-sm">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <button 
        onClick={() => {
          if (selectedRole) generateRoadmap(selectedRole);
        }}
        disabled={loading}
        className="w-full btn-pastel bg-neon-pink text-slate-950 text-2xl py-6 shadow-[0_0_28px_rgba(255,143,171,0.45)] flex items-center justify-center gap-4 group"
      >
        {loading ? <Loader2 className="animate-spin" /> : <Map className="w-7 h-7 group-hover:translate-x-1 transition-transform" />}
        Create My Roadmap!
      </button>
    </motion.div>
  );

  const renderScreen5 = () => {
    if (!roadmap || !roadmap.weeks || roadmap.weeks.length === 0) {
      return renderLoadingState(
        "Creating your map...",
        "Our AI is sketching out your 30-day adventure! ✨"
      );
    }

    const progressValue = calculateProgress();

    return (
      <motion.div
        key="screen-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="w-full max-w-7xl flex flex-col lg:flex-row gap-8 items-start"
      >
        {/* Sidebar */}
        <div className="w-full lg:w-96 space-y-6 lg:sticky lg:top-8">
          <div className="glass-card p-10 border-white/10">
            <h2 className="text-3xl font-black text-slate-50 mb-8 font-rounded">Mission Control</h2>
            
            <div className="bg-dark-deep/90 p-6 rounded-3xl mb-10 border border-neon-purple/25">
              <div className="flex items-center gap-4 mb-4">
                <div className="bg-neon-purple/15 border border-neon-purple/30 p-3 rounded-2xl">
                   <Target className="text-neon-purple w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-neon-purple uppercase tracking-widest">Target Role</p>
                  <p className="font-bold text-slate-100 truncate">{selectedRole?.title}</p>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Progress</p>
                  <p className="text-neon-cyan font-black tabular-nums">{progressValue}%</p>
                </div>
                <div className="h-4 bg-white/10 rounded-full overflow-hidden p-1 shadow-inner">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progressValue}%` }}
                    className="h-full bg-gradient-to-r from-neon-cyan to-neon-purple rounded-full shadow-[0_0_12px_rgba(114,239,221,0.5)]"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <button 
                onClick={startSimulation}
                disabled={loading}
                className="btn-pastel bg-neon-peach text-slate-950 text-lg flex items-center justify-center gap-3 shadow-[0_0_24px_rgba(255,181,138,0.4)]"
              >
                {loading ? <Loader2 className="animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                Quick Simulation
              </button>
              
              <button 
                onClick={resetAndSwitchRole}
                className="btn-pastel bg-dark-deep/90 text-slate-300 border border-white/10 hover:border-white/25 hover:text-white text-sm"
              >
                Restart Journey
              </button>
            </div>
          </div>

          <div className="glass-card bg-gradient-to-br from-neon-purple/20 via-dark-surface to-neon-pink/20 p-8 border border-neon-pink/30 text-slate-100 overflow-hidden relative group">
            <Sparkles className="absolute top-0 right-0 w-24 h-24 text-neon-pink opacity-15 group-hover:scale-110 transition-transform" />
            <h4 className="text-xl font-bold mb-3 flex items-center gap-2 text-neon-pink">
              <RotateCcw className="w-5 h-5" /> Keep it Up!
            </h4>
            <p className="text-slate-300 font-medium leading-relaxed">
              Doing a little bit every day leads to massive results. You've got this! ✨
            </p>
          </div>
        </div>

        {/* Roadmap Content */}
        <div className="flex-1 space-y-16 pb-20 w-full min-w-0">
          <header className="flex items-center gap-6">
            <div className="bg-neon-pink text-slate-950 p-5 rounded-3xl shadow-[0_0_28px_rgba(255,143,171,0.45)] rotate-3">
              <Map className="w-10 h-10" />
            </div>
            <div>
              <h2 className="text-5xl font-black text-slate-50 font-rounded leading-tight">30-Day Masterplan</h2>
              <p className="text-neon-cyan text-xl font-bold flex items-center gap-2">
                 Roadmap to {selectedRole?.title} <Sparkles className="w-5 h-5" />
              </p>
            </div>
          </header>

          {roadmap.weeks.map((week, wIdx) => (
            <section key={wIdx} className="space-y-8">
              <div className="flex items-center gap-6">
                <div className="text-7xl font-rounded font-black text-white/10 italic leading-none tabular-nums">0{week.weekNumber}</div>
                <div className="flex-1 h-1 bg-white/10 rounded-full relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-neon-cyan/40 to-neon-purple/40" />
                </div>
                <div className="bg-dark-surface/90 backdrop-blur-sm px-8 py-3 rounded-3xl border border-neon-purple/40 text-neon-purple font-black uppercase tracking-tight shadow-[0_0_20px_rgba(196,181,253,0.18)]">
                  {week.focus}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {week.days.map((day, dIdx) => (
                  <motion.div 
                    key={dIdx}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: dIdx * 0.05 }}
                    onClick={() => toggleDayCompletion(wIdx, dIdx)}
                    className={cn(
                      "glass-card p-6 cursor-pointer transition-all group hover:scale-[1.02] relative",
                      day.completed
                        ? "bg-neon-cyan/10 border-neon-cyan/40 shadow-[0_0_20px_rgba(114,239,221,0.15)]"
                        : "border-white/10 hover:border-neon-purple/40"
                    )}
                  >
                    <div className="flex flex-col h-full">
                      <div className="flex justify-between items-center mb-4">
                        <span className={cn(
                          "text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest tabular-nums",
                          day.completed
                            ? "bg-neon-cyan text-slate-950"
                            : "bg-neon-purple/20 text-neon-purple border border-neon-purple/30"
                        )}>
                          Day {day.day}
                        </span>
                        {day.completed && <CheckCircle2 className="w-5 h-5 text-neon-cyan" />}
                      </div>
                      
                      <h4 className={cn(
                        "font-bold text-xl text-slate-100 mb-6 leading-snug font-rounded",
                        day.completed && "line-through opacity-55"
                      )}>
                        {day.goal}
                      </h4>

                      <div className="mt-auto flex justify-between items-center bg-dark-deep/75 p-2 rounded-2xl border border-white/10">
                        <a 
                          href={
                            /^https?:\/\//i.test(day.resource)
                              ? day.resource
                              : `https://www.google.com/search?q=${encodeURIComponent(day.resource || day.goal)}`
                          }
                          target="_blank" rel="noreferrer" 
                          onClick={e => e.stopPropagation()}
                          className="text-[10px] font-black text-neon-cyan hover:text-neon-pink flex items-center gap-1 uppercase tracking-widest px-3 py-1 transition-colors"
                        >
                          Learn <ExternalLink className="w-3 h-3" />
                        </a>
                        <div className={cn(
                          "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors",
                          day.completed ? "bg-neon-cyan border-neon-cyan text-slate-950" : "border-white/25"
                        )}>
                          {day.completed && <CheckCircle2 className="w-3 h-3" />}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {week.weeklySimulation && (
                <div className="bg-[#0c1226] text-slate-100 p-10 rounded-[44px] border border-neon-peach/35 relative overflow-hidden group shadow-[0_0_32px_rgba(255,181,138,0.12)]">
                  <motion.div 
                    animate={{ rotate: [0, 10, 0] }}
                    transition={{ duration: 4, repeat: Infinity }}
                    className="absolute top-[-20%] right-[-10%] opacity-10 pointer-events-none"
                  >
                    <Star className="w-64 h-64 text-neon-peach" />
                  </motion.div>
                  
                  <div className="relative z-10">
                    <span className="bg-neon-peach/15 text-neon-peach px-5 py-2 rounded-2xl text-xs font-black mb-6 inline-block uppercase tracking-[0.3em] border border-neon-peach/30">
                      Weekly Challenge
                    </span>
                    <h3 className="text-3xl font-black mb-4 font-rounded text-slate-50">{week.weeklySimulation.title}</h3>
                    <p className="text-slate-300 mb-10 max-w-2xl text-lg font-medium leading-relaxed italic">
                      {week.weeklySimulation.description}
                    </p>
                    <button 
                      onClick={() => setActiveWeeklyChallenge(week.weeklySimulation)}
                      className="btn-pastel bg-neon-peach text-slate-950 text-lg px-10 shadow-[0_0_24px_rgba(255,181,138,0.45)] hover:scale-105"
                    >
                      Start Challenge ✨
                    </button>
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      </motion.div>
    );
  };

  const renderScreen6 = () => {
    if (!simulation || simulation.length === 0) {
      return renderLoadingState("Setting the scene...", "Preparing real-world job scenarios for you! 🎭");
    }

    const currentSim = simulation[simStep];
    const isLast = simStep === simulation.length - 1;

    return (
      <motion.div
        key="screen-6"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-4xl"
      >
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setStep(5)} className="p-3 hover:bg-white/10 rounded-2xl transition-colors cursor-pointer">
              <ArrowLeft className="text-slate-200" />
            </button>
            <h2 className="text-4xl font-black text-slate-50 font-rounded">Role Play</h2>
          </div>
          <div className="bg-dark-surface px-6 py-2 rounded-full border border-neon-cyan/35 font-black text-sm text-neon-cyan uppercase tracking-widest shadow-[0_0_18px_rgba(114,239,221,0.18)] tabular-nums">
            Scene {simStep + 1} / {simulation.length}
          </div>
        </div>

        <div className="glass-card p-12 overflow-hidden relative border-white/10">
          <Sun className="absolute -top-10 -right-10 w-48 h-48 text-neon-yellow opacity-10 doodle-spin" />
          
          <div className="relative z-10">
            <h3 className="text-3xl font-black text-slate-50 mb-8 font-rounded flex items-center gap-3">
              <Sparkles className="text-neon-peach" /> {currentSim?.title}
            </h3>
            
            <div className="bg-dark-deep/90 p-8 rounded-[40px] mb-12 border border-white/10 italic text-xl text-slate-200 leading-relaxed font-rounded">
              "{currentSim?.situation}"
            </div>

            <div className="grid gap-4 mb-8">
              {currentSim?.options?.map((opt, i) => (
                <motion.button 
                  key={i}
                  whileHover={{ x: 10 }}
                  disabled={simFeedback !== null}
                  onClick={() => handleSimAnswer(i)}
                  className={cn(
                    "w-full text-left p-6 rounded-3xl border font-bold transition-all flex justify-between items-center shadow-sm cursor-pointer",
                    simFeedback !== null 
                      ? (i === currentSim.correctIndex
                          ? "bg-neon-cyan/15 border-neon-cyan text-neon-cyan shadow-[0_0_20px_rgba(114,239,221,0.2)]"
                          : "bg-white/5 border-transparent text-slate-400 opacity-50")
                      : "bg-dark-deep/80 border-white/15 text-slate-100 hover:border-neon-pink/60 hover:bg-dark-surface"
                  )}
                >
                  <span className="text-lg">{opt}</span>
                  {!simFeedback ? <ChevronRight className="w-5 h-5 text-slate-400" /> : (i === currentSim.correctIndex ? <CheckCircle2 className="w-6 h-6" /> : null)}
                </motion.button>
              ))}
            </div>

            <AnimatePresence>
              {simFeedback && (
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="bg-dark-deep border border-neon-purple/35 text-slate-100 p-10 rounded-[44px] shadow-2xl relative overflow-hidden"
                >
                  <Doodle className="bottom-0 left-0 w-32 text-neon-purple opacity-10" />
                  
                  {simFeedback === "SUCCESS_COMPLETE" ? (
                    <div className="text-center relative z-10">
                      <div className="bg-neon-cyan w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-8 shadow-[0_0_28px_rgba(114,239,221,0.45)]">
                        <CheckCircle2 className="w-12 h-12 text-slate-950" />
                      </div>
                      <h3 className="text-4xl font-black mb-4 font-rounded text-slate-50">Mission Accomplished!</h3>
                      <p className="text-slate-300 text-xl mb-10 max-w-sm mx-auto font-medium">
                        You're ready for the big stage! High fives all around. 🙌
                      </p>
                      <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <button 
                          onClick={() => setStep(5)}
                          className="btn-pastel bg-white/10 hover:bg-white/20 text-white text-lg px-10 border border-white/15"
                        >
                          Back to Roadmap
                        </button>
                        <button 
                          onClick={resetAndSwitchRole}
                          className="btn-pastel bg-neon-pink text-slate-950 text-lg px-10 shadow-[0_0_24px_rgba(255,143,171,0.4)] flex items-center justify-center gap-3"
                        >
                          New Journey <RotateCcw className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="bg-neon-purple/20 p-2 rounded-xl border border-neon-purple/30">
                          <Bell className="text-neon-purple w-5 h-5" />
                        </div>
                        <span className="text-xs font-black uppercase tracking-[0.3em] text-neon-purple">Guru Insight</span>
                      </div>
                      <p className="text-2xl font-rounded italic mb-10 leading-relaxed font-bold text-slate-100">
                        "{simFeedback}"
                      </p>
                      <button 
                        onClick={nextSimOrFinish}
                        className="btn-pastel bg-neon-pink text-slate-950 text-lg px-12 shadow-[0_0_24px_rgba(255,143,171,0.4)] flex items-center gap-3"
                      >
                        {isLast ? "Review Results" : "Next Scene"} 
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-dark-canvas font-sans text-slate-100 p-6 md:p-12 transition-colors duration-500 relative z-0">
      {/* Dynamic Background Doodles */}
      <FloatingDoodle icon={Flower} className="top-10 left-10" color="text-neon-pink" />
      <FloatingDoodle icon={Heart} className="top-40 right-20" color="text-neon-purple" />
      <FloatingDoodle icon={Sun} className="bottom-20 left-[15%]" color="text-neon-peach" />
      <FloatingDoodle icon={Cloud} className="top-60 left-[30%]" color="text-neon-cyan" />
      <FloatingDoodle icon={Sparkles} className="bottom-[15%] right-[10%]" color="text-neon-pink" />
      <FloatingDoodle icon={Sticker} className="top-[10%] left-[45%]" color="text-neon-blue" />

      {/* Dynamic Ambient Dark-Blue & Pastel Neon Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-20">
        <div className="absolute top-[-15%] left-[-10%] w-[55%] h-[55%] bg-[#1d2b64] rounded-full blur-[130px] opacity-55" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[50%] bg-neon-purple/20 rounded-full blur-[130px] opacity-60" />
        <div className="absolute top-[35%] right-[20%] w-[35%] h-[35%] bg-neon-cyan/10 rounded-full blur-[120px] opacity-50" />
      </div>

      <nav className="max-w-6xl mx-auto mb-20 flex justify-between items-center relative z-10 gap-8">
        <div className="flex items-center gap-4 group cursor-pointer shrink-0" onClick={() => setStep(1)}>
          <div className="bg-neon-pink text-slate-950 p-3 rounded-2xl shadow-[0_0_24px_rgba(255,143,171,0.45)] group-hover:scale-110 group-hover:-rotate-3 transition-all">
            <Target className="w-7 h-7" />
          </div>
          <span className="text-3xl font-black tracking-tight text-slate-50 font-rounded whitespace-nowrap">Skill<span className="text-neon-pink">Radar</span></span>
        </div>
        
        <div className="hidden md:flex items-center gap-3 bg-dark-surface/90 backdrop-blur-md p-2 rounded-2xl border border-white/10 shadow-xl">
          <div className={cn(
            "px-6 py-2 rounded-xl transition-all font-bold text-xs uppercase tracking-widest whitespace-nowrap shrink-0",
            step === 2
              ? "bg-neon-cyan text-slate-950 shadow-[0_0_20px_rgba(114,239,221,0.45)]"
              : "text-slate-400"
          )}>1. Upload</div>
          <ChevronRight className="w-4 h-4 text-slate-600" />
          <div className={cn(
            "px-6 py-2 rounded-xl transition-all font-bold text-xs uppercase tracking-widest whitespace-nowrap shrink-0",
            (step === 3 || step === 4)
              ? "bg-neon-purple text-slate-950 shadow-[0_0_20px_rgba(196,181,253,0.45)]"
              : "text-slate-400"
          )}>2. Discover</div>
          <ChevronRight className="w-4 h-4 text-slate-600" />
          <div className={cn(
            "px-6 py-2 rounded-xl transition-all font-bold text-xs uppercase tracking-widest whitespace-nowrap shrink-0",
            step >= 5
              ? "bg-neon-pink text-slate-950 shadow-[0_0_20px_rgba(255,143,171,0.45)]"
              : "text-slate-400"
          )}>3. Master</div>
        </div>

        <button
          onClick={() => setStep(roadmap ? 5 : 2)}
          title={roadmap ? "View Roadmap" : "Upload Resume"}
          className="bg-dark-surface p-4 rounded-3xl shadow-lg border border-neon-purple/35 hover:border-neon-cyan/60 transition-all active:scale-90 cursor-pointer shrink-0"
        >
          <GraduationCap className="text-neon-purple" />
        </button>
      </nav>

      <main className={cn(
        "max-w-6xl mx-auto flex justify-center min-h-[60vh] w-full relative z-10",
        (step === 5 || step === 6) ? "items-start" : "items-center"
      )}>
        <AnimatePresence mode="wait">
          {step === 1 && renderScreen1()}
          {step === 2 && renderScreen2()}
          {step === 3 && renderScreen3()}
          {step === 4 && renderScreen4()}
          {step === 5 && renderScreen5()}
          {step === 6 && renderScreen6()}
        </AnimatePresence>
      </main>

      {/* Weekly Challenge Modal */}
      <AnimatePresence>
        {activeWeeklyChallenge && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/75 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-dark-surface w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden border border-neon-purple/35 flex flex-col"
            >
              <div className="bg-gradient-to-r from-neon-pink/25 via-neon-purple/25 to-neon-cyan/20 p-8 text-slate-50 relative border-b border-white/10">
                <Doodle className="top-0 right-0 w-32 text-neon-pink/20" />
                <span className="bg-neon-pink/20 border border-neon-pink/40 text-neon-pink px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest mb-4 inline-block">Weekly Performance Task</span>
                <h3 className="text-3xl font-black font-rounded">{activeWeeklyChallenge.title}</h3>
              </div>
              <div className="p-10">
                <p className="text-slate-200 leading-relaxed text-xl mb-8 font-medium italic">
                  "{activeWeeklyChallenge.description}"
                </p>
                
                <div className="bg-neon-peach/10 p-6 rounded-3xl mb-8 border border-neon-peach/25">
                  <h4 className="font-black text-neon-peach mb-2 flex items-center gap-2 uppercase tracking-widest text-xs">
                    <Bell className="w-4 h-4" /> Ready to Submit?
                  </h4>
                  <p className="text-sm text-slate-300 font-medium">
                    This is a self-assessment task. Work on the scenario described above, and when you feel confident in your solution, mark it as completed.
                  </p>
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => setActiveWeeklyChallenge(null)}
                    className="flex-1 btn-pastel bg-white/5 text-slate-300 border border-white/15 hover:bg-white/10"
                  >
                    Maybe later
                  </button>
                  <button 
                    onClick={() => {
                      showToast("success", "Achievement Unlocked! You've successfully navigated this week's challenge. 🌟");
                      setActiveWeeklyChallenge(null);
                    }}
                    className="flex-1 btn-pastel bg-neon-cyan text-slate-950 shadow-[0_0_24px_rgba(114,239,221,0.4)] flex items-center justify-center gap-2"
                  >
                    Mission Complete <CheckCircle2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* In-app Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -30, opacity: 0 }}
            className={cn(
              "fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[90%] p-5 rounded-3xl shadow-2xl border flex items-start gap-4 backdrop-blur-xl",
              toast.type === "error"
                ? "bg-[#220e18]/95 border-neon-pink/60 text-neon-pink"
                : "bg-[#0d1c29]/95 border-neon-cyan/60 text-neon-cyan"
            )}
          >
            <div className={cn(
              "p-2 rounded-2xl shrink-0 text-slate-950",
              toast.type === "error" ? "bg-neon-pink" : "bg-neon-cyan"
            )}>
              {toast.type === "error" ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            </div>
            <p className="flex-1 text-sm font-bold leading-relaxed pt-1 text-slate-100">{toast.message}</p>
            <button
              onClick={() => setToast(null)}
              className="p-1.5 rounded-xl hover:bg-white/10 transition-colors shrink-0 text-slate-300 cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

