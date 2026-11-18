import express from "express";
import multer from "multer";
import cors from "cors";
import mammoth from "mammoth";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

interface MulterRequest extends express.Request {
  file?: Express.Multer.File;
}

const GEMINI_MODEL = "gemini-4-hydrogen";

const handleApiError = (res: express.Response, error: any, message: string) => {
  console.error(`${message}:`, error);
  const status = typeof error?.status === "number" ? error.status : 500;
  const details = error instanceof Error ? error.message : String(error);
  if (status === 401 || status === 403 || details.includes("API_KEY_INVALID") || details.includes("PERMISSION_DENIED")) {
    return res.status(status >= 400 && status < 600 ? status : 403).json({
      error: "Gemini API key is missing or invalid on the server. Please set GEMINI_API_KEY in your environment secrets.",
      details,
    });
  }
  if (status === 429 || details.includes("RESOURCE_EXHAUSTED")) {
    return res.status(429).json({
      error: "The AI service is temporarily busy. Please wait a few seconds and try again.",
      details,
    });
  }
  res.status(500).json({ error: `${message}: ${details}`, details });
};

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is not configured on the server (GEMINI_API_KEY).");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function generateWithRetry(ai: GoogleGenAI, params: any, maxAttempts = 3) {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      lastError = err;
      const status = typeof err?.status === "number" ? err.status : 0;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("fetch failed");

      if (!isRetryable || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = 600 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
      console.warn(`Gemini attempt ${attempt} failed (${status || msg}), retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function safeParseJson(rawText: string | undefined): any {
  const trimmed = (rawText ?? "{}").trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const match = unfenced.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("Model returned an invalid JSON response.");
  }
}

function isPdfFile(file: Express.Multer.File): boolean {
  const mime = (file.mimetype || "").toLowerCase();
  const name = (file.originalname || "").toLowerCase();
  const header = file.buffer.subarray(0, 5).toString("ascii");
  return mime === "application/pdf" || mime === "application/x-pdf" || name.endsWith(".pdf") || header === "%PDF-";
}

function createApiApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  const uploadSingleResume = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    upload.single("resume")(req, res, (err: any) => {
      if (err) {
        return res.status(400).json({ error: err?.message || "Failed to read uploaded file." });
      }
      next();
    });
  };

  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  const apiRouter = express.Router();

  apiRouter.get("/ping", (req, res) => {
    res.json({ pong: true, time: new Date().toISOString() });
  });

  apiRouter.get("/health", (req, res) => {
    res.json({
      status: "ok",
      environment: process.env.VERCEL ? "vercel" : "local",
      hasApiKey: !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY),
    });
  });

  apiRouter.post("/analyze-resume", uploadSingleResume, async (req: express.Request, res: express.Response) => {
    const mReq = req as MulterRequest;
    console.log(
      "Analyzing resume. Method:",
      mReq.method,
      "File:",
      mReq.file ? `${mReq.file.originalname} (${mReq.file.mimetype}, ${mReq.file.size} bytes)` : "No file"
    );

    try {
      let text = "";
      let pdfBufferForGemini: Buffer | null = null;

      if (mReq.file) {
        if (mReq.file.size === 0) {
          return res.status(400).json({ error: "The uploaded file is empty. Please choose a valid resume file." });
        }
        const mime = (mReq.file.mimetype || "").toLowerCase();
        const name = (mReq.file.originalname || "").toLowerCase();

        if (isPdfFile(mReq.file)) {
          pdfBufferForGemini = mReq.file.buffer;
        } else if (
          mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          mime === "application/msword" ||
          name.endsWith(".docx") ||
          name.endsWith(".doc")
        ) {
          const result = await mammoth.extractRawText({ buffer: mReq.file.buffer });
          text = result.value;
        } else if (mime === "text/plain" || name.endsWith(".txt")) {
          text = mReq.file.buffer.toString("utf-8");
        } else {
          const fallback = mReq.file.buffer.toString("utf-8");
          if (fallback && fallback.trim().length >= 10) {
            text = fallback;
          } else {
            return res
              .status(400)
              .json({ error: `Unsupported file type: ${mime || name}. Please upload a PDF, DOCX, or TXT file.` });
          }
        }
      } else if (req.body?.text) {
        text = String(req.body.text);
      }

      if (!pdfBufferForGemini && (!text || text.trim().length < 10)) {
        return res.status(400).json({
          error: "Could not extract enough text from the resume. Please try a different file (PDF, DOCX, TXT) or paste your resume text.",
        });
      }

      const ai = getAiClient();

      const baseInstruction = `Analyze the provided resume and suggest 5 suitable career paths/roles for a student. For each role, provide:
      1. Role Title
      2. Match Percentage (0-100)
      3. Brief explanation why it matches.
      4. Skills found in resume that match this role.
      5. Essential skills missing from the resume for this role.
      6. Overall Readiness Percentage (0-100).`;

      const responseSchema = {
        type: Type.OBJECT,
        required: ["roles"],
        properties: {
          roles: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: [
                "title",
                "matchPercentage",
                "matchReason",
                "existingSkills",
                "missingSkills",
                "readinessPercentage",
              ],
              properties: {
                title: { type: Type.STRING },
                matchPercentage: { type: Type.NUMBER },
                matchReason: { type: Type.STRING },
                existingSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
                missingSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
                readinessPercentage: { type: Type.NUMBER },
              },
            },
          },
        },
      };

      let response;
      if (pdfBufferForGemini) {
        const parts: any[] = [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBufferForGemini.toString("base64"),
            },
          },
          { text: baseInstruction },
        ];

        response = await generateWithRetry(ai, {
          model: GEMINI_MODEL,
          contents: { parts },
          config: {
            responseMimeType: "application/json",
            responseSchema,
          },
        });
      } else {
        response = await generateWithRetry(ai, {
          model: GEMINI_MODEL,
          contents: `${baseInstruction}\n\nResume content:\n${text}`,
          config: {
            responseMimeType: "application/json",
            responseSchema,
          },
        });
      }

      res.json(safeParseJson(response.text));
    } catch (error) {
      handleApiError(res, error, "Failed to analyze resume");
    }
  });

  apiRouter.post("/generate-roadmap", async (req, res) => {
    const { role, currentSkills = [], missingSkills = [] } = req.body ?? {};
    if (!role) {
      return res.status(400).json({ error: "Target role is required." });
    }

    try {
      const ai = getAiClient();
      const response = await generateWithRetry(ai, {
        model: GEMINI_MODEL,
        contents: `Create a highly accurate 30-day learning roadmap for a student to become a "${role}".
      They currently have these skills: ${Array.isArray(currentSkills) ? currentSkills.join(", ") : ""}
      They need to acquire: ${Array.isArray(missingSkills) ? missingSkills.join(", ") : ""}
      
      Structure the roadmap by week (4 weeks).
      IMPORTANT: Each week MUST contain 7-8 unique daily goals. Total should be 30 days.
      Each day item MUST have:
      - day: specific number (1-30)
      - goal: a clear learning objective
      - resource: an actual URL to a free learning resource. PREFER YouTube (channels like Traversy Media, Fireship, etc.), NPTEL, or MDN. DO NOT use Coursera.
      
      At the end of each week, provide a "weeklySimulation" which is a MINI-PROJECT or SPECIFIC SCENARIO based STRICTLY on that week's focus.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            required: ["weeks"],
            properties: {
              weeks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  required: ["weekNumber", "focus", "days", "weeklySimulation"],
                  properties: {
                    weekNumber: { type: Type.NUMBER },
                    focus: { type: Type.STRING },
                    days: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        required: ["day", "goal", "resource"],
                        properties: {
                          day: { type: Type.NUMBER },
                          goal: { type: Type.STRING },
                          resource: { type: Type.STRING },
                        },
                      },
                    },
                    weeklySimulation: {
                      type: Type.OBJECT,
                      required: ["title", "description"],
                      properties: {
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      res.json(safeParseJson(response.text));
    } catch (error) {
      handleApiError(res, error, "Failed to generate roadmap");
    }
  });

  apiRouter.post("/get-simulation", async (req, res) => {
    const { role } = req.body ?? {};
    if (!role) {
      return res.status(400).json({ error: "Target role is required." });
    }

    try {
      const ai = getAiClient();
      const response = await generateWithRetry(ai, {
        model: GEMINI_MODEL,
        contents: `Generate 6 practical job simulation scenarios for the role: "${role}".
      Each scenario should have:
      1. Scenario Title
      2. Detailed Situation
      3. Multiple Choice Options (4) for how to handle it.
      4. Correct Answer Index (0-3)
      5. Feedback for each option (array of 4 strings matching the 4 options).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            required: ["scenarios"],
            properties: {
              scenarios: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  required: ["title", "situation", "options", "correctIndex", "feedbacks"],
                  properties: {
                    title: { type: Type.STRING },
                    situation: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctIndex: { type: Type.NUMBER },
                    feedbacks: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                },
              },
            },
          },
        },
      });

      res.json(safeParseJson(response.text));
    } catch (error) {
      handleApiError(res, error, "Failed to generate simulation");
    }
  });

  app.use("/api", apiRouter);

  // Catch unmatched /api/* routes
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route ${req.method} ${req.url} not found` });
  });

  return app;
}

const app = createApiApp();
export default app;
