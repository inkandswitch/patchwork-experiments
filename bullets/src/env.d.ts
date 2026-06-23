declare module "*.css" {}

declare module "*.html?raw" {
  const content: string;
  export default content;
}
