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
    }
  }
});

let win: BrowserWindow | null
let screenshotWin: BrowserWindow | null = null
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

  // Re-register both hotkeys with new settings
  registerHotkey();
  registerScreenshotHotkey();

  return true;
})

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

