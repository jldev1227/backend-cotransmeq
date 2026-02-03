# Cotransmeq - Backend (Fastify + Prisma)

Modern, modular backend for Cotransmeq using TypeScript, Fastify, Prisma, Zod, JWT, argon2 and Socket.IO.

## 🛠️ Tech Stack

- **TypeScript** - Type safety
- **Fastify** - Fast web framework
- **Prisma ORM** - Database toolkit for PostgreSQL
- **Zod** - Schema validation
- **argon2** - Password hashing
- **JWT** - Authentication tokens
- **Socket.IO** - Real-time communication
- **Pino** - Structured logging
- **Swagger** - API documentation

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm or yarn

### 1. Setup Environment

Create/update `.env` with your database credentials:

```env
PORT=4000
DATABASE_URL="postgresql://username:password@localhost:5432/cotransmeq"
JWT_SECRET="your-super-secret-jwt-key"
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Setup Database

```bash
# Generate Prisma client
npx prisma generate

# Run database migration
npx prisma migrate dev --name init

# Optional: Explore database with Prisma Studio
npx prisma studio
```

### 4. Development Server

```bash
npm run dev
```

The server will start on http://localhost:4000

- API documentation: http://localhost:4000/docs
- Health check: http://localhost:4000/

## 📦 Production Build

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

## 🐳 Docker

### Build and Run

```bash
# Build Docker image
docker build -t cotransmeq-backend .

# Run container
docker run -p 4000:4000 --env-file .env cotransmeq-backend
```

### With Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/cotransmeq
      - JWT_SECRET=your-secret-key
    depends_on:
      - db
  
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: cotransmeq
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  postgres_data:
```

```bash
docker-compose up -d
```

## 🏗️ Project Structure

```
src/
├── app.ts                  # Fastify app configuration
├── server.ts               # Server entry point
├── config/
│   ├── env.ts             # Environment variables (Zod validation)
│   └── prisma.ts          # Prisma client
├── modules/
│   ├── auth/              # Authentication module
│   ├── usuarios/          # Users module
│   └── vehiculos/         # Vehicles module
├── sockets/
│   └── index.ts          # Socket.IO setup
├── middlewares/
│   ├── auth.middleware.ts # JWT authentication
│   └── error.middleware.ts # Error handling
├── utils/
│   └── logger.ts         # Pino logger configuration
└── types/
    └── index.d.ts        # Global type definitions
```

## 📚 API Endpoints

### Authentication
- `POST /auth/login` - Login user

### Users
- `POST /usuarios` - Create user
- `GET /usuarios` - List users

### Vehicles
- `GET /vehiculos` - List vehicles

## 🔧 Development Scripts

```bash
npm run dev          # Development server with hot reload
npm run build        # Build for production
npm start            # Start production server
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run database migrations
```

## 📝 Notes

- The project uses modern Fastify plugins (`@fastify/*` packages)
- Passwords are hashed with argon2 (more secure than bcrypt)
- Environment variables are validated with Zod
- Socket.IO is configured for CORS with wildcard origin (adjust for production)
- API documentation is auto-generated with Swagger at `/docs`

## 🔄 Migration from Express

This structure is designed to be compatible with existing Express services. You can gradually migrate routes and services to this new architecture while maintaining API compatibility.
