import { app, BrowserWindow, globalShortcut, screen, ipcMain, clipboard, shell, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { exec } from 'node:child_process'
import { translate as bingTranslate } from 'bing-translate-api'
import Store from 'electron-store'
import OpenAI from 'openai'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Define Store Schema
type StoreType = {
  hotkey: string;
  theme: 'system' | 'light' | 'dark';
  targetLang: string; // 'auto' | 'zh' | 'en' ...
  source: 'bing' | 'openai' | 'custom';
  openai: {
    apiKey: string;
    baseURL: string;
    model: string;
  };
  screenshotTranslation: {
    enabled: boolean;
    hotkey: string;
    ocrSource: 'system' | 'glm';  // system = macOS Vision, glm = GLM-4V
    glmApiKey: string;
  };
  screenshotExplain: {
    enabled: boolean;
    hotkey: string;
    model: {
      provider: 'glm' | 'openai';
      apiKey: string;
      baseURL: string;
      modelName: string;
    };
    defaultLanguage: 'zh' | 'en';
    customPrompts?: {
      systemPrompt?: string;
      summaryPrompt?: string;
      questionPrompt?: string;
    };
  };
  explainHistory: Array<{
    id: string;
    imagePath: string;
    timestamp: number;
    messages: Array<{ role: string; content: string }>;
  }>;
}

const store = new Store<StoreType>({
  defaults: {
    hotkey: 'Command+Option+T',
    theme: 'system',
    targetLang: 'auto',
    source: 'bing',
    openai: {
      apiKey: '',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    },
    screenshotTranslation: {
      enabled: true,
      hotkey: 'Command+Shift+A',
      ocrSource: 'system',  // Default to system OCR (offline)
      glmApiKey: ''
    },
    screenshotExplain: {
      enabled: true,
      hotkey: 'Command+Shift+E',
      model: {
        provider: 'glm',
        apiKey: '',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        modelName: 'glm-4v-flash'
      },
      defaultLanguage: 'zh'
    },
    explainHistory: []
  }
});

let win: BrowserWindow | null
let screenshotWin: BrowserWindow | null = null
let explainWin: BrowserWindow | null = null
let tray: Tray | null

function createWindow() {
  const iconPath = path.join(process.env.VITE_PUBLIC, 'icon.png');
  // fallback if png not found, use svg
  const icon = nativeImage.createFromPath(iconPath);

  try {
    if (app.dock) app.dock.hide(); // Hide from Dock for "Menu Bar App" feel
  } catch (e) { }

  win = new BrowserWindow({
    width: 360,
    height: 120, // Initial compact size
    icon: icon,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function registerHotkey() {
  globalShortcut.unregisterAll()
  const hotkey = store.get('hotkey');

  try {
    const ret = globalShortcut.register(hotkey, () => {
      console.log('Global Shortcut Triggered')
      if (!win) return

      if (win.isVisible() && !win.isFocused()) {
        win.focus();
        return;
      }

      if (win.isVisible()) {
        win.hide()
        app.hide()
      } else {
        const point = screen.getCursorScreenPoint()
        const display = screen.getDisplayNearestPoint(point)

        const x = Math.min(Math.max(point.x, display.bounds.x), display.bounds.x + display.bounds.width - 360)
        const y = Math.min(Math.max(point.y + 20, display.bounds.y), display.bounds.y + display.bounds.height - 120) // Use 120 or current height?

        win.setPosition(x, y)
        win.show()
        win.focus()
      }
    });

    if (!ret) {
      console.error('Registration failed for:', hotkey)
    } else {
      console.log('Registered hotkey:', hotkey)
    }

  } catch (e) {
    console.error('Invalid hotkey:', hotkey)
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  createWindow()
  registerHotkey()
  registerScreenshotHotkey()
  registerExplainHotkey()

  // Tray Setup
  const iconPath = path.join(process.env.VITE_PUBLIC, 'icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon)
  tray.setToolTip('Translation Utility')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Translator',
      click: () => {
        if (!win) return;
        win.show();
        win.focus();
      }
    },
    {
      label: 'Settings',
      click: () => {
        if (!win) return;
        win.show();
        win.focus();
        // Tell renderer to open settings
        win.webContents.send('open-settings');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit', click: () => {
        app.quit();
      }
    }
  ])

  tray.setContextMenu(contextMenu)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// --- IPC Handlers ---

ipcMain.on('close-window', () => {
  // If we are in settings mode (height is large), maybe just shrink?
  // Simpler: Just hide everything.
  win?.hide()
  app.hide()
})

ipcMain.on('close-screenshot-window', () => {
  screenshotWin?.close()
})


ipcMain.on('resize-window', (_event, width, height) => {
  win?.setSize(width, height);
})

ipcMain.on('commit-translation', (_event, text) => {
  clipboard.writeText(text)
  win?.hide()
  app.hide()

  setTimeout(() => {
    exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, (error) => {
      if (error) console.error('Paste failed:', error)
    })
  }, 150)
})

// Settings IPC
ipcMain.handle('get-settings', () => {
  return store.store;
})

ipcMain.handle('save-settings', (_event, newSettings) => {
  store.set(newSettings);

  // Unregister all hotkeys first
  globalShortcut.unregisterAll();

  // Re-register all hotkeys with new settings
  registerHotkey();
  registerScreenshotHotkey();
  registerExplainHotkey();

  return true;
})

ipcMain.on('hide-window', () => {
  win?.hide();
});

ipcMain.on('open-external', (_event, url) => {
  shell.openExternal(url);
})

// Translation Logic
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
})

ipcMain.handle('translate-text', async (_event, text) => {
  const source = store.get('source');
  const targetLangPref = store.get('targetLang');
  const trimmed = text.trim();
  if (!trimmed) return "";

  // Determine Target Language
  let targetLang = 'en';
  const hasChinese = /[\u4e00-\u9fa5]/.test(trimmed);

  if (targetLangPref === 'auto') {
    targetLang = hasChinese ? 'en' : 'zh-Hans';
  } else {
    targetLang = targetLangPref;
    // Minor fix for bing language codes (zh-Hans vs zh)
    if (targetLang === 'zh') targetLang = 'zh-Hans';
  }

  // 1. Bing
  if (source === 'bing') {
    try {
      const res = await bingTranslate(trimmed, null, targetLang);
      return res?.translation || "Bing Error";
    } catch (e) {
      console.error("Bing Error:", e);
      return "Bing Fail";
    }
  }

  // 2. OpenAI / DeepSeek / Zhipu
  if (source === 'openai') {
    const config = store.get('openai');
    if (!config.apiKey) return "Missing API Key";

    try {
      const openai = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        dangerouslyAllowBrowser: false
      });

      // Prompt Engineering
      let langName = targetLang;
      if (targetLang === 'zh-Hans') langName = 'Simplified Chinese';
      if (targetLang === 'en') langName = 'English';
      if (targetLang === 'ja') langName = 'Japanese';
      if (targetLang === 'ko') langName = 'Korean';

      const prompt = `Translate the following text to ${langName}. Only output the translation, no explanation. Text: "${trimmed}"`;

      const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: config.model || "gpt-3.5-turbo",
      });

      return completion.choices[0]?.message?.content?.trim() || "AI Error";
    } catch (e: any) {
      console.error("AI API Error:", e);
      return `API Error: ${e.message}`;
    }
  }

  return "Unknown Source";
})

// ========== Screenshot Translation ==========

function createScreenshotWindow() {
  if (screenshotWin) return;

  const iconPath = path.join(process.env.VITE_PUBLIC, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  screenshotWin = new BrowserWindow({
    width: 500,
    height: 400,
    icon: icon,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  screenshotWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (VITE_DEV_SERVER_URL) {
    screenshotWin.loadURL(VITE_DEV_SERVER_URL + '?mode=screenshot')
  } else {
    screenshotWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: 'screenshot' })
  }

  screenshotWin.on('close', () => {
    screenshotWin = null;
  });
}

async function callGLM4V(imagePath: string, apiKey: string): Promise<string> {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'glm-4v-flash',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: '请识别图片中的所有文字内容，按行返回。只输出文字，不要其他解释。'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`
              }
            }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'GLM API Error');
    }

    return data.choices[0]?.message?.content || '';
  } catch (error: any) {
    console.error('GLM-4V Error:', error);
    throw error;
  }
}

async function callSystemOCR(imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use Swift to call macOS Vision framework
    const swiftScript = `
import Foundation
import Vision
import AppKit

let imagePath = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("Error: Could not load image")
    exit(1)
}

let request = VNRecognizeTextRequest { request, error in
    guard let observations = request.results as? [VNRecognizedTextObservation] else {
        print("")
        exit(0)
    }
    
    let recognizedStrings = observations.compactMap { observation in
        observation.topCandidates(1).first?.string
    }
    
    print(recognizedStrings.joined(separator: "\\n"))
    exit(0)
}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])

RunLoop.main.run(until: Date(timeIntervalSinceNow: 10))
`;

    // Write Swift script to temp file
    const scriptPath = path.join(app.getPath('temp'), 'ocr_script.swift');
    fs.writeFileSync(scriptPath, swiftScript);

    // Compile and run Swift script
    const outputPath = path.join(app.getPath('temp'), 'ocr_binary');

    exec(`swiftc "${scriptPath}" -o "${outputPath}" && "${outputPath}" "${imagePath}"`, (error, stdout, stderr) => {
      // Clean up
      try {
        fs.unlinkSync(scriptPath);
        fs.unlinkSync(outputPath);
      } catch (e) {
        // Ignore cleanup errors
      }

      if (error) {
        console.error('System OCR Error:', stderr || error.message);
        reject(new Error('系统OCR识别失败: ' + (stderr || error.message)));
        return;
      }

      const recognizedText = stdout.trim();
      if (!recognizedText) {
        resolve('未识别到文字');
        return;
      }

      resolve(recognizedText);
    });
  });
}

async function translateTextHelper(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const source = store.get('source');
  const targetLang = store.get('targetLang');

  if (source === 'bing' || !source) {
    try {
      const hasChinese = /[\u4e00-\u9fa5]/.test(trimmed);
      const lang = targetLang === 'auto' ? (hasChinese ? 'en' : 'zh-Hans') : targetLang;

      const res = await bingTranslate(trimmed, null, lang);
      return res?.translation || trimmed;
    } catch (e) {
      console.error("Bing Error:", e);
      return trimmed;
    }
  }

  if (source === 'openai') {
    const config = store.get('openai');
    if (!config.apiKey) return trimmed;

    try {
      const openai = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });

      const prompt = `Translate the following text. Only output the translation:\n\n${trimmed}`;

      const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: config.model || "deepseek-chat",
      });

      return completion.choices[0]?.message?.content?.trim() || trimmed;
    } catch (e: any) {
      console.error("AI Error:", e);
      return trimmed;
    }
  }

  return trimmed;
}

function registerScreenshotHotkey() {
  const config = store.get('screenshotTranslation');
  if (!config.enabled) return;

  const hotkey = config.hotkey;

  try {
    const ret = globalShortcut.register(hotkey, async () => {
      console.log('Screenshot Hotkey Triggered');

      win?.hide();
      app.hide();

      setTimeout(() => {
        const tempPath = path.join(app.getPath('temp'), `screenshot-${Date.now()}.png`);

        exec(`screencapture -i "${tempPath}"`, async (error) => {
          app.show();

          if (error) {
            console.error('Screenshot cancelled or failed');
            return;
          }

          if (!fs.existsSync(tempPath)) {
            console.log('Screenshot cancelled');
            return;
          }

          console.log('Screenshot captured');

          const config = store.get('screenshotTranslation');
          const ocrSource = config.ocrSource || 'system';

          // Check API key only if using GLM
          if (ocrSource === 'glm' && !config.glmApiKey) {
            console.error('GLM API Key not configured');
            return;
          }

          if (!screenshotWin) {
            createScreenshotWindow();
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          screenshotWin?.webContents.send('screenshot-processing');
          screenshotWin?.show();
          screenshotWin?.focus();

          try {
            let recognizedText: string;

            // Choose OCR method based on config
            if (ocrSource === 'system') {
              console.log('Using system OCR (Vision framework)');
              recognizedText = await callSystemOCR(tempPath);
            } else {
              console.log('Using GLM-4V OCR');
              recognizedText = await callGLM4V(tempPath, config.glmApiKey);
            }

            console.log('Recognized:', recognizedText.substring(0, 100) + '...');

            const translatedText = await translateTextHelper(recognizedText);
            console.log('Translated:', translatedText.substring(0, 100) + '...');

            screenshotWin?.webContents.send('screenshot-result', {
              original: recognizedText,
              translated: translatedText
            });

          } catch (err: any) {
            console.error('Processing error:', err);
            screenshotWin?.webContents.send('screenshot-error', err.message);
          } finally {
            try {
              fs.unlinkSync(tempPath);
            } catch (e) {
              // Ignore
            }
          }
        });
      }, 300);
    });

    if (!ret) {
      console.error('Screenshot hotkey failed:', hotkey);
    } else {
      console.log('Registered screenshot hotkey:', hotkey);
    }
  } catch (e) {
    console.error('Invalid screenshot hotkey:', hotkey);
  }
}

// ============================================
// Screenshot Explanation Functions
// ============================================

// Create Screenshot Explanation Window
function createExplainWindow(imagePath: string) {
  if (explainWin) {
    explainWin.focus();
    return;
  }

  explainWin = new BrowserWindow({
    width: 700,
    height: 800,
    resizable: true,
    frame: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  explainWin.on('closed', () => {
    explainWin = null;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    explainWin.loadURL(`${process.env.VITE_DEV_SERVER_URL}#explain?image=${encodeURIComponent(imagePath)}`);
  } else {
    const distPath = process.env.DIST || path.join(__dirname, '../dist');
    explainWin.loadFile(path.join(distPath, 'index.html'), {
      hash: `explain?image=${encodeURIComponent(imagePath)}`
    });
  }
}

// Call Vision API (GLM-4V or OpenAI compatible)
async function callVisionAPI(imagePath: string, messages: Array<{ role: string, content: any }>, language: string): Promise<string> {
  const config = store.get('screenshotExplain');
  const { provider, apiKey, baseURL, modelName } = config.model;

  // Read and encode image
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');

  // System prompt based on language (will be prepended to first user message)
  const defaultSystemPrompt = language === 'zh'
    ? '你是一个图片分析助手。请用自然流畅的语言回答，不要使用小标题、序号或分点列举。\n\n'
    : 'You are an image analysis assistant. Please respond naturally without headings, bullet points, or numbered lists.\n\n';

  const systemPrompt = config.customPrompts?.systemPrompt || defaultSystemPrompt;

  // Build API messages
  const apiMessages = messages.map((msg, index) => {
    if (msg.role === 'user' && index === 0) {
      // First user message includes the image
      // Prepend system prompt to first user message (GLM doesn't support system role)
      const userText = systemPrompt + msg.content;

      return {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${imageBase64}`
            }
          },
          {
            type: 'text',
            text: userText
          }
        ]
      };
    }
    return msg;
  });

  // Construct API URL
  let apiUrl = baseURL;
  if (provider === 'glm') {
    apiUrl = `${baseURL}/chat/completions`;
  } else {
    // OpenAI compatible
    apiUrl = `${baseURL}/chat/completions`;
  }

  // Make API call
  const requestBody: any = {
    model: modelName,
    messages: apiMessages,  // No system role for GLM
    temperature: 0.7
  };

  // Only add max_tokens for OpenAI, not GLM
  if (provider === 'openai') {
    requestBody.max_tokens = 2000;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vision API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Get initial summary for an image
async function getInitialSummary(imagePath: string, language: string): Promise<string> {
  const config = store.get('screenshotExplain');

  const defaultPrompt = language === 'zh'
    ? '你是一个图片分析助手。请简洁地总结这张图片的主要内容，不要使用小标题、序号或分点列举。\n\n要求：\n- 用1-3句话概括图片核心内容\n- 语言自然流畅，像在和朋友描述\n- 突出最重要的信息\n- 不要使用"图片显示..."这样的开头\n\n请用中文回复。'
    : 'You are an image analysis assistant. Please provide a concise summary of this image\'s main content without using headings, bullet points, or numbered lists.\n\nRequirements:\n- Summarize in 1-3 natural sentences\n- Write conversationally as if describing to a friend\n- Highlight the most important information\n- Don\'t start with "The image shows..."\n\nPlease respond in English.';

  const prompt = config.customPrompts?.summaryPrompt || defaultPrompt;

  const messages = [
    { role: 'user', content: prompt }
  ];

  return await callVisionAPI(imagePath, messages, language);
}

// Register Screenshot Explanation Hotkey
function registerExplainHotkey() {
  const config = store.get('screenshotExplain');
  if (!config.enabled) {
    return;
  }

  const hotkey = config.hotkey;


  try {
    globalShortcut.unregister(hotkey);

    const ret = globalShortcut.register(hotkey, () => {
      console.log('Explain Hotkey Triggered');

      // Hide main window
      win?.hide();

      // Take screenshot
      const tempImagePath = path.join(app.getPath('temp'), `explain-screenshot-${Date.now()}.png`);

      exec(`screencapture -i "${tempImagePath}"`, async (error) => {
        if (error) {
          console.error('Screenshot error:', error);
          win?.show();
          return;
        }

        // Check if file exists (user might have cancelled)
        if (!fs.existsSync(tempImagePath)) {
          console.log('Screenshot cancelled');
          win?.show();
          return;
        }

        try {
          // Create explain window with image path
          createExplainWindow(tempImagePath);
        } catch (err) {
          console.error('Error creating explain window:', err);
          win?.show();
        }
      });
    });

    if (!ret) {
      console.error('Explain hotkey failed:', hotkey);
    } else {
      console.log('Registered explain hotkey:', hotkey);
    }
  } catch (e) {
    console.error('Invalid explain hotkey:', hotkey);
  }
}

// IPC Handlers for Screenshot Explanation
ipcMain.handle('explain-get-initial-summary', async (_event, imagePath: string) => {
  const language = store.get('screenshotExplain').defaultLanguage;
  try {
    const summary = await getInitialSummary(imagePath, language);
    return { success: true, summary };
  } catch (error: any) {
    console.error('Error getting initial summary:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('explain-ask-question', async (_event, imagePath: string, messages: Array<{ role: string, content: string }>) => {
  const language = store.get('screenshotExplain').defaultLanguage;
  try {
    // Build conversation with question prompt
    const questionPrompt = language === 'zh'
      ? `你是一个图片分析助手。用户正在询问关于这张图片的问题。\n\n要求：\n- 直接回答问题，不要使用小标题或分点列举\n- 语言自然、简洁\n- 基于图片内容回答\n- 如果问题与图片无关，礼貌地引导回到图片内容\n\n请用中文回复。`
      : `You are an image analysis assistant. The user is asking a question about this image.\n\nRequirements:\n- Answer directly without headings or bullet points\n- Be natural and concise\n- Base your answer on the image content\n- If the question is unrelated to the image, politely guide back\n\nPlease respond in English.`;

    const lastUserMessage = messages[messages.length - 1];
    const userQuestion = lastUserMessage.content;

    const apiMessages = messages.slice(0, -1).concat([
      { role: 'user', content: `${questionPrompt}\n\n用户问题：${userQuestion}` }
    ]);

    const response = await callVisionAPI(imagePath, apiMessages, language);
    return { success: true, response };
  } catch (error: any) {
    console.error('Error asking question:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('explain-read-image', async (_event, imagePath: string) => {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    return { success: true, data: `data:image/png;base64,${base64}` };
  } catch (error: any) {
    console.error('Error reading image:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.on('close-explain-window', () => {
  if (explainWin) {
    explainWin.close();
    explainWin = null;
  }
});

// Save explanation to history (max 5 records)
ipcMain.handle('explain-save-history', async (_event, _imagePath: string, messages: Array<{ role: string; content: string }>) => {
  try {
    const history = store.get('explainHistory') || [];
    const newRecord = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      messages  // Only save messages, no images
    };

    // Add to beginning and keep only last 5
    const updatedHistory = [newRecord, ...history].slice(0, 5);
    store.set('explainHistory', updatedHistory);

    console.log('History saved, total:', updatedHistory.length);
    return { success: true };
  } catch (error: any) {
    console.error('Error saving history:', error);
    return { success: false, error: error.message };
  }
});

// Get explanation history
ipcMain.handle('explain-get-history', async () => {
  try {
    const history = store.get('explainHistory') || [];
    return { success: true, history };
  } catch (error: any) {
    console.error('Error getting history:', error);
    return { success: false, error: error.message, history: [] };
  }
});

// Load a specific history record
ipcMain.handle('explain-load-history', async (_event, historyId: string) => {
  try {
    const history = store.get('explainHistory') || [];
    const record = history.find(h => h.id === historyId);

    if (!record) {
      return { success: false, error: 'History not found' };
    }

    return { success: true, record };
  } catch (error: any) {
    console.error('Error loading history:', error);
    return { success: false, error: error.message };
  }
});

