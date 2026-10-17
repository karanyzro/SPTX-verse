const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const clean = (v, n = 5000) => String(v ?? "").trim().slice(0, n);
const id = () => crypto.randomUUID();

export async function onRequest({ request, env }) {
  if (!env.DB) return json({ error: "D1 binding DB is missing" }, 503);
  const url = new URL(request.url), path = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = request.method;
  try {
    if (path[0] === "posts" && path.length === 1 && method === "GET") {
      const { results } = await env.DB.prepare("SELECT payload FROM posts ORDER BY created_at DESC").all();
      return json(results.map(x => JSON.parse(x.payload)));
    }
    if (path[0] === "ideas" && path.length === 1 && method === "GET") {
      const { results } = await env.DB.prepare("SELECT id,author,title,body,category,created_at FROM ideas ORDER BY created_at DESC LIMIT 200").all();
      return json(results);
    }
    if (path[0] === "ideas" && path.length === 1 && method === "POST") {
      const b = await request.json(), author = clean(b.author, 32), title = clean(b.title, 120), body = clean(b.body, 2000), category = clean(b.category, 40), now = Date.now(), itemId = id();
      if (!author || !title || !body) return json({ error: "Name, title, and description required" }, 400);
      await env.DB.prepare("INSERT INTO ideas(id,author,title,body,category,created_at) VALUES(?,?,?,?,?,?)").bind(itemId, author, title, body, category, now).run();
      return json({ id: itemId, author, title, body, category, created_at: now }, 201);
    }
    if (path[0] === "posts" && path.length === 1 && method === "POST") {
      if (!env.ADMIN_KEY || request.headers.get("Authorization") !== `Bearer ${env.ADMIN_KEY}`) return json({ error: "Admin access refused" }, 401);
      const p = await request.json();
      if (!p?.title) return json({ error: "Title required" }, 400);
      const post = { ...p, id: String(p.id || id()), date: Number(p.date || Date.now()) };
      await env.DB.prepare("INSERT INTO posts(id,payload,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at")
        .bind(post.id, JSON.stringify(post), post.date).run();
      return json(post, 201);
    }
    if (path[0] === "posts" && path.length === 2 && method === "DELETE") {
      if (!env.ADMIN_KEY || request.headers.get("Authorization") !== `Bearer ${env.ADMIN_KEY}`) return json({ error: "Admin access refused" }, 401);
      await env.DB.prepare("DELETE FROM posts WHERE id=?").bind(path[1]).run();
      return json({ ok: true });
    }
    if (path[0] === "posts" && path.length === 3 && path[2] === "community" && method === "GET") {
      const postId = path[1];
      const [notes, comments, ratings] = await Promise.all([
        env.DB.prepare("SELECT id,author,body,created_at FROM verse_notes WHERE post_id=? ORDER BY created_at DESC LIMIT 100").bind(postId).all(),
        env.DB.prepare("SELECT id,author,body,created_at FROM verse_comments WHERE post_id=? ORDER BY created_at DESC LIMIT 100").bind(postId).all(),
        env.DB.prepare("SELECT author,rating,updated_at FROM verse_ratings WHERE post_id=? ORDER BY updated_at DESC LIMIT 500").bind(postId).all()
      ]);
      return json({ notes: notes.results, comments: comments.results, ratings: ratings.results });
    }
    if (path[0] === "posts" && path.length === 3 && path[2] === "community" && method === "POST") {
      const postId = path[1], b = await request.json(), author = clean(b.author, 32), body = clean(b.body, 1000), kind = b.kind;
      if (!author || !body || !["note", "comment"].includes(kind)) return json({ error: "Author, text, and valid kind required" }, 400);
      const table = kind === "note" ? "verse_notes" : "verse_comments", itemId = id(), now = Date.now();
      await env.DB.prepare(`INSERT INTO ${table}(id,post_id,author,body,created_at) VALUES(?,?,?,?,?)`).bind(itemId, postId, author, body, now).run();
      return json({ id: itemId, post_id: postId, author, body, created_at: now }, 201);
    }
    if (path[0] === "posts" && path.length === 3 && path[2] === "rating" && method === "POST") {
      const postId = path[1], b = await request.json(), author = clean(b.author, 32), rating = Math.floor(Number(b.rating));
      if (!author || rating < 1 || rating > 5) return json({ error: "Author and rating from 1 to 5 required" }, 400);
      await env.DB.prepare("INSERT INTO verse_ratings(post_id,author,rating,updated_at) VALUES(?,?,?,?) ON CONFLICT(post_id,author) DO UPDATE SET rating=excluded.rating,updated_at=excluded.updated_at").bind(postId, author, rating, Date.now()).run();
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (e) { return json({ error: "Request failed" }, 500); }
}
