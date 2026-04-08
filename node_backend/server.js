import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import net from 'net';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(cors());
app.use(express.json());

// In-memory data storage
const state = {
  activeConnections: new Map(),
  connectionHistory: [],
  portUsage: new Map(),
  metrics: {
    totalConnections: 0,
    activeConnectionsCount: 0,
    messagesPerSecond: 0,
    connectionRate: 0,
    avgConnectionDuration: 0,
    totalMessages: 0
  },
  scenarioResults: [],
  isRunning: false,
  currentConfig: {
    numClients: 10,
    requestRate: 5,
    burstMode: false,
    longLived: true
  },
  loadGeneratorClients: [],
  metricsHistory: []
};

// Metrics tracking
let messageCount = 0;
let connectionCountLastSecond = 0;
let lastMetricsUpdate = Date.now();

// TCP Server on port 9000
const tcpServer = net.createServer((socket) => {
  const connectionId = uuidv4();
  const sourcePort = socket.remotePort || Math.floor(Math.random() * 64512) + 1024;
  const sourceIP = socket.remoteAddress || '127.0.0.1';
  
  const connection = {
    id: connectionId,
    sourceIP: sourceIP.replace('::ffff:', ''),
    sourcePort,
    startTime: Date.now(),
    endTime: null,
    messagesReceived: 0,
    status: 'active'
  };
  
  state.activeConnections.set(connectionId, connection);
  state.metrics.totalConnections++;
  state.metrics.activeConnectionsCount = state.activeConnections.size;
  connectionCountLastSecond++;
  
  // Track port usage
  state.portUsage.set(sourcePort, (state.portUsage.get(sourcePort) || 0) + 1);
  
  broadcastUpdate();
  
  socket.on('data', (data) => {
    const conn = state.activeConnections.get(connectionId);
    if (conn) {
      conn.messagesReceived++;
      state.metrics.totalMessages++;
      messageCount++;
    }
  });
  
  socket.on('close', () => {
    const conn = state.activeConnections.get(connectionId);
    if (conn) {
      conn.endTime = Date.now();
      conn.status = 'closed';
      conn.duration = conn.endTime - conn.startTime;
      
      state.connectionHistory.unshift({ ...conn });
      if (state.connectionHistory.length > 500) {
        state.connectionHistory.pop();
      }
      
      state.activeConnections.delete(connectionId);
      state.metrics.activeConnectionsCount = state.activeConnections.size;
      
      updateAvgDuration();
      broadcastUpdate();
    }
  });
  
  socket.on('error', (err) => {
    console.log('Socket error:', err.message);
  });
});

tcpServer.listen(9000, '0.0.0.0', () => {
  console.log('TCP Server listening on port 9000');
});

// Update average connection duration
function updateAvgDuration() {
  const closedConns = state.connectionHistory.filter(c => c.duration);
  if (closedConns.length > 0) {
    const totalDuration = closedConns.reduce((sum, c) => sum + c.duration, 0);
    state.metrics.avgConnectionDuration = Math.round(totalDuration / closedConns.length);
  }
}

// Metrics update interval
setInterval(() => {
  const now = Date.now();
  const elapsed = (now - lastMetricsUpdate) / 1000;
  
  state.metrics.messagesPerSecond = Math.round(messageCount / elapsed);
  state.metrics.connectionRate = Math.round(connectionCountLastSecond / elapsed * 10) / 10;
  
  state.metricsHistory.push({
    timestamp: now,
    activeConnections: state.metrics.activeConnectionsCount,
    messagesPerSecond: state.metrics.messagesPerSecond,
    connectionRate: state.metrics.connectionRate
  });
  
  if (state.metricsHistory.length > 300) {
    state.metricsHistory.shift();
  }
  
  messageCount = 0;
  connectionCountLastSecond = 0;
  lastMetricsUpdate = now;
  
  broadcastUpdate();
}, 1000);

// WebSocket broadcast
function broadcastUpdate() {
  const data = {
    type: 'update',
    metrics: state.metrics,
    activeConnections: Array.from(state.activeConnections.values()),
    connectionHistory: state.connectionHistory.slice(0, 50),
    portUsage: getPortUsageStats(),
    scenarioResults: state.scenarioResults,
    isRunning: state.isRunning,
    metricsHistory: state.metricsHistory.slice(-60)
  };
  
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
}

function getPortUsageStats() {
  const entries = Array.from(state.portUsage.entries());
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  return {
    uniquePorts: entries.length,
    topPorts: sorted.slice(0, 10),
    distribution: sorted.slice(0, 20).map(([port, count]) => ({ port, count }))
  };
}

// Load Generator
class LoadGenerator {
  constructor() {
    this.clients = [];
    this.running = false;
    this.intervalId = null;
  }
  
  async start(config) {
    this.stop();
    this.running = true;
    const { numClients, requestRate, burstMode, longLived } = config;
    
    // Create clients
    for (let i = 0; i < numClients; i++) {
      await this.createClient(requestRate, burstMode, longLived, i);
      if (!this.running) break;
      await sleep(burstMode ? 10 : 50);
    }
    
    return this.running;
  }
  
  async createClient(requestRate, burstMode, longLived, index) {
    return new Promise((resolve) => {
      const client = new net.Socket();
      
      client.connect(9000, '127.0.0.1', () => {
        this.clients.push(client);
        
        // Send messages at configured rate
        const interval = setInterval(() => {
          if (client.destroyed) {
            clearInterval(interval);
            return;
          }
          
          const messageCount = burstMode ? Math.floor(Math.random() * 5) + 1 : 1;
          for (let i = 0; i < messageCount; i++) {
            try {
              client.write(`Message from client ${index} at ${Date.now()}\n`);
            } catch (e) {
              clearInterval(interval);
            }
          }
        }, 1000 / requestRate);
        
        client._messageInterval = interval;
        
        // For short-lived connections, disconnect after random time
        if (!longLived) {
          setTimeout(() => {
            clearInterval(interval);
            client.destroy();
          }, Math.random() * 5000 + 1000);
        }
        
        resolve();
      });
      
      client.on('error', () => {
        resolve();
      });
    });
  }
  
  stop() {
    this.running = false;
    this.clients.forEach(client => {
      if (client._messageInterval) {
        clearInterval(client._messageInterval);
      }
      client.destroy();
    });
    this.clients = [];
  }
  
  getClientCount() {
    return this.clients.filter(c => !c.destroyed).length;
  }
}

const loadGenerator = new LoadGenerator();

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    metrics: state.metrics,
    activeConnections: Array.from(state.activeConnections.values()),
    connectionHistory: state.connectionHistory.slice(0, 50),
    portUsage: getPortUsageStats(),
    scenarioResults: state.scenarioResults,
    isRunning: state.isRunning,
    currentConfig: state.currentConfig,
    metricsHistory: state.metricsHistory.slice(-60)
  });
});

app.post('/api/start', async (req, res) => {
  const config = req.body;
  state.currentConfig = { ...state.currentConfig, ...config };
  state.isRunning = true;
  
  await loadGenerator.start(state.currentConfig);
  
  res.json({ success: true, message: 'Load generator started' });
});

app.post('/api/stop', (req, res) => {
  loadGenerator.stop();
  state.isRunning = false;
  
  res.json({ success: true, message: 'Load generator stopped' });
});

app.post('/api/run-scenarios', async (req, res) => {
  const scenarios = [5, 20, 50, 100];
  state.scenarioResults = [];
  state.isRunning = true;
  
  res.json({ success: true, message: 'Running all scenarios' });
  
  // Run scenarios in background
  runAllScenarios(scenarios);
});

async function runAllScenarios(scenarios) {
  for (const numClients of scenarios) {
    if (!state.isRunning) break;
    
    // Reset metrics for this scenario
    const startMetrics = { ...state.metrics };
    const startTime = Date.now();
    
    // Start load with this number of clients
    await loadGenerator.start({
      numClients,
      requestRate: state.currentConfig.requestRate,
      burstMode: state.currentConfig.burstMode,
      longLived: state.currentConfig.longLived
    });
    
    // Run for 10 seconds
    await sleep(10000);
    
    // Collect results
    const endTime = Date.now();
    const duration = endTime - startTime;
    const messagesInPeriod = state.metrics.totalMessages - startMetrics.totalMessages;
    
    const result = {
      numClients,
      avgMessagesPerSec: Math.round(messagesInPeriod / (duration / 1000)),
      avgConnectionDuration: state.metrics.avgConnectionDuration,
      maxConcurrentConnections: state.metrics.activeConnectionsCount,
      totalConnections: state.metrics.totalConnections - startMetrics.totalConnections,
      stability: calculateStability(numClients),
      timestamp: Date.now()
    };
    
    state.scenarioResults.push(result);
    broadcastUpdate();
    
    // Stop and wait before next scenario
    loadGenerator.stop();
    await sleep(2000);
  }
  
  state.isRunning = false;
  broadcastUpdate();
}

function calculateStability(numClients) {
  // Simple stability calculation based on connection success rate
  const recentHistory = state.connectionHistory.slice(0, 100);
  if (recentHistory.length === 0) return 100;
  
  const successfulConnections = recentHistory.filter(c => c.messagesReceived > 0).length;
  const stability = Math.round((successfulConnections / recentHistory.length) * 100);
  return Math.min(100, Math.max(0, stability));
}

app.post('/api/reset', (req, res) => {
  loadGenerator.stop();
  state.activeConnections.clear();
  state.connectionHistory = [];
  state.portUsage.clear();
  state.scenarioResults = [];
  state.metricsHistory = [];
  state.metrics = {
    totalConnections: 0,
    activeConnectionsCount: 0,
    messagesPerSecond: 0,
    connectionRate: 0,
    avgConnectionDuration: 0,
    totalMessages: 0
  };
  state.isRunning = false;
  
  broadcastUpdate();
  res.json({ success: true, message: 'System reset' });
});

app.get('/api/export', (req, res) => {
  // Generate CSV data
  const headers = [
    'Connection ID',
    'Source IP',
    'Source Port',
    'Start Time',
    'End Time',
    'Duration (ms)',
    'Messages Received',
    'Status'
  ];
  
  const allConnections = [
    ...Array.from(state.activeConnections.values()),
    ...state.connectionHistory
  ];
  
  const rows = allConnections.map(conn => [
    conn.id,
    conn.sourceIP,
    conn.sourcePort,
    new Date(conn.startTime).toISOString(),
    conn.endTime ? new Date(conn.endTime).toISOString() : '',
    conn.duration || '',
    conn.messagesReceived,
    conn.status
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=network_analysis_export.csv');
  res.send(csv);
});

app.get('/api/analysis', (req, res) => {
  const analysis = generateAnalysis();
  res.json({ analysis });
});

function generateAnalysis() {
  const insights = [];
  
  if (state.scenarioResults.length > 0) {
    // Analyze scenario results
    const results = state.scenarioResults;
    const firstResult = results[0];
    const lastResult = results[results.length - 1];
    
    if (results.length >= 2) {
      // Message rate trend
      const msgRateChange = ((lastResult.avgMessagesPerSec - firstResult.avgMessagesPerSec) / (firstResult.avgMessagesPerSec || 1)) * 100;
      if (msgRateChange < -20) {
        insights.push(`Message throughput decreased by ${Math.abs(Math.round(msgRateChange))}% under higher concurrency, indicating potential bottleneck.`);
      } else if (msgRateChange > 20) {
        insights.push(`Message throughput scales well with increased clients, showing ${Math.round(msgRateChange)}% improvement.`);
      }
      
      // Connection duration trend
      const durationChange = lastResult.avgConnectionDuration - firstResult.avgConnectionDuration;
      if (durationChange > 500) {
        insights.push(`Connection duration increased by ${durationChange}ms under load, suggesting connection handling overhead.`);
      }
      
      // Stability analysis
      const avgStability = results.reduce((sum, r) => sum + r.stability, 0) / results.length;
      if (avgStability < 80) {
        insights.push(`Average stability at ${Math.round(avgStability)}% indicates connection reliability issues under load.`);
      } else {
        insights.push(`System maintains ${Math.round(avgStability)}% stability across all scenarios.`);
      }
    }
    
    // Port diversity analysis
    const portStats = getPortUsageStats();
    insights.push(`Transport-layer demultiplexing utilized ${portStats.uniquePorts} unique source ports for connection identification.`);
    
    if (portStats.topPorts.length > 0) {
      const topPort = portStats.topPorts[0];
      insights.push(`Most frequently used port: ${topPort[0]} with ${topPort[1]} connections.`);
    }
  } else {
    // General metrics analysis
    if (state.metrics.activeConnectionsCount > 50) {
      insights.push(`High concurrency detected: ${state.metrics.activeConnectionsCount} active connections.`);
    }
    
    if (state.metrics.messagesPerSecond > 100) {
      insights.push(`High message throughput: ${state.metrics.messagesPerSecond} messages/second.`);
    }
    
    const portStats = getPortUsageStats();
    if (portStats.uniquePorts > 0) {
      insights.push(`Port analysis: ${portStats.uniquePorts} unique source ports observed. Transport-layer demultiplexing relies on port-based identification.`);
    }
  }
  
  if (insights.length === 0) {
    insights.push('Run experiments to generate analysis insights about transport-layer behavior under load.');
  }
  
  return insights;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  // Send initial state
  ws.send(JSON.stringify({
    type: 'init',
    metrics: state.metrics,
    activeConnections: Array.from(state.activeConnections.values()),
    connectionHistory: state.connectionHistory.slice(0, 50),
    portUsage: getPortUsageStats(),
    scenarioResults: state.scenarioResults,
    isRunning: state.isRunning,
    metricsHistory: state.metricsHistory.slice(-60)
  }));
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

const PORT = 8001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP/WebSocket server running on port ${PORT}`);
});
