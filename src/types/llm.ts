export interface Prompt { system: string; user: string; image?: string; format?: Record<string, unknown>; tokenBudget?: number }
export interface Advisor { propose(prompt: Prompt, signal: AbortSignal): Promise<unknown> }
