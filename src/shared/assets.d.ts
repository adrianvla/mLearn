/**
 * Static Asset Module Declarations
 * Allows TypeScript to understand Vite's static asset imports
 */

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.gif' {
  const src: string;
  export default src;
}

declare module '*?url' {
  const src: string;
  export default src;
}

declare module '*.md?raw' {
  const content: string;
  export default content;
}
