export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new RequestError(response.status, typeof data?.detail === "string" ? data.detail : `Request failed (${response.status}).`);
  }
  return response.json();
}
