# Production AWS Deployment Guide

This guide details the deployment of the **Real-Time Market Analytics Terminal** to Amazon Web Services (AWS) for institutional low-latency streaming and high concurrent user scalability.

---

## 1. High-Level AWS Architecture

```
                    [ End Users / Browsers ]
                               │
                               ▼
                    [ AWS Route 53 DNS ]
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
[ AWS CloudFront (CDN) ]                [ AWS Application Load Balancer (ALB) ]
  (Static Next.js Assets)                 (Path-based routing + WS upgrades)
                                                  │
                                 ┌────────────────┴────────────────┐
                                 ▼                                 ▼
                     [ ECS Fargate: Frontend ]         [ ECS Fargate: Backend ]
                     (Next.js App Server)              (FastAPI / Uvicorn ASGI)
                                                                   │
                                                ┌──────────────────┴──────────────────┐
                                                ▼                                     ▼
                                    [ ElastiCache Redis ]               [ Amazon RDS / TimescaleDB ]
                                    (Pub/Sub Tick Broadcast)            (Hypertable Candle Ingestion)
```

---

## 2. Infrastructure Components

| Layer | Recommended AWS Service | Instance / Sizing | Purpose |
|---|---|---|---|
| **DNS & Edge** | Route 53 + CloudFront | Global Edge Points | SSL termination, asset caching, DDoS protection (AWS Shield). |
| **Load Balancing** | Application Load Balancer (ALB) | Dual-AZ | Handles HTTPS (443) and WebSocket upgrades (`/ws`, `/ws/book/*`). |
| **Backend App** | Amazon ECS Fargate | 2 vCPU, 4 GB RAM (`c7g.xlarge` if on EC2) | Runs FastAPI ASGI app with Uvicorn workers. |
| **Frontend App** | Amazon ECS Fargate | 1 vCPU, 2 GB RAM | Next.js server running in standalone mode. |
| **Pub/Sub Bus** | Amazon ElastiCache for Redis | `cache.m7g.large` (Multi-AZ) | In-memory message distribution between backend workers. |
| **Time-Series DB** | Amazon RDS for PostgreSQL + Timescale | `db.r7g.xlarge` (Provisioned IOPS SSD) | Persistent tick hypertable storage and continuous candle aggregates. |

---

## 3. ALB WebSocket Configuration (Critical)

Standard ALBs terminate idle connections after 60 seconds. For high-frequency trading market feeds, configure the following:

### A. Increase Idle Timeout
```bash
aws elbv2 modify-load-balancer-attributes \
    --load-balancer-arn <YOUR_ALB_ARN> \
    --attributes Key=idle_timeout.timeout_seconds,Value=3600
```

### B. Target Group Settings
- **Protocol**: HTTP/1.1 (Supports HTTP `Upgrade: websocket` automatically).
- **Target Type**: IP (for ECS Fargate `awsvpc` network mode).
- **Health Check Path**: `/metrics`
- **Deregistration Delay**: 15 seconds (allows graceful websocket draining on deployment).

---

## 4. Linux Kernel Tuning for Low Latency (EC2 / Docker Hosts)

When hosting backend containers on EC2, apply the following kernel parameters in `/etc/sysctl.conf`:

```ini
# Increase system file descriptor limits for concurrent socket connections
fs.file-max = 2097152

# Maximize socket receive and transmit buffers
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 262144
net.core.wmem_default = 262144

# Increase network interface request queue
net.core.netdev_max_backlog = 100000

# Enable TCP BBR congestion control for lowest RTT
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# TCP buffer scaling (min, default, max)
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# Disable slow start after idle
net.ipv4.tcp_slow_start_after_idle = 0

# Reuse TIME_WAIT sockets for outgoing connections
net.ipv4.tcp_tw_reuse = 1
```

Apply immediately:
```bash
sudo sysctl -p
```

---

## 5. Container Deployment via AWS Copilot or ECS CLI

### Step 1: Build & Push Images to ECR
```bash
# Authenticate to AWS ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and Push Backend
docker build -t terminal-backend ./backend
docker tag terminal-backend:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/terminal-backend:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/terminal-backend:latest

# Build and Push Frontend
docker build -t terminal-frontend ./frontend
docker tag terminal-frontend:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/terminal-frontend:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/terminal-frontend:latest
```

### Step 2: Launch via Docker Compose (Single Host / Light Deployment)
```bash
docker compose up -d
```

---

## 6. CloudWatch Telemetry & Alerts

Monitor the following metrics in Amazon CloudWatch:
1. `TargetResponseTime` on ALB: Trigger alarm if p95 exceeds 50ms.
2. `ActiveConnectionCount` on ALB: Monitor WebSocket concurrent sessions.
3. `EngineCPUUtilization` on ElastiCache: Trigger scale-out if CPU exceeds 75%.
4. `FreeStorageSpace` on RDS TimescaleDB: Trigger alarm if available storage is below 20%.
