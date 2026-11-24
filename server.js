const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "writing_session";

let store = { users: [], posts: [], sessions: {} };
let saveQueue = Promise.resolve();

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

function saveStore() {
  const snapshot = JSON.stringify(store, null, 2);
  saveQueue = saveQueue.then(async () => {
    const temporaryFile = `${DATA_FILE}.tmp`;
    await fs.writeFile(temporaryFile, snapshot, "utf8");
    await fs.rename(temporaryFile, DATA_FILE);
  });
  return saveQueue;
}

function readCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return null;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
  );
}

function currentUser(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const session = store.sessions[token];
  if (!session || session.expiresAt <= Date.now()) {
    if (session) delete store.sessions[token];
    return null;
  }
  return store.users.find((user) => user.id === session.userId) || null;
}

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "로그인이 필요합니다." });
  req.user = user;
  next();
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

app.get("/api/me", (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

app.post("/api/register", async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (name.length < 1 || name.length > 30) {
      return res.status(400).json({ error: "이름은 1자 이상 30자 이하로 입력해 주세요." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "올바른 이메일 주소를 입력해 주세요." });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "비밀번호는 8자 이상 128자 이하로 입력해 주세요." });
    }
    if (store.users.some((user) => user.email === email)) {
      return res.status(409).json({ error: "이미 가입된 이메일입니다." });
    }

    const credentials = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordSalt: credentials.salt,
      passwordHash: credentials.hash,
      createdAt: new Date().toISOString()
    };
    const token = crypto.randomBytes(32).toString("hex");
    store.users.push(user);
    store.sessions[token] = { userId: user.id, expiresAt: Date.now() + SESSION_TTL };
    await saveStore();
    setSessionCookie(res, token);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/login", async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 1 || password.length > 128) {
      return res.status(401).json({ error: "이메일 또는 비밀번호를 확인해 주세요." });
    }
    const user = store.users.find((candidate) => candidate.email === email);
    const passwordHash = user
      ? hashPassword(password, user.passwordSalt).hash
      : crypto.pbkdf2Sync(password, "invalid-user-salt", 210000, 32, "sha256").toString("hex");

    if (!user || !crypto.timingSafeEqual(Buffer.from(passwordHash, "hex"), Buffer.from(user.passwordHash, "hex"))) {
      return res.status(401).json({ error: "이메일 또는 비밀번호를 확인해 주세요." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    store.sessions[token] = { userId: user.id, expiresAt: Date.now() + SESSION_TTL };
    await saveStore();
    setSessionCookie(res, token);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/logout", async (req, res, next) => {
  try {
    const token = readCookie(req, COOKIE_NAME);
    if (token) delete store.sessions[token];
    await saveStore();
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/posts", (req, res) => {
  const posts = [...store.posts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((post) => ({
      id: post.id,
      title: post.title,
      content: post.content,
      createdAt: post.createdAt,
      author: store.users.find((user) => user.id === post.userId)?.name || "탈퇴한 이용자"
    }));
  res.json({ posts });
});

app.post("/api/posts", requireUser, async (req, res, next) => {
  try {
    const body = req.body || {};
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!title || title.length > 100) {
      return res.status(400).json({ error: "제목은 1자 이상 100자 이하로 입력해 주세요." });
    }
    if (!content || content.length > 10000) {
      return res.status(400).json({ error: "내용은 1자 이상 10,000자 이하로 입력해 주세요." });
    }

    const post = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      title,
      content,
      createdAt: new Date().toISOString()
    };
    store.posts.push(post);
    await saveStore();
    res.status(201).json({
      post: {
        id: post.id,
        title: post.title,
        content: post.content,
        createdAt: post.createdAt,
        author: req.user.name
      }
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "올바른 JSON 요청을 보내 주세요." });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "요청 내용이 너무 큽니다." });
  }
  res.status(500).json({ error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
});

async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const savedStore = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    store = {
      users: Array.isArray(savedStore.users) ? savedStore.users : [],
      posts: Array.isArray(savedStore.posts) ? savedStore.posts : [],
      sessions: savedStore.sessions && typeof savedStore.sessions === "object" ? savedStore.sessions : {}
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveStore();
  }

  const now = Date.now();
  for (const [token, session] of Object.entries(store.sessions)) {
    if (!session || session.expiresAt <= now) delete store.sessions[token];
  }
  await saveStore();

  app.listen(PORT, () => {
    console.log(`글작성 페이지가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}

start().catch((error) => {
  console.error("서버 시작에 실패했습니다.", error);
  process.exitCode = 1;
});
