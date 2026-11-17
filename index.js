import 'dotenv/config';
import { createServer } from 'node:http';
import { MongoClient } from 'mongodb';
import { todoValidator } from './models/todoSchema.js';
import { createTodoRouter } from './routers/todoRouter.js';

const port = Number(process.env.PORT ?? 5000);
const mongoUri = process.env.MONGO_URI ?? process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/todo_backend';
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const mongoClient = new MongoClient(mongoUri);
const database = mongoClient.db();
const handleTodoRoute = createTodoRouter(database.collection('todos'));

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }

  response.setHeader('vary', 'Origin');
  if (!allowedOrigins.has(origin)) {
    return false;
  }

  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  response.setHeader('access-control-allow-headers', 'Content-Type, Authorization');
  return true;
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (!setCorsHeaders(request, response)) {
    sendJson(response, 403, { error: '허용되지 않은 Origin입니다.' });
    return;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (await handleTodoRoute(request, response)) {
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
});

try {
  await mongoClient.connect();
  console.log('연결 성공');

  const collections = database.listCollections({ name: 'todos' }, { nameOnly: true });
  if (await collections.hasNext()) {
    await database.command({
      collMod: 'todos',
      validator: todoValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  } else {
    await database.createCollection('todos', {
      validator: todoValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  }

  server.listen(port, () => {
    console.log(`Todo backend listening on http://localhost:${port}`);
  });
} catch (error) {
  console.error('MongoDB 연결 또는 초기화 실패:', error);
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await mongoClient.close();
    process.exit(0);
  });
}