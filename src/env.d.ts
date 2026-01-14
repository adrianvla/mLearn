export {};

declare global {
  interface Window {
    electronAPI: {
      getVersion: () => Promise<string>;
      sendMessage: (message: string) => void;
    };
  }
}

declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

