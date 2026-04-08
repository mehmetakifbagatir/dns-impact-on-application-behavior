import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area
} from 'recharts';
import { 
  Activity, 
  Network, 
  Gauge, 
  Clock, 
  Play, 
  Square, 
  RotateCcw, 
  Download, 
  Cpu,
  Zap,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  Plug,
  LineChart as LineChartIcon,
  Terminal,
  Table as TableIcon
} from 'lucide-react';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

// MetricCard Component
const MetricCard = ({ icon: Icon, label, value, unit, color = 'cyan' }) => (
  <div className="panel p-4" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`}>
    <div className="flex items-center gap-2 mb-2">
      <Icon size={16} className="text-[#A1A1AA]" />
      <span className="font-mono text-xs uppercase tracking-[0.2em] text-[#A1A1AA]">{label}</span>
    </div>
    <div className={`font-mono text-3xl font-bold ${color === 'cyan' ? 'text-[#00E5FF] metric-glow' : color === 'yellow' ? 'text-[#EAB308]' : 'text-[#22C55E]'}`}>
      {value}
      {unit && <span className="text-sm ml-1 text-[#A1A1AA]">{unit}</span>}
    </div>
  </div>
);

// Control Panel Component
const ControlPanel = ({ config, setConfig, isRunning, onStart, onStop, onRunAllScenarios, onReset }) => (
  <div className="panel p-6" data-testid="control-panel">
    <h2 className="font-mono text-lg font-bold mb-6 flex items-center gap-2">
      <Cpu size={20} className="text-[#00E5FF]" />
      EXPERIMENT CONTROL
    </h2>
    
    <div className="space-y-6">
      {/* Number of Clients */}
      <div>
        <label className="font-mono text-xs uppercase tracking-[0.2em] text-[#A1A1AA] block mb-2">
          Clients: {config.numClients}
        </label>
        <input
          type="range"
          min="1"
          max="100"
          value={config.numClients}
          onChange={(e) => setConfig({ ...config, numClients: parseInt(e.target.value) })}
          className="w-full"
          disabled={isRunning}
          data-testid="slider-num-clients"
        />
      </div>
      
      {/* Request Rate */}
      <div>
        <label className="font-mono text-xs uppercase tracking-[0.2em] text-[#A1A1AA] block mb-2">
          Request Rate: {config.requestRate} msg/s
        </label>
        <input
          type="range"
          min="1"
          max="50"
          value={config.requestRate}
          onChange={(e) => setConfig({ ...config, requestRate: parseInt(e.target.value) })}
          className="w-full"
          disabled={isRunning}
          data-testid="slider-request-rate"
        />
      </div>
      
      {/* Toggles */}
      <div className="flex gap-6">
        <button
          onClick={() => setConfig({ ...config, burstMode: !config.burstMode })}
          className={`flex items-center gap-2 text-sm ${config.burstMode ? 'text-[#00E5FF]' : 'text-[#A1A1AA]'}`}
          disabled={isRunning}
          data-testid="toggle-burst-mode"
        >
          {config.burstMode ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
          <span className="font-mono uppercase text-xs tracking-wider">Burst</span>
        </button>
        
        <button
          onClick={() => setConfig({ ...config, longLived: !config.longLived })}
          className={`flex items-center gap-2 text-sm ${config.longLived ? 'text-[#00E5FF]' : 'text-[#A1A1AA]'}`}
          disabled={isRunning}
          data-testid="toggle-long-lived"
        >
          {config.longLived ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
          <span className="font-mono uppercase text-xs tracking-wider">Long-lived</span>
        </button>
      </div>
      
      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3 pt-4">
        {!isRunning ? (
          <button onClick={onStart} className="btn-primary py-2 px-4 flex items-center justify-center gap-2" data-testid="start-button">
            <Play size={16} /> START
          </button>
        ) : (
          <button onClick={onStop} className="btn-destructive py-2 px-4 flex items-center justify-center gap-2" data-testid="stop-button">
            <Square size={16} /> STOP
          </button>
        )}
        <button onClick={onReset} className="btn-secondary py-2 px-4 flex items-center justify-center gap-2" data-testid="reset-button">
          <RotateCcw size={16} /> RESET
        </button>
      </div>
      
      {/* Run All Scenarios */}
      <button
        onClick={onRunAllScenarios}
        disabled={isRunning}
        className="btn-primary w-full py-3 flex items-center justify-center gap-2"
        data-testid="run-all-scenarios-button"
      >
        <RefreshCw size={18} /> RUN ALL SCENARIOS
      </button>
    </div>
  </div>
);

// Connections Table Component
const ConnectionsTable = ({ connections, title, icon: Icon }) => (
  <div className="panel p-6" data-testid={`${title.toLowerCase().replace(/\s+/g, '-')}-table`}>
    <h3 className="font-mono text-sm font-bold mb-4 flex items-center gap-2">
      <Icon size={18} className="text-[#00E5FF]" />
      {title}
    </h3>
    <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
      <table className="w-full data-table">
        <thead>
          <tr>
            <th className="text-left pr-4">ID</th>
            <th className="text-left pr-4">Source IP</th>
            <th className="text-left pr-4">Port</th>
            <th className="text-right pr-4">Messages</th>
            <th className="text-right pr-4">Duration</th>
            <th className="text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {connections.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center text-[#A1A1AA] py-4">No connections</td>
            </tr>
          ) : (
            connections.map((conn) => (
              <tr key={conn.id}>
                <td className="font-mono text-xs">{conn.id.slice(0, 8)}</td>
                <td className="font-mono text-xs">{conn.sourceIP}</td>
                <td className="font-mono text-[#00E5FF]">{conn.sourcePort}</td>
                <td className="text-right font-mono">{conn.messagesReceived}</td>
                <td className="text-right font-mono text-xs">
                  {conn.duration ? `${conn.duration}ms` : '-'}
                </td>
                <td className="text-center">
                  <span className={`font-mono text-xs uppercase ${conn.status === 'active' ? 'status-active' : 'status-closed'}`}>
                    {conn.status}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

// Scenario Comparison Table Component
const ScenarioComparisonTable = ({ results }) => (
  <div className="panel p-6" data-testid="scenario-comparison-table">
    <h3 className="font-mono text-sm font-bold mb-4 flex items-center gap-2">
      <TableIcon size={18} className="text-[#EAB308]" />
      SCENARIO COMPARISON
    </h3>
    <div className="overflow-x-auto">
      <table className="w-full data-table">
        <thead>
          <tr>
            <th className="text-left pr-4">Clients</th>
            <th className="text-right pr-4">Avg Msg/s</th>
            <th className="text-right pr-4">Avg Duration</th>
            <th className="text-right pr-4">Max Concurrent</th>
            <th className="text-right pr-4">Total Conn</th>
            <th className="text-right">Stability</th>
          </tr>
        </thead>
        <tbody>
          {results.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center text-[#A1A1AA] py-4">Run scenarios to see comparison</td>
            </tr>
          ) : (
            results.map((result, idx) => (
              <tr key={idx}>
                <td className="font-mono text-[#00E5FF] font-bold">{result.numClients}</td>
                <td className="text-right font-mono">{result.avgMessagesPerSec}</td>
                <td className="text-right font-mono text-xs">{result.avgConnectionDuration}ms</td>
                <td className="text-right font-mono">{result.maxConcurrentConnections}</td>
                <td className="text-right font-mono">{result.totalConnections}</td>
                <td className="text-right">
                  <span className={`font-mono font-bold ${result.stability >= 80 ? 'text-[#22C55E]' : result.stability >= 50 ? 'text-[#EAB308]' : 'text-[#EF4444]'}`}>
                    {result.stability}%
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

// Port Usage Analysis Component
const PortUsageAnalysis = ({ portUsage }) => (
  <div className="panel p-6" data-testid="port-usage-analysis">
    <h3 className="font-mono text-sm font-bold mb-4 flex items-center gap-2">
      <Network size={18} className="text-[#00E5FF]" />
      PORT USAGE ANALYSIS
    </h3>
    
    <div className="mb-4 p-3 bg-black/50 border-l-2 border-[#00E5FF]">
      <p className="text-xs text-[#A1A1AA] font-mono">
        Transport-layer demultiplexing relies on port-based identification to route packets to correct sockets.
      </p>
    </div>
    
    <div className="grid grid-cols-2 gap-4 mb-4">
      <div className="bg-black/30 p-3">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-[#A1A1AA] mb-1">Unique Ports</div>
        <div className="font-mono text-2xl text-[#00E5FF] font-bold">{portUsage.uniquePorts}</div>
      </div>
      <div className="bg-black/30 p-3">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-[#A1A1AA] mb-1">Top Port</div>
        <div className="font-mono text-2xl text-[#EAB308] font-bold">
          {portUsage.topPorts.length > 0 ? portUsage.topPorts[0][0] : '-'}
        </div>
      </div>
    </div>
    
    {portUsage.distribution.length > 0 && (
      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={portUsage.distribution.slice(0, 10)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
            <XAxis dataKey="port" stroke="#A1A1AA" fontSize={10} tickLine={false} />
            <YAxis stroke="#A1A1AA" fontSize={10} tickLine={false} />
            <Tooltip 
              contentStyle={{ background: '#000', border: '1px solid #00E5FF', fontFamily: 'IBM Plex Mono' }}
              labelStyle={{ color: '#00E5FF' }}
            />
            <Bar dataKey="count" fill="#00E5FF" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )}
  </div>
);

// Analysis Panel Component
const AnalysisPanel = ({ analysis }) => (
  <div className="panel p-6" data-testid="analysis-panel">
    <h3 className="font-mono text-sm font-bold mb-4 flex items-center gap-2">
      <Terminal size={18} className="text-[#00E5FF]" />
      AUTOMATIC ANALYSIS
    </h3>
    <div className="terminal-block space-y-2">
      {analysis.map((insight, idx) => (
        <p key={idx} className="flex items-start gap-2">
          <span className="text-[#00E5FF]">{'>'}</span>
          <span>{insight}</span>
        </p>
      ))}
    </div>
  </div>
);

// Custom Tooltip for Charts
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <p className="text-[#00E5FF]">{label}</p>
        {payload.map((entry, idx) => (
          <p key={idx} style={{ color: entry.color }}>
            {entry.name}: {entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// Main App Component
function App() {
  const [connected, setConnected] = useState(false);
  const [metrics, setMetrics] = useState({
    totalConnections: 0,
    activeConnectionsCount: 0,
    messagesPerSecond: 0,
    connectionRate: 0,
    avgConnectionDuration: 0,
    totalMessages: 0
  });
  const [activeConnections, setActiveConnections] = useState([]);
  const [connectionHistory, setConnectionHistory] = useState([]);
  const [portUsage, setPortUsage] = useState({ uniquePorts: 0, topPorts: [], distribution: [] });
  const [scenarioResults, setScenarioResults] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [metricsHistory, setMetricsHistory] = useState([]);
  const [analysis, setAnalysis] = useState(['Run experiments to generate analysis insights.']);
  const [config, setConfig] = useState({
    numClients: 10,
    requestRate: 5,
    burstMode: false,
    longLived: true
  });
  
  const wsRef = useRef(null);
  
  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket(`${WS_URL}/api`);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.metrics) setMetrics(data.metrics);
          if (data.activeConnections) setActiveConnections(data.activeConnections);
          if (data.connectionHistory) setConnectionHistory(data.connectionHistory);
          if (data.portUsage) setPortUsage(data.portUsage);
          if (data.scenarioResults) setScenarioResults(data.scenarioResults);
          if (data.isRunning !== undefined) setIsRunning(data.isRunning);
          if (data.metricsHistory) {
            setMetricsHistory(data.metricsHistory.map((m, idx) => ({
              ...m,
              time: idx
            })));
          }
        } catch (e) {
          console.error('WebSocket message error:', e);
        }
      };
      
      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        // Reconnect after 2 seconds
        setTimeout(connectWebSocket, 2000);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };
    
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);
  
  // Fetch analysis when scenario results change
  useEffect(() => {
    if (scenarioResults.length > 0) {
      fetchAnalysis();
    }
  }, [scenarioResults]);
  
  const fetchAnalysis = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/analysis`);
      const data = await response.json();
      setAnalysis(data.analysis);
    } catch (e) {
      console.error('Failed to fetch analysis:', e);
    }
  };
  
  const handleStart = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
    } catch (e) {
      console.error('Failed to start:', e);
    }
  };
  
  const handleStop = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/stop`, { method: 'POST' });
    } catch (e) {
      console.error('Failed to stop:', e);
    }
  };
  
  const handleRunAllScenarios = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/run-scenarios`, { method: 'POST' });
    } catch (e) {
      console.error('Failed to run scenarios:', e);
    }
  };
  
  const handleReset = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/reset`, { method: 'POST' });
      setAnalysis(['Run experiments to generate analysis insights.']);
    } catch (e) {
      console.error('Failed to reset:', e);
    }
  };
  
  const handleExport = () => {
    window.open(`${BACKEND_URL}/api/export`, '_blank');
  };
  
  return (
    <div className="min-h-screen bg-[#050505]" data-testid="network-analysis-dashboard">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[rgba(0,229,255,0.15)] bg-[#050505] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Network size={28} className="text-[#00E5FF]" />
            <h1 className="font-mono text-xl font-bold tracking-tight">
              NETWORK ANALYSIS SYSTEM
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleExport} className="btn-secondary py-2 px-4 flex items-center gap-2 text-sm" data-testid="export-csv-button">
              <Download size={16} /> EXPORT CSV
            </button>
            <div className={`flex items-center gap-2 font-mono text-xs ${connected ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#22C55E]' : 'bg-[#EF4444]'}`}></span>
              {connected ? 'CONNECTED' : 'DISCONNECTED'}
            </div>
          </div>
        </div>
      </header>
      
      <main className="p-6">
        {/* Metrics Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6" data-testid="metrics-row">
          <MetricCard icon={Plug} label="Active Connections" value={metrics.activeConnectionsCount} color="cyan" />
          <MetricCard icon={Network} label="Total Connections" value={metrics.totalConnections} color="yellow" />
          <MetricCard icon={Zap} label="Messages/sec" value={metrics.messagesPerSecond} color="cyan" />
          <MetricCard icon={Gauge} label="Conn Rate" value={metrics.connectionRate} unit="/s" color="cyan" />
          <MetricCard icon={Clock} label="Avg Duration" value={metrics.avgConnectionDuration} unit="ms" color="green" />
        </div>
        
        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Column - Control Panel */}
          <div className="lg:col-span-1">
            <ControlPanel
              config={config}
              setConfig={setConfig}
              isRunning={isRunning}
              onStart={handleStart}
              onStop={handleStop}
              onRunAllScenarios={handleRunAllScenarios}
              onReset={handleReset}
            />
          </div>
          
          {/* Center - Charts */}
          <div className="lg:col-span-2 space-y-6">
            {/* Active Connections Chart */}
            <div className="panel p-6" data-testid="connections-chart">
              <h3 className="font-mono text-sm font-bold mb-4 flex items-center gap-2">
                <LineChartIcon size={18} className="text-[#00E5FF]" />
                ACTIVE CONNECTIONS OVER TIME
              </h3>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={metricsHistory}>
                    <defs>
                      <linearGradient id="colorConnections" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00E5FF" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#00E5FF" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
                    <XAxis dataKey="time" stroke="#A1A1AA" fontSize={10} tickLine={false} />
                    <YAxis stroke="#A1A1AA" fontSize={10} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area 
                      type="monotone" 
                      dataKey="activeConnections" 
                      stroke="#00E5FF" 
                      strokeWidth={2}
                      fill="url(#colorConnections)"
                      name="Active Connections"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            {/* Messages Per Second Chart */}
            <div className="panel p-6" data-testid="messages-chart">
              <h3 className="font-mono text-sm font-bold mb-4 flex items-center gap-2">
                <Activity size={18} className="text-[#EAB308]" />
                MESSAGES PER SECOND
              </h3>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metricsHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
                    <XAxis dataKey="time" stroke="#A1A1AA" fontSize={10} tickLine={false} />
                    <YAxis stroke="#A1A1AA" fontSize={10} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line 
                      type="monotone" 
                      dataKey="messagesPerSecond" 
                      stroke="#EAB308" 
                      strokeWidth={2}
                      dot={false}
                      name="Messages/sec"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          
          {/* Right Column - Port Analysis & Analysis */}
          <div className="lg:col-span-1 space-y-6">
            <PortUsageAnalysis portUsage={portUsage} />
            <AnalysisPanel analysis={analysis} />
          </div>
        </div>
        
        {/* Tables Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <ConnectionsTable connections={activeConnections} title="ACTIVE CONNECTIONS" icon={Plug} />
          <ConnectionsTable connections={connectionHistory} title="CONNECTION HISTORY" icon={Clock} />
        </div>
        
        {/* Scenario Comparison */}
        <div className="mt-6">
          <ScenarioComparisonTable results={scenarioResults} />
        </div>
      </main>
    </div>
  );
}

export default App;
