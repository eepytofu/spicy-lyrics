export async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
}
