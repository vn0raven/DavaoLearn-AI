export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event("litera:session-expired"));
    }
    const data = await response.json().catch(() => null);
    const invalidEmail = Array.isArray(data?.detail) && data.detail.some(
      (issue: { loc?: string[] }) => issue.loc?.at(-1) === "email",
    );
    if (invalidEmail) throw new RequestError(response.status, "Enter a valid email address.");
    throw new RequestError(response.status, typeof data?.detail === "string" ? data.detail : `Request failed (${response.status}).`);
  }
  return response.json();
}
