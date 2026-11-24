const accountArea = document.querySelector("#accountArea");
const postForm = document.querySelector("#postForm");
const postList = document.querySelector("#postList");
const postMessage = document.querySelector("#postMessage");
const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
const authMessage = document.querySelector("#authMessage");
const postContent = document.querySelector("#postContent");
const charCount = document.querySelector("#charCount");

let currentUser = null;
let authMode = "login";

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}

function renderAccount() {
  accountArea.replaceChildren();
  if (currentUser) {
    const greeting = document.createElement("span");
    greeting.className = "account-name";
    greeting.textContent = `${currentUser.name}님, 반가워요`;
    const logout = document.createElement("button");
    logout.className = "quiet-button";
    logout.type = "button";
    logout.textContent = "로그아웃";
    logout.addEventListener("click", logoutUser);
    accountArea.append(greeting, logout);
  } else {
    const login = document.createElement("button");
    login.className = "quiet-button";
    login.type = "button";
    login.textContent = "로그인";
    login.addEventListener("click", () => openAuth("login"));
    const register = document.createElement("button");
    register.className = "primary-button";
    register.type = "button";
    register.textContent = "회원가입";
    register.addEventListener("click", () => openAuth("register"));
    accountArea.append(login, register);
  }
  document.querySelector("#signedOutNotice").classList.toggle("hidden", Boolean(currentUser));
  document.querySelector("#postTitle").disabled = !currentUser;
  postContent.disabled = !currentUser;
  postForm.querySelector('button[type="submit"]').disabled = !currentUser;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(value));
}

function renderPosts(posts) {
  document.querySelector("#postCount").textContent = posts.length;
  postList.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "아직 올라온 이야기가 없어요. 첫 번째 이야기를 들려주세요.";
    postList.append(empty);
    return;
  }

  for (const post of posts) {
    const article = document.createElement("article");
    article.className = "post-card";
    const meta = document.createElement("div");
    meta.className = "post-meta";
    const author = document.createElement("span");
    author.className = "post-author";
    author.textContent = post.author;
    const date = document.createElement("time");
    date.dateTime = post.createdAt;
    date.textContent = formatDate(post.createdAt);
    const title = document.createElement("h3");
    title.className = "post-title";
    title.textContent = post.title;
    const content = document.createElement("p");
    content.className = "post-content";
    content.textContent = post.content;
    meta.append(author, date);
    article.append(meta, title, content);
    postList.append(article);
  }
}

async function loadPosts() {
  try {
    const { posts } = await api("/api/posts");
    renderPosts(posts);
  } catch (error) {
    postList.replaceChildren();
    const notice = document.createElement("p");
    notice.className = "form-message";
    notice.textContent = error.message;
    postList.append(notice);
  }
}

function openAuth(mode) {
  setAuthMode(mode);
  authDialog.showModal();
  (mode === "register" ? document.querySelector("#authName") : document.querySelector("#authEmail")).focus();
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  document.querySelector("#authTitle").textContent = registering ? "회원가입" : "로그인";
  document.querySelector("#authDescription").textContent = registering
    ? "당신의 이야기를 남길 계정을 만들어 보세요."
    : "다시 만나 반가워요. 이야기를 이어가 볼까요?";
  document.querySelector("#authSubmit").textContent = registering ? "계정 만들기" : "로그인";
  document.querySelector("#nameField").classList.toggle("hidden", !registering);
  document.querySelector("#authName").required = registering;
  document.querySelector("#authPassword").autocomplete = registering ? "new-password" : "current-password";
  document.querySelector("#switchPrompt").textContent = registering ? "이미 계정이 있나요?" : "아직 계정이 없나요?";
  document.querySelector("#switchAuth").textContent = registering ? "로그인" : "회원가입";
  authMessage.textContent = "";
}

async function logoutUser() {
  try {
    await api("/api/logout", { method: "POST" });
    currentUser = null;
    renderAccount();
  } catch (error) {
    postMessage.textContent = error.message;
  }
}

document.querySelectorAll("[data-open-auth]").forEach((button) => {
  button.addEventListener("click", () => openAuth(button.dataset.openAuth));
});

document.querySelector("#closeDialog").addEventListener("click", () => authDialog.close());
document.querySelector("#switchAuth").addEventListener("click", () => {
  authForm.reset();
  setAuthMode(authMode === "login" ? "register" : "login");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "";
  const formData = new FormData(authForm);
  const body = Object.fromEntries(formData.entries());
  const button = document.querySelector("#authSubmit");
  button.disabled = true;
  try {
    const { user } = await api(`/api/${authMode}`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    currentUser = user;
    authForm.reset();
    authDialog.close();
    renderAccount();
    postMessage.textContent = "";
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

postForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  postMessage.textContent = "";
  const button = postForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        title: document.querySelector("#postTitle").value,
        content: postContent.value
      })
    });
    postForm.reset();
    charCount.textContent = "0 / 10,000";
    postMessage.textContent = "이야기를 올렸어요.";
    await loadPosts();
  } catch (error) {
    postMessage.textContent = error.message;
  } finally {
    button.disabled = !currentUser;
  }
});

postContent.addEventListener("input", () => {
  charCount.textContent = `${postContent.value.length.toLocaleString("ko-KR")} / 10,000`;
});

async function initialize() {
  try {
    const { user } = await api("/api/me");
    currentUser = user;
  } catch (error) {
    postMessage.textContent = error.message;
  }
  renderAccount();
  await loadPosts();
}

initialize();
