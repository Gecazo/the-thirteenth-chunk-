export type Command =
  | { kind: 'status' | 'stop' | 'sleep' | 'memory' | 'debugstate' | 'rethink' | 'play' | 'forget' }
  | { kind: 'follow' | 'trust'; player: string }
  | { kind: 'goal' | 'remember' | 'recall'; text: string }
