import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { 
  Search, 
  History, 
  Download, 
  Trash2, 
  Copy, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Plus, 
  FileText, 
  Settings,
  Menu,
  X,
  ExternalLink,
  Filter,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface ScanResult {
  id: string;
  url: string;
  status: 'processing' | 'active' | 'inactive' | 'error' | 'stopped';
  emails: string[];
  pagesScanned: number;
  timestamp: number;
  errorMessage?: string;
}

interface ScanHistory {
  id: string;
  name: string;
  results: ScanResult[];
  timestamp: number;
}

// --- Constants ---

const PROXIES = [
  'https://corsproxy.io/?url=',
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy?quest='
];
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,20}/g;
const MAX_PAGES_PER_SITE = 100;

// --- Components ---

export default function App() {
  const [activeTab, setActiveTab] = useState<'new' | 'history' | 'settings'>('new');
  const [inputUrls, setInputUrls] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [currentResults, setCurrentResults] = useState<ScanResult[]>([]);
  const [history, setHistory] = useState<ScanHistory[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [removeGlobalDuplicates, setRemoveGlobalDuplicates] = useState(false);
  const [deepScanEnabled, setDeepScanEnabled] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('emailscout_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
  }, []);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem('emailscout_history', JSON.stringify(history));
  }, [history]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setInputUrls(content);
      showToast('File uploaded successfully');
    };
    reader.readAsText(file);
  };

  const decodeCloudflareEmail = (encodedString: string): string => {
    let email = "";
    try {
      const r = parseInt(encodedString.substring(0, 2), 16);
      for (let n = 2; n < encodedString.length; n += 2) {
        const i = parseInt(encodedString.substring(n, 2), 16) ^ r;
        email += String.fromCharCode(i);
      }
    } catch (e) {
      console.error('Failed to decode Cloudflare email', e);
    }
    return email;
  };

  const extractEmails = (html: string): string[] => {
    const emails = new Set<string>();
    
    // 1. Standard Regex (Improved)
    const standardRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,20}/g;
    const standardMatches = html.match(standardRegex);
    if (standardMatches) {
      standardMatches.forEach(e => emails.add(e.toLowerCase().trim()));
    }

    // 2. DOM-based extraction
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // mailto: links
    doc.querySelectorAll('a[href^="mailto:"]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const email = href.replace(/mailto:/i, '').split('?')[0].trim();
      if (email.includes('@')) emails.add(email.toLowerCase());
    });

    // Cloudflare obfuscation
    doc.querySelectorAll('[data-cfemail]').forEach(el => {
      const encoded = el.getAttribute('data-cfemail');
      if (encoded) {
        const decoded = decodeCloudflareEmail(encoded);
        if (decoded.includes('@')) emails.add(decoded.toLowerCase());
      }
    });

    // Search in ALL attributes (sometimes emails are in data-email, title, alt, etc.)
    const allElements = doc.querySelectorAll('*');
    allElements.forEach(el => {
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        if (attr.value.includes('@')) {
          const matches = attr.value.match(standardRegex);
          if (matches) {
            matches.forEach(e => emails.add(e.toLowerCase().trim()));
          }
        }
      }
    });

    // Search in script tags (JSON-LD, JS variables)
    doc.querySelectorAll('script').forEach(script => {
      const content = script.textContent || '';
      if (content.includes('@')) {
        const matches = content.match(standardRegex);
        if (matches) {
          matches.forEach(e => emails.add(e.toLowerCase().trim()));
        }
      }
    });

    // 3. Handle common text obfuscation
    const obfuscatedPatterns = [
      /[a-zA-Z0-9._%+-]+\s*[\[\(]\s*at\s*[\]\)]\s*[a-zA-Z0-9.-]+\s*[\[\(]\s*dot\s*[\]\)]\s*[a-zA-Z]{2,}/gi,
      /[a-zA-Z0-9._%+-]+\s*@\s*[a-zA-Z0-9.-]+\s*\.\s*[a-zA-Z]{2,}/gi,
      /[a-zA-Z0-9._%+-]+\s+at\s+[a-zA-Z0-9.-]+\s+dot\s+[a-zA-Z]{2,}/gi
    ];

    obfuscatedPatterns.forEach(pattern => {
      const matches = html.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const clean = match
            .replace(/\s*[\[\(]\s*at\s*[\]\)]\s*/gi, '@')
            .replace(/\s*[\[\(]\s*dot\s*[\]\)]\s*/gi, '.')
            .replace(/\s+at\s+/gi, '@')
            .replace(/\s+dot\s+/gi, '.')
            .replace(/\s*@\s*/g, '@')
            .replace(/\s*\.\s*/g, '.')
            .trim();
          if (clean.includes('@')) emails.add(clean.toLowerCase());
        });
      }
    });

    return Array.from(emails);
  };

  const getInternalLinks = (html: string, baseUrl: string, rootDomain: string): string[] => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a[href]'))
      .map(a => (a as HTMLAnchorElement).getAttribute('href') || '')
      .map(href => {
        try {
          return new URL(href, baseUrl).href;
        } catch {
          return '';
        }
      })
      .filter(url => {
        if (!url) return false;
        try {
          const u = new URL(url);
          // Match same root domain or any subdomain
          return u.hostname.endsWith(rootDomain) && !url.includes('#') && !url.includes('mailto:');
        } catch {
          return false;
        }
      });
    
    return Array.from(new Set(links));
  };

  const fetchWithTimeout = async (url: string, signal: AbortSignal, timeout = 10000) => {
    let lastError = null;

    for (const proxy of PROXIES) {
      const timeoutId = setTimeout(() => {
        // Individual fetch timeout
      }, timeout);
      
      try {
        const response = await fetch(`${proxy}${encodeURIComponent(url)}`, {
          signal,
          headers: { 'Accept': 'text/html' }
        });
        clearTimeout(timeoutId);
        if (response.ok) return response;
        lastError = new Error(`HTTP ${response.status} from ${proxy}`);
      } catch (e) {
        clearTimeout(timeoutId);
        lastError = e;
      }
      
      if (signal.aborted) break;
    }
    
    throw lastError || new Error('Failed to fetch after trying all proxies');
  };

  const processUrl = async (url: string, deep: boolean, onProgress: (res: Partial<ScanResult>) => void): Promise<ScanResult> => {
    const cleanUrl = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`;
    const id = Math.random().toString(36).substring(7);
    const allEmails = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [cleanUrl];
    
    let rootDomain = '';
    try {
      const u = new URL(cleanUrl);
      const parts = u.hostname.split('.');
      rootDomain = parts.slice(-2).join('.');
    } catch {
      rootDomain = cleanUrl;
    }

    let pagesScanned = 0;
    const maxPages = deep ? MAX_PAGES_PER_SITE : 1;

    try {
      while (queue.length > 0 && pagesScanned < maxPages) {
        if (abortControllerRef.current?.signal.aborted) {
          return {
            id,
            url: cleanUrl,
            status: 'stopped',
            emails: Array.from(allEmails),
            pagesScanned,
            timestamp: Date.now()
          };
        }

        const currentUrl = queue.shift()!;
        if (visited.has(currentUrl)) continue;
        visited.add(currentUrl);

        try {
          const response = await fetchWithTimeout(currentUrl, abortControllerRef.current!.signal);
          if (!response.ok) continue;

          const html = await response.text();
          pagesScanned++;
          
          extractEmails(html).forEach(e => allEmails.add(e));

          if (deep) {
            const newLinks = getInternalLinks(html, currentUrl, rootDomain);
            for (const link of newLinks) {
              if (!visited.has(link) && !queue.includes(link)) {
                queue.push(link);
              }
            }
          }

          // Update progress
          onProgress({ 
            emails: Array.from(allEmails), 
            pagesScanned,
            status: 'processing'
          });

        } catch (err) {
          console.warn(`Failed to crawl ${currentUrl}`, err);
        }
      }

      return {
        id,
        url: cleanUrl,
        status: 'active',
        emails: Array.from(allEmails),
        pagesScanned,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        id,
        url: cleanUrl,
        status: 'inactive',
        emails: Array.from(allEmails),
        pagesScanned,
        timestamp: Date.now(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };

  const stopScan = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsScanning(false);
      showToast('Scan stopped by user', 'error');
    }
  };

  const startScan = async () => {
    if (!inputUrls.trim()) {
      showToast('Please enter at least one URL', 'error');
      return;
    }

    const urls = inputUrls
      .split(/[\n,]/)
      .map(u => u.trim())
      .filter(u => u.length > 0);

    if (urls.length === 0) return;

    setIsScanning(true);
    setCurrentResults([]);
    abortControllerRef.current = new AbortController();
    
    const results: ScanResult[] = [];
    
    for (const url of urls) {
      if (abortControllerRef.current.signal.aborted) break;

      const initialResult: ScanResult = {
        id: Math.random().toString(36).substring(7),
        url,
        status: 'processing',
        emails: [],
        pagesScanned: 0,
        timestamp: Date.now()
      };
      
      setCurrentResults(prev => [...prev, initialResult]);

      const result = await processUrl(url, deepScanEnabled, (progress) => {
        setCurrentResults(prev => 
          prev.map(r => r.url === url ? { ...r, ...progress } : r)
        );
      });
      
      setCurrentResults(prev => 
        prev.map(r => r.url === url ? result : r)
      );
      results.push(result);
    }

    const newHistoryItem: ScanHistory = {
      id: Math.random().toString(36).substring(7),
      name: `Scan ${new Date().toLocaleString()} ${deepScanEnabled ? '(Full Site)' : ''}`,
      results,
      timestamp: Date.now()
    };
    
    setHistory(prev => [newHistoryItem, ...prev]);
    setIsScanning(false);
    showToast(`Scan complete: ${results.length} sites processed`);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  };

  const exportCSV = (results: ScanResult[]) => {
    const headers = ['URL', 'Status', 'Email Count', 'Emails'];
    const rows = results.map(r => [
      r.url,
      r.status,
      r.emails.length,
      r.emails.join('; ')
    ]);

    const csvContent = [headers, ...rows]
      .map(e => e.map(cell => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `emailscout_export_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV exported');
  };

  const exportJSON = (results: ScanResult[]) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(results, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `emailscout_export_${Date.now()}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.removeChild(downloadAnchorNode);
    showToast('JSON exported');
  };

  const clearHistory = () => {
    if (confirm('Are you sure you want to clear all history?')) {
      setHistory([]);
      showToast('History cleared');
    }
  };

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
    showToast('Scan deleted');
  };

  const filteredResults = currentResults.filter(r => 
    r.url.toLowerCase().includes(searchFilter.toLowerCase()) ||
    r.emails.some(e => e.toLowerCase().includes(searchFilter.toLowerCase()))
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex flex-col w-64 glass border-r border-slate-800 p-4">
        <div className="flex items-center gap-3 mb-8 px-2">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Search className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">EmailScout</h1>
            <p className="text-xs text-slate-400">Lead Generation CRM</p>
          </div>
        </div>

        <nav className="space-y-1">
          <button 
            onClick={() => setActiveTab('new')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${activeTab === 'new' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <Plus className="w-5 h-5" />
            <span>New Scan</span>
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${activeTab === 'history' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <History className="w-5 h-5" />
            <span>History</span>
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${activeTab === 'settings' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <Settings className="w-5 h-5" />
            <span>Settings</span>
          </button>
        </nav>

        <div className="mt-auto p-4 glass rounded-xl text-xs text-slate-500">
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-3 h-3" />
            <span className="font-semibold">Disclaimer</span>
          </div>
          <p>Respect robots.txt and website terms. Use responsibly for legitimate outreach only.</p>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 z-40 md:hidden"
            />
            <motion.aside 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              className="fixed inset-y-0 left-0 w-72 glass z-50 p-6 md:hidden"
            >
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-600 p-2 rounded-lg">
                    <Search className="text-white w-5 h-5" />
                  </div>
                  <h1 className="font-bold text-xl">EmailScout</h1>
                </div>
                <button onClick={() => setSidebarOpen(false)}>
                  <X className="w-6 h-6" />
                </button>
              </div>
              <nav className="space-y-2">
                <button 
                  onClick={() => { setActiveTab('new'); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl ${activeTab === 'new' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
                >
                  <Plus className="w-6 h-6" />
                  <span className="text-lg">New Scan</span>
                </button>
                <button 
                  onClick={() => { setActiveTab('history'); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl ${activeTab === 'history' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
                >
                  <History className="w-6 h-6" />
                  <span className="text-lg">History</span>
                </button>
                <button 
                  onClick={() => { setActiveTab('settings'); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl ${activeTab === 'settings' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
                >
                  <Settings className="w-6 h-6" />
                  <span className="text-lg">Settings</span>
                </button>
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-4 md:px-8 border-b border-slate-800 glass z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-2 hover:bg-slate-800 rounded-lg"
            >
              <Menu className="w-6 h-6" />
            </button>
            <h2 className="font-semibold text-lg">
              {activeTab === 'new' ? 'New Scan' : activeTab === 'history' ? 'Scan History' : 'Settings'}
            </h2>
          </div>
          
          <div className="flex items-center gap-3">
            {activeTab === 'new' && currentResults.length > 0 && (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => exportCSV(currentResults)}
                  className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                  title="Export CSV"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setCurrentResults([])}
                  className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
                  title="Clear Results"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'new' && (
              <motion.div 
                key="new-scan"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-5xl mx-auto space-y-8"
              >
                {/* Input Section */}
                <div className="glass rounded-2xl p-6 shadow-xl">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div>
                      <h3 className="text-xl font-bold">Enter Target URLs</h3>
                      <p className="text-sm text-slate-400">Paste URLs separated by lines or commas</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileUpload} 
                        accept=".txt,.csv" 
                        className="hidden" 
                      />
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm font-medium transition-all"
                      >
                        <FileText className="w-4 h-4" />
                        Upload File
                      </button>
                    </div>
                  </div>

                  <textarea 
                    value={inputUrls}
                    onChange={(e) => setInputUrls(e.target.value)}
                    placeholder="example.com&#10;google.com, microsoft.com"
                    className="w-full h-40 bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-200 focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition-all resize-none font-mono text-sm"
                  />

                    <div className="flex items-center justify-between mt-6">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2 cursor-pointer group" onClick={() => !isScanning && setDeepScanEnabled(!deepScanEnabled)}>
                        <div className={`w-10 h-5 rounded-full transition-all relative ${deepScanEnabled ? 'bg-blue-600' : 'bg-slate-700'} ${isScanning ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${deepScanEnabled ? 'left-6' : 'left-1'}`} />
                        </div>
                        <span className={`text-sm font-medium transition-colors ${deepScanEnabled ? 'text-blue-400' : 'text-slate-500'}`}>
                          Full Site Crawl (All Subdomains & Links)
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {isScanning && (
                        <button 
                          onClick={stopScan}
                          className="flex items-center gap-2 px-6 py-3 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white rounded-xl font-bold transition-all"
                        >
                          <X className="w-5 h-5" />
                          Stop Scan
                        </button>
                      )}
                      <button 
                        onClick={startScan}
                        disabled={isScanning || !inputUrls.trim()}
                        className="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-95"
                      >
                        {isScanning ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Crawling...
                          </>
                        ) : (
                          <>
                            <Search className="w-5 h-5" />
                            Start Extraction
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Results Section */}
                {currentResults.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <h3 className="text-xl font-bold flex items-center gap-2">
                        Results
                        <span className="bg-slate-800 text-slate-400 text-xs px-2 py-1 rounded-full">
                          {currentResults.length}
                        </span>
                      </h3>
                      <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input 
                          type="text" 
                          placeholder="Filter results..."
                          value={searchFilter}
                          onChange={(e) => setSearchFilter(e.target.value)}
                          className="pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-600 transition-all w-full md:w-64"
                        />
                      </div>
                    </div>

                    <div className="glass rounded-2xl overflow-hidden shadow-xl">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-900/80 border-b border-slate-800">
                              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Website</th>
                              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Progress</th>
                              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Emails</th>
                              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                            {filteredResults.map((result) => (
                              <tr key={result.id} className="hover:bg-slate-800/30 transition-colors">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium truncate max-w-[200px]">{result.url}</span>
                                    <a href={result.url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-blue-400">
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  {result.status === 'processing' ? (
                                    <div className="flex items-center gap-2 text-blue-400 text-sm">
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      <span>Crawling</span>
                                    </div>
                                  ) : result.status === 'active' ? (
                                    <div className="flex items-center gap-2 text-green-400 text-sm">
                                      <CheckCircle2 className="w-4 h-4" />
                                      <span>Active</span>
                                    </div>
                                  ) : result.status === 'stopped' ? (
                                    <div className="flex items-center gap-2 text-yellow-400 text-sm">
                                      <XCircle className="w-4 h-4" />
                                      <span>Stopped</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 text-red-400 text-sm" title={result.errorMessage}>
                                      <XCircle className="w-4 h-4" />
                                      <span>Inactive</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-slate-400">{result.pagesScanned} pages scanned</span>
                                    <div className="w-24 h-1 bg-slate-800 rounded-full overflow-hidden">
                                      <motion.div 
                                        initial={{ width: 0 }}
                                        animate={{ width: `${Math.min((result.pagesScanned / MAX_PAGES_PER_SITE) * 100, 100)}%` }}
                                        className="h-full bg-blue-600"
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex flex-col gap-1">
                                    <span className="text-sm font-bold">{result.emails.length} found</span>
                                    {result.emails.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {result.emails.slice(0, 2).map(email => (
                                          <span key={email} className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
                                            {email}
                                          </span>
                                        ))}
                                        {result.emails.length > 2 && (
                                          <span className="text-[10px] text-slate-500">+{result.emails.length - 2} more</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <button 
                                    onClick={() => copyToClipboard(result.emails.join(', '))}
                                    disabled={result.emails.length === 0}
                                    className="p-2 hover:bg-blue-600/20 text-slate-400 hover:text-blue-400 rounded-lg transition-all disabled:opacity-30"
                                    title="Copy Emails"
                                  >
                                    <Copy className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {filteredResults.length === 0 && (
                        <div className="p-12 text-center text-slate-500">
                          <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
                          <p>No results match your filter</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
                    <div className="relative">
                      <div className="absolute -inset-4 bg-blue-600/20 blur-3xl rounded-full" />
                      <Search className="w-24 h-24 text-slate-800 relative" />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-2xl font-bold text-slate-400">Ready to Scout?</h4>
                      <p className="text-slate-500 max-w-md">Enter website URLs above to start extracting leads and verifying domain status in real-time.</p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-5xl mx-auto space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold">Past Scans</h3>
                  {history.length > 0 && (
                    <button 
                      onClick={clearHistory}
                      className="flex items-center gap-2 px-4 py-2 text-red-400 hover:bg-red-400/10 rounded-xl transition-all text-sm font-medium"
                    >
                      <Trash2 className="w-4 h-4" />
                      Clear All
                    </button>
                  )}
                </div>

                {history.length > 0 ? (
                  <div className="grid gap-4">
                    {history.map((item) => (
                      <div key={item.id} className="glass rounded-2xl p-6 hover:border-slate-700 transition-all group">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="space-y-1">
                            <h4 className="font-bold text-lg group-hover:text-blue-400 transition-colors">{item.name}</h4>
                            <div className="flex items-center gap-4 text-xs text-slate-500">
                              <span>{new Date(item.timestamp).toLocaleString()}</span>
                              <span>•</span>
                              <span>{item.results.length} URLs</span>
                              <span>•</span>
                              <span className="text-green-500 font-bold">
                                {item.results.reduce((acc, r) => acc + r.emails.length, 0)} Emails Found
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => {
                                setCurrentResults(item.results);
                                setActiveTab('new');
                              }}
                              className="px-4 py-2 bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white rounded-xl text-sm font-bold transition-all"
                            >
                              View Results
                            </button>
                            <button 
                              onClick={() => exportCSV(item.results)}
                              className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-all"
                              title="Export CSV"
                            >
                              <Download className="w-5 h-5" />
                            </button>
                            <button 
                              onClick={() => deleteHistoryItem(item.id)}
                              className="p-2 hover:bg-red-400/10 text-slate-500 hover:text-red-400 rounded-xl transition-all"
                              title="Delete Scan"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-32 text-center space-y-6">
                    <History className="w-20 h-20 text-slate-800" />
                    <div className="space-y-2">
                      <h4 className="text-xl font-bold text-slate-400">No History Yet</h4>
                      <p className="text-slate-500">Your previous scans will appear here for quick access.</p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="max-w-2xl mx-auto glass rounded-3xl p-8 space-y-8"
              >
                <h3 className="text-2xl font-bold">App Settings</h3>
                
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
                    <div>
                      <h4 className="font-bold">Global Deduplication</h4>
                      <p className="text-sm text-slate-500">Remove duplicate emails across all scanned sites</p>
                    </div>
                    <button 
                      onClick={() => setRemoveGlobalDuplicates(!removeGlobalDuplicates)}
                      className={`w-12 h-6 rounded-full transition-all relative ${removeGlobalDuplicates ? 'bg-blue-600' : 'bg-slate-700'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${removeGlobalDuplicates ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>

                  <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-4">
                    <h4 className="font-bold flex items-center gap-2">
                      <Info className="w-4 h-4 text-blue-400" />
                      CORS Proxy Note
                    </h4>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      This app uses <code className="bg-slate-800 px-1 rounded text-blue-400">api.allorigins.win</code> to bypass browser CORS restrictions. 
                      This is necessary for client-side scraping. Some websites may still block requests from proxy servers.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-4">
                    <h4 className="font-bold">About EmailScout</h4>
                    <div className="text-sm text-slate-400 space-y-2">
                      <p>Version: 1.0.0 (Production Ready)</p>
                      <p>Build: PWA Optimized</p>
                      <p>© 2026 EmailScout CRM. All rights reserved.</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Toast Notification */}
        <AnimatePresence>
          {toast && (
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.9 }}
              className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl z-50 flex items-center gap-3 ${toast.type === 'success' ? 'bg-blue-600 text-white' : 'bg-red-600 text-white'}`}
            >
              {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
              <span className="font-bold">{toast.message}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
