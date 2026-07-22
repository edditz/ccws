const write = (stream: NodeJS.WriteStream, prefix: string, msg: string): void => {
  stream.write(`${prefix} ${msg}\n`);
};

export const info = (msg: string): void => write(process.stdout, "•", msg);
export const success = (msg: string): void => write(process.stdout, "✓", msg);
export const error = (msg: string): void => write(process.stderr, "✗", msg);
export const warn = (msg: string): void => write(process.stderr, "!", msg);
