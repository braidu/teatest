/**
 * 교직 적·인성검사 리포트용 OpenAI 프록시 (Vercel Serverless Function)
 * ------------------------------------------------------------------
 * Cloudflare Worker 버전과 기능은 동일하지만, Vercel Function은 vercel.json에서
 * 지정한 "고정된 리전"(예: 서울 icn1)에서만 실행되기 때문에, Cloudflare Workers처럼
 * 전 세계 여러 edge로 요청이 분산되면서 OpenAI 미지원 지역에 걸리는 문제 자체가
 * 발생하지 않습니다. 이게 이 버전을 쓰는 이유입니다.
 *
 * 환경변수 (Vercel 대시보드 > Project > Settings > Environment Variables):
 *   - OPENAI_API_KEY  (필수) : sk-... (또는 OpenRouter 등 호환 서비스 키)
 *   - OPENAI_BASE_URL (선택) : 기본 https://api.openai.com/v1/chat/completions
 *   - OPENAI_MODEL    (선택) : 기본 gpt-4o-mini
 *   - ALLOWED_ORIGIN  (선택) : 예) https://내아이디.github.io  (비우면 전체 허용)
 *   - APP_SECRET      (선택) : index.html의 APP_SECRET과 동일한 값
 */

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TOKENS_CAP = 1500;

module.exports = async (req, res) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-app-secret");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 지원합니다." });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 OPENAI_API_KEY가 설정되지 않았습니다." });
    return;
  }
  if (process.env.APP_SECRET) {
    const provided = req.headers["x-app-secret"] || "";
    if (provided !== process.env.APP_SECRET) {
      res.status(401).json({ error: "인증되지 않은 요청입니다." });
      return;
    }
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const system = typeof body.system === "string" ? body.system.slice(0, 6000) : "";
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    ...incoming
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) })),
  ];
  const maxTokens = Math.min(Number(body.max_tokens) || 800, MAX_TOKENS_CAP);
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions";

  try {
    const upstream = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.7 }),
    });

    if (!upstream.ok) {
      let detail = upstream.status + " " + upstream.statusText;
      try {
        const j = await upstream.json();
        if (j.error && j.error.message) detail = j.error.message;
      } catch (e) {}
      res.status(502).json({ error: "OpenAI 오류: " + detail });
      return;
    }

    const data = await upstream.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    res.status(200).json({ reply });
  } catch (e) {
    res.status(502).json({ error: "OpenAI 서버 호출에 실패했습니다: " + e.message });
  }
};

