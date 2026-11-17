import { ObjectId } from 'mongodb';

const maxBodySize = 1_000_000;

class PayloadTooLargeError extends Error {}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodySize) {
      tooLarge = true;
    } else if (!tooLarge) {
      chunks.push(chunk);
    }
  }

  if (tooLarge) {
    throw new PayloadTooLargeError();
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function validateTodoBody(body, partial = false) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'JSON 객체를 보내야 합니다.' };
  }

  const allowedFields = new Set(['title', 'description', 'completed']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    return { error: 'title, description, completed 필드만 사용할 수 있습니다.' };
  }

  const fields = {};
  if (!partial || Object.hasOwn(body, 'title')) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 200) {
      return { error: 'title은 1~200자여야 합니다.' };
    }
    fields.title = title;
  }

  if (!partial || Object.hasOwn(body, 'description')) {
    const description = body.description === undefined ? '' : body.description;
    if (typeof description !== 'string' || description.length > 2000) {
      return { error: 'description은 2000자 이하여야 합니다.' };
    }
    fields.description = description.trim();
  }

  if (!partial || Object.hasOwn(body, 'completed')) {
    const completed = partial ? body.completed : body.completed ?? false;
    if (typeof completed !== 'boolean') {
      return { error: 'completed는 true 또는 false여야 합니다.' };
    }
    fields.completed = completed;
  }

  if (partial && Object.keys(fields).length === 0) {
    return { error: '수정할 필드를 하나 이상 보내야 합니다.' };
  }

  return { fields };
}

export function createTodoRouter(collection) {
  return async function handleTodoRoute(request, response) {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const match = pathname.match(/^\/todos(?:\/([^/]+))?$/);
    if (!match) {
      return false;
    }

    const id = match[1];
    const allowedMethods = id ? 'GET, PATCH, DELETE' : 'GET, POST';
    const objectId = id && /^[\da-f]{24}$/i.test(id) ? new ObjectId(id) : null;

    if (id && !objectId) {
      sendJson(response, 400, { error: '올바르지 않은 할 일 ID입니다.' });
      return true;
    }

    try {
      if (!id && request.method === 'POST') {
        const validation = validateTodoBody(await readJsonBody(request));
        if (validation.error) {
          sendJson(response, 400, { error: validation.error });
          return true;
        }

        const todo = { ...validation.fields, createdAt: new Date() };
        const result = await collection.insertOne(todo);
        sendJson(response, 201, { ...todo, _id: result.insertedId });
        return true;
      }

      if (!id && request.method === 'GET') {
        const todos = await collection.find().sort({ createdAt: -1 }).toArray();
        sendJson(response, 200, todos);
        return true;
      }

      if (id && request.method === 'GET') {
        const todo = await collection.findOne({ _id: objectId });
        if (!todo) {
          sendJson(response, 404, { error: '할 일을 찾을 수 없습니다.' });
          return true;
        }

        sendJson(response, 200, todo);
        return true;
      }

      if (id && request.method === 'PATCH') {
        const validation = validateTodoBody(await readJsonBody(request), true);
        if (validation.error) {
          sendJson(response, 400, { error: validation.error });
          return true;
        }

        const todo = await collection.findOneAndUpdate(
          { _id: objectId },
          { $set: validation.fields },
          { returnDocument: 'after' },
        );
        if (!todo) {
          sendJson(response, 404, { error: '할 일을 찾을 수 없습니다.' });
          return true;
        }

        sendJson(response, 200, todo);
        return true;
      }

      if (id && request.method === 'DELETE') {
        const result = await collection.deleteOne({ _id: objectId });
        if (result.deletedCount === 0) {
          sendJson(response, 404, { error: '할 일을 찾을 수 없습니다.' });
          return true;
        }

        response.writeHead(204);
        response.end();
        return true;
      }

      response.writeHead(405, {
        allow: allowedMethods,
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ error: '지원하지 않는 HTTP 메서드입니다.' }));
      return true;
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: '요청 본문은 1MB 이하여야 합니다.' });
      } else if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: '올바른 JSON 형식이 아닙니다.' });
      } else {
        console.error('할 일 라우터 오류:', error);
        sendJson(response, 500, { error: '요청을 처리하지 못했습니다.' });
      }
      return true;
    }
  };
}
