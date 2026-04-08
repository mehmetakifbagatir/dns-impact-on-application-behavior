from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import asyncio
import uuid
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Set
from collections import defaultdict

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class SystemState:
    def __init__(self):
        self.active_connections: Dict[str, dict] = {}
        self.connection_history: List[dict] = []
        self.port_usage: Dict[int, int] = defaultdict(int)
        self.metrics = {
            "totalConnections": 0,
            "activeConnectionsCount": 0,
            "messagesPerSecond": 0,
            "connectionRate": 0,
            "avgConnectionDuration": 0,
            "totalMessages": 0
        }
        self.scenario_results: List[dict] = []
        self.is_running = False
        self.current_config = {
            "numClients": 10,
            "requestRate": 5,
            "burstMode": False,
            "longLived": True
        }
        self.metrics_history: List[dict] = []
        self.websocket_clients: Set[WebSocket] = set()
        self.message_count = 0
        self.connection_count_last_second = 0
        self.last_metrics_update = datetime.now(timezone.utc).timestamp() * 1000
        self.load_generator_tasks: List[asyncio.Task] = []
        self.tcp_server = None

state = SystemState()

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections[:]:
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

def get_port_usage_stats():
    entries = list(state.port_usage.items())
    sorted_entries = sorted(entries, key=lambda x: x[1], reverse=True)
    return {
        "uniquePorts": len(entries),
        "topPorts": sorted_entries[:10],
        "distribution": [{"port": p, "count": c} for p, c in sorted_entries[:20]]
    }

def update_avg_duration():
    closed_conns = [c for c in state.connection_history if c.get("duration")]
    if closed_conns:
        total_duration = sum(c["duration"] for c in closed_conns)
        state.metrics["avgConnectionDuration"] = round(total_duration / len(closed_conns))

async def broadcast_update():
    data = {
        "type": "update",
        "metrics": state.metrics,
        "activeConnections": list(state.active_connections.values()),
        "connectionHistory": state.connection_history[:50],
        "portUsage": get_port_usage_stats(),
        "scenarioResults": state.scenario_results,
        "isRunning": state.is_running,
        "metricsHistory": state.metrics_history[-60:]
    }
    await manager.broadcast(data)

async def handle_tcp_connection(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    connection_id = str(uuid.uuid4())
    peername = writer.get_extra_info('peername')
    source_ip = peername[0] if peername else '127.0.0.1'
    source_port = peername[1] if peername else 0
    
    connection = {
        "id": connection_id,
        "sourceIP": source_ip.replace('::ffff:', ''),
        "sourcePort": source_port,
        "startTime": int(datetime.now(timezone.utc).timestamp() * 1000),
        "endTime": None,
        "messagesReceived": 0,
        "status": "active"
    }
    
    state.active_connections[connection_id] = connection
    state.metrics["totalConnections"] += 1
    state.metrics["activeConnectionsCount"] = len(state.active_connections)
    state.connection_count_last_second += 1
    state.port_usage[source_port] += 1
    
    await broadcast_update()
    
    try:
        while True:
            data = await asyncio.wait_for(reader.read(1024), timeout=60.0)
            if not data:
                break
            
            conn = state.active_connections.get(connection_id)
            if conn:
                conn["messagesReceived"] += 1
                state.metrics["totalMessages"] += 1
                state.message_count += 1
    except asyncio.TimeoutError:
        pass
    except Exception as e:
        logger.debug(f"Connection error: {e}")
    finally:
        conn = state.active_connections.pop(connection_id, None)
        if conn:
            conn["endTime"] = int(datetime.now(timezone.utc).timestamp() * 1000)
            conn["status"] = "closed"
            conn["duration"] = conn["endTime"] - conn["startTime"]
            
            state.connection_history.insert(0, conn)
            if len(state.connection_history) > 500:
                state.connection_history.pop()
            
            state.metrics["activeConnectionsCount"] = len(state.active_connections)
            update_avg_duration()
            await broadcast_update()
        
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass

async def start_tcp_server():
    try:
        server = await asyncio.start_server(
            handle_tcp_connection, '0.0.0.0', 9000
        )
        state.tcp_server = server
        logger.info("TCP Server listening on port 9000")
        async with server:
            await server.serve_forever()
    except Exception as e:
        logger.error(f"TCP Server error: {e}")

async def metrics_updater():
    while True:
        await asyncio.sleep(1)
        
        now = datetime.now(timezone.utc).timestamp() * 1000
        elapsed = (now - state.last_metrics_update) / 1000
        
        if elapsed > 0:
            state.metrics["messagesPerSecond"] = round(state.message_count / elapsed)
            state.metrics["connectionRate"] = round(state.connection_count_last_second / elapsed * 10) / 10
        
        state.metrics_history.append({
            "timestamp": now,
            "activeConnections": state.metrics["activeConnectionsCount"],
            "messagesPerSecond": state.metrics["messagesPerSecond"],
            "connectionRate": state.metrics["connectionRate"]
        })
        
        if len(state.metrics_history) > 300:
            state.metrics_history.pop(0)
        
        state.message_count = 0
        state.connection_count_last_second = 0
        state.last_metrics_update = now
        
        await broadcast_update()

async def load_client(client_id: int, request_rate: int, burst_mode: bool, long_lived: bool):
    try:
        reader, writer = await asyncio.open_connection('127.0.0.1', 9000)
        
        try:
            delay = 1.0 / request_rate if request_rate > 0 else 1.0
            max_lifetime = None if long_lived else (1 + 5 * (hash(str(client_id)) % 100) / 100)
            start_time = asyncio.get_event_loop().time()
            
            while state.is_running:
                if max_lifetime and (asyncio.get_event_loop().time() - start_time) > max_lifetime:
                    break
                
                msg_count = 1 if not burst_mode else (1 + (hash(str(client_id) + str(int(asyncio.get_event_loop().time()))) % 5))
                for _ in range(msg_count):
                    try:
                        message = f"Message from client {client_id}\n"
                        writer.write(message.encode())
                        await writer.drain()
                    except Exception:
                        return
                
                await asyncio.sleep(delay)
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
    except Exception as e:
        logger.debug(f"Client {client_id} connection error: {e}")

async def start_load_generator(config: dict):
    state.is_running = True
    num_clients = config.get("numClients", 10)
    request_rate = config.get("requestRate", 5)
    burst_mode = config.get("burstMode", False)
    long_lived = config.get("longLived", True)
    
    for task in state.load_generator_tasks:
        task.cancel()
    state.load_generator_tasks = []
    
    for i in range(num_clients):
        task = asyncio.create_task(load_client(i, request_rate, burst_mode, long_lived))
        state.load_generator_tasks.append(task)
        await asyncio.sleep(0.05 if burst_mode else 0.1)

def stop_load_generator():
    state.is_running = False
    for task in state.load_generator_tasks:
        task.cancel()
    state.load_generator_tasks = []

def calculate_stability(num_clients: int):
    recent_history = state.connection_history[:100]
    if not recent_history:
        return 100
    
    successful = sum(1 for c in recent_history if c.get("messagesReceived", 0) > 0)
    stability = round((successful / len(recent_history)) * 100)
    return min(100, max(0, stability))

async def run_all_scenarios():
    scenarios = [5, 20, 50, 100]
    state.scenario_results = []
    running_scenarios = True
    
    for num_clients in scenarios:
        if not running_scenarios:
            break
        
        start_metrics = dict(state.metrics)
        start_time = datetime.now(timezone.utc).timestamp() * 1000
        
        # Start the load generator for this scenario
        state.is_running = True
        await start_load_generator({
            "numClients": num_clients,
            "requestRate": state.current_config.get("requestRate", 5),
            "burstMode": state.current_config.get("burstMode", False),
            "longLived": state.current_config.get("longLived", True)
        })
        
        # Run scenario for 10 seconds
        await asyncio.sleep(10)
        
        end_time = datetime.now(timezone.utc).timestamp() * 1000
        duration = end_time - start_time
        messages_in_period = state.metrics["totalMessages"] - start_metrics["totalMessages"]
        
        result = {
            "numClients": num_clients,
            "avgMessagesPerSec": round(messages_in_period / (duration / 1000)) if duration > 0 else 0,
            "avgConnectionDuration": state.metrics["avgConnectionDuration"],
            "maxConcurrentConnections": state.metrics["activeConnectionsCount"],
            "totalConnections": state.metrics["totalConnections"] - start_metrics["totalConnections"],
            "stability": calculate_stability(num_clients),
            "timestamp": int(end_time)
        }
        
        state.scenario_results.append(result)
        await broadcast_update()
        
        # Stop current clients before next scenario
        stop_load_generator()
        await asyncio.sleep(2)
    
    state.is_running = False
    await broadcast_update()

def generate_analysis():
    insights = []
    
    if state.scenario_results:
        results = state.scenario_results
        first_result = results[0]
        last_result = results[-1]
        
        if len(results) >= 2:
            if first_result["avgMessagesPerSec"] > 0:
                msg_rate_change = ((last_result["avgMessagesPerSec"] - first_result["avgMessagesPerSec"]) / first_result["avgMessagesPerSec"]) * 100
                if msg_rate_change < -20:
                    insights.append(f"Message throughput decreased by {abs(round(msg_rate_change))}% under higher concurrency, indicating potential bottleneck.")
                elif msg_rate_change > 20:
                    insights.append(f"Message throughput scales well with increased clients, showing {round(msg_rate_change)}% improvement.")
            
            duration_change = last_result["avgConnectionDuration"] - first_result["avgConnectionDuration"]
            if duration_change > 500:
                insights.append(f"Connection duration increased by {duration_change}ms under load, suggesting connection handling overhead.")
            
            avg_stability = sum(r["stability"] for r in results) / len(results)
            if avg_stability < 80:
                insights.append(f"Average stability at {round(avg_stability)}% indicates connection reliability issues under load.")
            else:
                insights.append(f"System maintains {round(avg_stability)}% stability across all scenarios.")
        
        port_stats = get_port_usage_stats()
        insights.append(f"Transport-layer demultiplexing utilized {port_stats['uniquePorts']} unique source ports for connection identification.")
        
        if port_stats["topPorts"]:
            top_port = port_stats["topPorts"][0]
            insights.append(f"Most frequently used port: {top_port[0]} with {top_port[1]} connections.")
    else:
        if state.metrics["activeConnectionsCount"] > 50:
            insights.append(f"High concurrency detected: {state.metrics['activeConnectionsCount']} active connections.")
        
        if state.metrics["messagesPerSecond"] > 100:
            insights.append(f"High message throughput: {state.metrics['messagesPerSecond']} messages/second.")
        
        port_stats = get_port_usage_stats()
        if port_stats["uniquePorts"] > 0:
            insights.append(f"Port analysis: {port_stats['uniquePorts']} unique source ports observed. Transport-layer demultiplexing relies on port-based identification.")
    
    if not insights:
        insights.append("Run experiments to generate analysis insights about transport-layer behavior under load.")
    
    return insights

@api_router.get("/")
async def root():
    return {"message": "Network Analysis System API"}

@api_router.get("/status")
async def get_status():
    return {
        "metrics": state.metrics,
        "activeConnections": list(state.active_connections.values()),
        "connectionHistory": state.connection_history[:50],
        "portUsage": get_port_usage_stats(),
        "scenarioResults": state.scenario_results,
        "isRunning": state.is_running,
        "currentConfig": state.current_config,
        "metricsHistory": state.metrics_history[-60:]
    }

@api_router.post("/start")
async def start_experiment(config: dict = None):
    if config:
        state.current_config.update(config)
    
    asyncio.create_task(start_load_generator(state.current_config))
    return {"success": True, "message": "Load generator started"}

@api_router.post("/stop")
async def stop_experiment():
    stop_load_generator()
    return {"success": True, "message": "Load generator stopped"}

@api_router.post("/run-scenarios")
async def run_scenarios():
    asyncio.create_task(run_all_scenarios())
    return {"success": True, "message": "Running all scenarios"}

@api_router.post("/reset")
async def reset_system():
    stop_load_generator()
    state.active_connections.clear()
    state.connection_history.clear()
    state.port_usage.clear()
    state.scenario_results.clear()
    state.metrics_history.clear()
    state.metrics = {
        "totalConnections": 0,
        "activeConnectionsCount": 0,
        "messagesPerSecond": 0,
        "connectionRate": 0,
        "avgConnectionDuration": 0,
        "totalMessages": 0
    }
    state.is_running = False
    await broadcast_update()
    return {"success": True, "message": "System reset"}

@api_router.get("/export")
async def export_data():
    headers = [
        "Connection ID",
        "Source IP",
        "Source Port",
        "Start Time",
        "End Time",
        "Duration (ms)",
        "Messages Received",
        "Status"
    ]
    
    all_connections = list(state.active_connections.values()) + state.connection_history
    
    rows = []
    for conn in all_connections:
        rows.append([
            conn["id"],
            conn["sourceIP"],
            str(conn["sourcePort"]),
            datetime.fromtimestamp(conn["startTime"] / 1000, tz=timezone.utc).isoformat() if conn.get("startTime") else "",
            datetime.fromtimestamp(conn["endTime"] / 1000, tz=timezone.utc).isoformat() if conn.get("endTime") else "",
            str(conn.get("duration", "")),
            str(conn["messagesReceived"]),
            conn["status"]
        ])
    
    csv_content = ",".join(headers) + "\n"
    csv_content += "\n".join([",".join(row) for row in rows])
    
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=network_analysis_export.csv"}
    )

@api_router.get("/analysis")
async def get_analysis():
    return {"analysis": generate_analysis()}

@api_router.websocket("")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        await websocket.send_json({
            "type": "init",
            "metrics": state.metrics,
            "activeConnections": list(state.active_connections.values()),
            "connectionHistory": state.connection_history[:50],
            "portUsage": get_port_usage_stats(),
            "scenarioResults": state.scenario_results,
            "isRunning": state.is_running,
            "metricsHistory": state.metrics_history[-60:]
        })
        
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.debug(f"WebSocket error: {e}")
        manager.disconnect(websocket)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(start_tcp_server())
    asyncio.create_task(metrics_updater())
    logger.info("Network Analysis System started")

@app.on_event("shutdown")
async def shutdown_event():
    stop_load_generator()
    if state.tcp_server:
        state.tcp_server.close()
        await state.tcp_server.wait_closed()
    logger.info("Network Analysis System shutdown")
