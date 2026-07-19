const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper to read/write JSON files acting as DB tables
function readTable(name) {
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeTable(name, data) {
  const filePath = path.join(DATA_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// 1. MongoDB Mock (Document Storage)
const MongoDB = {
  find: (collection, query = {}) => {
    const data = readTable(collection);
    return data.filter(item => {
      for (let key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
  },
  findOne: (collection, query = {}) => {
    const results = MongoDB.find(collection, query);
    return results.length > 0 ? results[0] : null;
  },
  insertOne: (collection, doc) => {
    const data = readTable(collection);
    const newDoc = { id: Math.random().toString(36).substring(2, 9), createdAt: new Date().toISOString(), ...doc };
    data.push(newDoc);
    writeTable(collection, data);
    return newDoc;
  },
  updateOne: (collection, query, update) => {
    const data = readTable(collection);
    let updated = false;
    const newData = data.map(item => {
      let matches = true;
      for (let key in query) {
        if (item[key] !== query[key]) matches = false;
      }
      if (matches && !updated) {
        updated = true;
        return { ...item, ...update, updatedAt: new Date().toISOString() };
      }
      return item;
    });
    writeTable(collection, newData);
    return updated;
  },
  updateMany: (collection, query, update) => {
    const data = readTable(collection);
    const newData = data.map(item => {
      let matches = true;
      for (let key in query) {
        if (item[key] !== query[key]) matches = false;
      }
      if (matches) {
        return { ...item, ...update, updatedAt: new Date().toISOString() };
      }
      return item;
    });
    writeTable(collection, newData);
  }
};

// 2. Redis Mock (Caching & Pub/Sub Queue)
const RedisCache = {};
const RedisSubscribers = {};

const Redis = {
  get: async (key) => {
    return RedisCache[key] || null;
  },
  set: async (key, val, expirySeconds) => {
    RedisCache[key] = val;
    if (expirySeconds) {
      setTimeout(() => {
        delete RedisCache[key];
      }, expirySeconds * 1000);
    }
    return 'OK';
  },
  publish: async (channel, message) => {
    if (RedisSubscribers[channel]) {
      RedisSubscribers[channel].forEach(callback => callback(message));
    }
    return 1;
  },
  subscribe: (channel, callback) => {
    if (!RedisSubscribers[channel]) {
      RedisSubscribers[channel] = [];
    }
    RedisSubscribers[channel].push(callback);
  }
};

// 3. Qdrant Mock (Vector Semantic Memory)
const Qdrant = {
  upsert: async (collection, points) => {
    const table = `qdrant_${collection}`;
    const data = readTable(table);
    points.forEach(p => {
      const idx = data.findIndex(item => item.id === p.id);
      if (idx !== -1) {
        data[idx] = p;
      } else {
        data.push(p);
      }
    });
    writeTable(table, data);
    return { status: 'acknowledged' };
  },
  search: async (collection, { vector, limit = 5, filter = {} }) => {
    const table = `qdrant_${collection}`;
    const data = readTable(table);
    
    const scored = data.map(point => {
      let score = 0;
      if (point.vector && vector) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        const len = Math.min(point.vector.length, vector.length);
        for (let i = 0; i < len; i++) {
          dotProduct += point.vector[i] * vector[i];
          normA += point.vector[i] * point.vector[i];
          normB += vector[i] * vector[i];
        }
        score = normA && normB ? dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
      } else {
        score = Math.random();
      }
      return { ...point, score };
    });

    let filtered = scored;
    if (filter) {
      filtered = scored.filter(p => {
        for (let key in filter) {
          if (p.payload && p.payload[key] !== filter[key]) return false;
        }
        return true;
      });
    }

    return filtered.sort((a, b) => b.score - a.score).slice(0, limit);
  }
};

function generateMockVector(text) {
  const hash = String(text).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const vector = [];
  for (let i = 0; i < 64; i++) {
    vector.push(Math.sin(hash + i) * 0.5 + 0.5);
  }
  return vector;
}

module.exports = {
  MongoDB,
  Redis,
  Qdrant,
  generateMockVector
};
