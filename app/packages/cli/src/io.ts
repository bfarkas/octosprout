export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
