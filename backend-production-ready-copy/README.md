# Mnazilona IoT Backend

Production-ready backend for the Mnazilona IoT smart home platform.

## Prerequisites

- Node.js >= 18.0.0
- MongoDB (standalone or Atlas)
- MQTT Broker (e.g., EMQX, Mosquitto) with HTTP auth webhook support
- Gmail account with App Password (or other SMTP provider)

## Setup

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Fill in all required values in .env (see below)

# Start in development
npm run dev

# Start in production
npm start
```

## Required Environment Variables

| Variable | Description |
|---|---|
| `JWT_SECRET` | Strong random secret for JWT signing. Generate with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `MONGO_URI` | MongoDB connection string |
| `EMAIL_USER` | Gmail address (or SMTP user) |
| `EMAIL_PASS` | Gmail App Password (not regular password) |
| `MQTT_BROKER_URL` | MQTT broker URL (e.g., `mqtt://broker.example.com`) |
| `MQTT_BROKER_HOST` | MQTT broker hostname |
| `MQTT_USERNAME` | Backend's MQTT username |
| `MQTT_PASSWORD` | Backend's MQTT password |
| `MQTT_WEBHOOK_SECRET` | Shared secret between MQTT broker and backend for webhook auth |
| `ALLOWED_ORIGIN` | Mobile app origin for CORS |

## API Endpoints

| Route | Description |
|---|---|
| `GET /health` | Health check (DB + MQTT status) |
| `POST /auth/*` | Authentication (register, login, password) |
| `GET/PUT /api/me` | User profile |
| `POST /api/account/*` | Email change, account deletion |
| `GET/POST /devices/*` | Device management, pairing, commands |
| `GET/PATCH /notifications/*` | Notifications and transfer requests |
| `GET/POST/PATCH/DELETE /rooms/*` | Room management |
| `POST /admin/*` | Admin device management (requires admin role) |

## Architecture

```
├── index.js              # Entry point
├── config/               # Database & MQTT configuration
├── middleware/            # Auth & rate limiting
├── models/               # Mongoose schemas
├── controllers/          # Request handlers
├── services/             # Business logic (OTP, MQTT ACL)
├── utils/                # Helpers & email
├── routes/               # Route definitions
└── jobs/                 # Background jobs (device timeout)
```

## MQTT Broker Configuration

Configure your MQTT broker to use the HTTP auth webhook:

- **Auth endpoint:** `POST https://your-backend/devices/mqtt/auth`
- **Header:** `x-webhook-secret: <your MQTT_WEBHOOK_SECRET value>`
- **Topic structure:** `mnazilona/devices/{serialNumber}/{command|status|heartbeat|dp/report}`

## Production Notes

- Always set `NODE_ENV=production`
- Use a process manager (PM2, systemd) for automatic restarts
- Set up MongoDB authentication and use a connection string with credentials
- Use TLS/SSL termination via reverse proxy (nginx, Caddy)
- Rotate `JWT_SECRET` periodically (will invalidate all sessions)
- Monitor the `/health` endpoint for uptime
- Device logs auto-expire after 30 days, notifications after 90 days
