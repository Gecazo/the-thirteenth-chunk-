export type Command =
  | { kind: 'status' | 'stop' | 'sleep' | 'memory' | 'debugstate' | 'rethink' | 'play' }
  | { kind: 'follow' | 'trust'; player: string }
  | { kind: 'goal'; text: string }
