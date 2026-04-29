> **Superseded.** This was an inspiration sketch for the in-browser-inference
> direction. The current product is a local-only Brave side-panel extension —
> see [`v1.6 brave-extension plan.md`](./v1.6%20brave-extension%20plan.md).

BrowserAI
AI inference running entirely in the browser — no server, no API keys.

What it does
Five AI demos running client-side using WebGPU and WebAssembly:

Image Classification — Drop an image, get top-5 predictions via MobileNet (Transformers.js)
Semantic Search — Type a query, find semantically similar sentences from a corpus using BGE text embeddings (Transformers.js)
LLM Chat — Chat with Llama 3.2 1B (4-bit quantized) running in a browser tab via WebLLM (requires WebGPU)
Computer Vision — Real-time hand tracking and gesture recognition via webcam using MediaPipe HandLandmarker
Speech to Text — Record audio and transcribe it using Moonshine (Transformers.js)
How it works
Models are downloaded from Hugging Face Hub and Google's CDN on first use, then cached in the browser's Cache API. After that, everything runs locally — no network required.

Heavy inference runs in Web Workers to keep the UI responsive. Four of the five demos offload computation to dedicated workers. MediaPipe runs on the main thread (it needs direct video element access but processes each frame in under 5 ms).

User clicks "Load Model"
  → Worker downloads model from HF Hub / Google CDN (~14 MB to ~700 MB depending on demo)
  → Model cached in browser Cache API
  → Worker sends progress updates to main thread via postMessage
  → Main thread updates Zustand store → React re-renders progress bar

User provides input (image, text, audio, webcam)
  → Main thread sends input to Worker
  → Worker runs inference
  → Worker sends results back via postMessage
  → Main thread renders results
Tech stack
React 19, Zustand, Tailwind CSS v4, Vite, TypeScript. Inference via Transformers.js, WebLLM, and MediaPipe.

Running locally
npm install
npm run dev
Requires a browser with WebGPU support for the LLM Chat demo (Chrome 113+, Edge 113+). The other four demos fall back to WebAssembly and work in any modern browser.

Ideas for new demos
A few directions to expand this:

Background Removal — Remove image backgrounds client-side with a before/after slider (@imgly/background-removal is already installed)
Object Detection — Draw bounding boxes and labels on uploaded images or live webcam using YOLO or DETR
Text to Speech — Generate speech from text using a model like Kokoro or SpeechT5
Image Captioning — Describe uploaded images using a vision-language model like Florence-2
Text Summarization — Paste an article or long text and get a summary
Translation — Translate text between languages using NLLB or Opus-MT
Sentiment Analysis — Classify the sentiment of text input
Depth Estimation — Upload a photo and generate a depth map using Depth Anything
Face Detection / Landmarks — Detect faces and facial landmarks in images or webcam
Code Generation — Small code-completion model running in-browser for simple snippet