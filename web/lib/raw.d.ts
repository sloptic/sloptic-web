// A file imported with ?raw is its text. See the webpack rule in next.config.mjs.
declare module "*?raw" {
  const text: string;
  export default text;
}
