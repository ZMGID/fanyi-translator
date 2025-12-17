
import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, X, Save } from 'lucide-react'

type SettingsData = {
    hotkey: string;
    theme: 'system' | 'light' | 'dark';
    targetLang: string;
    source: 'bing' | 'openai';
    openai: {
        apiKey: string;
        baseURL: string;
        model: string;
    };
}

interface SettingsProps {
    onClose: () => void;
    onSettingsChange: () => void; // Trigger app to reload settings
}

export default function Settings({ onClose, onSettingsChange }: SettingsProps) {
    const [settings, setSettings] = useState<SettingsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [appVersion, setAppVersion] = useState('');

    useEffect(() => {
        if (window.ipcRenderer) {
            window.ipcRenderer.invoke('get-settings').then((data: SettingsData) => {
                setSettings(data);
                setLoading(false);
            });
            window.ipcRenderer.invoke('get-app-version').then((ver: string) => {
                setAppVersion(ver);
            });
        }
    }, []);

    const handleSave = async () => {
        if (!settings || !window.ipcRenderer) return;
        await window.ipcRenderer.invoke('save-settings', settings);
        onSettingsChange();
        onClose();
    };

    if (loading || !settings) return <div className="p-4 text-gray-500">Loading...</div>;

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 p-4 select-none">
            <div className="flex justify-between items-center mb-4 border-b dark:border-gray-700 pb-2"
                style={{ WebkitAppRegion: 'drag' } as any}>
                <h2 className="font-bold text-lg flex items-center gap-2">
                    <SettingsIcon size={18} /> Settings
                </h2>
                <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500"
                    style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <X size={20} />
                </button>
            </div>

            <div className="flex-1 overflow-auto space-y-4 px-1">

                {/* Visual Settings */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Theme</label>
                        <select
                            className="w-full p-2 border dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-sm"
                            value={settings.theme || 'system'}
                            onChange={(e) => setSettings({ ...settings, theme: e.target.value as any })}
                        >
                            <option value="system">Follow System</option>
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Target Language</label>
                        <select
                            className="w-full p-2 border dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-sm"
                            value={settings.targetLang || 'auto'}
                            onChange={(e) => setSettings({ ...settings, targetLang: e.target.value })}
                        >
                            <option value="auto">Auto (ZH ↔ EN)</option>
                            <option value="en">English (En)</option>
                            <option value="zh">Chinese (Zh)</option>
                            <option value="ja">Japanese (Ja)</option>
                            <option value="ko">Korean (Ko)</option>
                            <option value="fr">French (Fr)</option>
                            <option value="de">German (De)</option>
                        </select>
                    </div>
                </div>

                <div className="border-t dark:border-gray-700 my-2"></div>

                {/* Hotkey */}
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Shortcut</label>
                    <input
                        className="w-full p-2 border dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-800 text-sm font-mono"
                        value={settings.hotkey}
                        onChange={(e) => setSettings({ ...settings, hotkey: e.target.value })}
                        placeholder="Command+Option+T"
                    />
                </div>

                {/* Source Selection */}
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Translation Engine</label>
                    <select
                        className="w-full p-2 border dark:border-gray-700 rounded bg-white dark:bg-gray-800"
                        value={settings.source}
                        onChange={(e) => setSettings({ ...settings, source: e.target.value as any })}
                    >
                        <option value="bing">Bing Translate (Free)</option>
                        <option value="openai">DeepSeek / Zhipu / OpenAI (AI)</option>
                    </select>
                </div>

                {/* AI Configuration */}
                {settings.source === 'openai' && (
                    <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded border border-blue-100 dark:border-gray-700">
                        <div>
                            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Base URL</label>
                            <input
                                className="w-full p-2 border dark:border-gray-700 rounded text-sm font-mono dark:bg-gray-900"
                                value={settings.openai.baseURL}
                                onChange={(e) => setSettings({ ...settings, openai: { ...settings.openai, baseURL: e.target.value } })}
                                placeholder="https://api.deepseek.com/v1"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">API Key</label>
                            <input
                                type="password"
                                className="w-full p-2 border dark:border-gray-700 rounded text-sm font-mono dark:bg-gray-900"
                                value={settings.openai.apiKey}
                                onChange={(e) => setSettings({ ...settings, openai: { ...settings.openai, apiKey: e.target.value } })}
                                placeholder="sk-..."
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Model Name</label>
                            <input
                                className="w-full p-2 border dark:border-gray-700 rounded text-sm font-mono dark:bg-gray-900"
                                value={settings.openai.model}
                                onChange={(e) => setSettings({ ...settings, openai: { ...settings.openai, model: e.target.value } })}
                                placeholder="deepseek-chat"
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="pt-4 mt-2 border-t dark:border-gray-700 flex justify-between items-center">
                <div className="text-xs text-gray-400">
                    Ver: {appVersion}
                </div>
                <div className="flex gap-2">
                    <button onClick={onClose} className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
                    <button onClick={handleSave} className="px-3 py-1 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 flex items-center gap-1">
                        <Save size={14} /> Save
                    </button>
                </div>
            </div>
        </div>
    )
}
